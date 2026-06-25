import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, toNano } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { SubscriptionPlugin } from '../wrappers/SubscriptionPlugin';
import { loadWalletCode, loadSubscriptionCode } from '../wrappers/loadCode';

const OP_FALLBACK = 0x756e6b77;
const SUBWALLET_ID = 698983191;
const START = 1_700_000_000;

// NOTE on scope: these tests fund the plugin with a PLAIN transfer from a generic treasury
// (sender != wallet, empty/short body). That is NOT the canonical deploy path (the wallet's
// op-1 "deploy and install plugin" sends a body, with sender == wallet). They document the
// by-design "stray/unexpected funds are forwarded to the beneficiary" behavior, and they also
// illustrate why the README's "1 Toncoin stays on plugin balance" wording is inaccurate: the
// reserve constant is only ~0.067 TON (see finding B1). No funds are stolen -- everything goes
// to the legitimate beneficiary.
describe('By-design: stray transfers are forwarded to the beneficiary', () => {
    it('BY-DESIGN: an empty-body transfer from a non-wallet sender is forwarded to the beneficiary (not the canonical op-1 deploy)', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = START + 10;
        const deployer = await blockchain.treasury('deployer');
        const beneficiary = await blockchain.treasury('beneficiary');
        const keyPair = await mnemonicToWalletKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '));

        const wallet = blockchain.openContract(
            WalletV4.createFromConfig({ seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null }, loadWalletCode()),
        );
        await wallet.sendDeploy(deployer.getSender(), toNano('10'));

        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;

        const plugin = blockchain.openContract(
            SubscriptionPlugin.createFromConfig(
                {
                    wallet: wallet.address, beneficiary: beneficiary.address, amount: toNano('5'),
                    period: 3600, startTime: START, timeout: 60, lastPaymentTime: START,
                    lastRequestTime: 0, failedAttempts: 0, subscriptionId: 1,
                },
                loadSubscriptionCode(),
            ),
        );
        // Fund the plugin with 1 TON on deploy (empty body).
        const res = await plugin.sendDeploy(deployer.getSender(), toNano('1'));

        // The deploy transfer (sender=deployer, not wallet/beneficiary) hits the fallback branch
        // and is swept to the beneficiary with mode 128 (carry all balance).
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_FALLBACK });

        const pluginBal = (await blockchain.getContract(plugin.address)).balance;
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('plugin balance right after deploy-fund:', pluginBal.toString());
        console.log('beneficiary received on deploy:', (benAfter - benBefore).toString());

        // The plugin keeps ONLY the reserve (~0.067 TON), NOT the 1 TON the README says should stay.
        expect(pluginBal).toBeLessThan(toNano('0.1'));
        expect(pluginBal).toBeGreaterThan(0n);
    });

    it('BY-DESIGN: a plain top-up (short body) from a non-wallet sender is also forwarded to the beneficiary', async () => {
        const blockchain = await Blockchain.create();
        blockchain.now = START + 10;
        const deployer = await blockchain.treasury('deployer');
        const beneficiary = await blockchain.treasury('beneficiary');
        const topper = await blockchain.treasury('topper');
        const keyPair = await mnemonicToWalletKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '));
        const wallet = blockchain.openContract(
            WalletV4.createFromConfig({ seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null }, loadWalletCode()),
        );
        await wallet.sendDeploy(deployer.getSender(), toNano('10'));
        const plugin = blockchain.openContract(
            SubscriptionPlugin.createFromConfig(
                {
                    wallet: wallet.address, beneficiary: beneficiary.address, amount: toNano('5'),
                    period: 3600, startTime: START, timeout: 60, lastPaymentTime: START,
                    lastRequestTime: 0, failedAttempts: 0, subscriptionId: 1,
                },
                loadSubscriptionCode(),
            ),
        );
        await plugin.sendDeploy(deployer.getSender(), toNano('1'));

        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        // A well-meaning top-up of 2 TON with empty body.
        const res = await topper.send({ to: plugin.address, value: toNano('2'), bounce: false, body: beginCell().endCell() });
        // slice_bits < 32 path also routes to fallback forward_funds.
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_FALLBACK });
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('top-up swept to beneficiary:', (benAfter - benBefore).toString());
        const pluginBal = (await blockchain.getContract(plugin.address)).balance;
        console.log('plugin balance after top-up:', pluginBal.toString());
        expect(pluginBal).toBeLessThan(toNano('0.1'));
    });
});
