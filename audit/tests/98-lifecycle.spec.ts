import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano, contractAddress } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { SubscriptionPlugin } from '../wrappers/SubscriptionPlugin';
import { loadWalletCode, loadSubscriptionCode } from '../wrappers/loadCode';

describe('Lifecycle: op1 deploy+install, remove-self auth', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let wallet: SandboxContract<WalletV4>;
    let walletCode: Cell;
    let subCode: Cell;
    let keyPair: { publicKey: Buffer; secretKey: Buffer };
    const SUBWALLET_ID = 698983191;

    beforeAll(async () => {
        walletCode = loadWalletCode();
        subCode = loadSubscriptionCode();
        keyPair = await mnemonicToWalletKey(
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '),
        );
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        wallet = blockchain.openContract(
            WalletV4.createFromConfig(
                { seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null },
                walletCode,
            ),
        );
        await wallet.sendDeploy(deployer.getSender(), toNano('10'));
    });

    // LIFECYCLE: op1 deploys a real subscription plugin and registers it.
    it('LC1: op1 deploys + installs a subscription plugin (no overflow)', async () => {
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        // Build subscription state_init (code + data).
        const subData = beginCell()
            .storeAddress(wallet.address)
            .storeAddress(deployer.address) // beneficiary
            .storeCoins(toNano('1'))
            .storeUint(2592000, 32) // period
            .storeUint(Math.floor(Date.now() / 1000), 32) // start_time
            .storeUint(60, 32) // timeout
            .storeUint(0, 32) // last_payment_time
            .storeUint(0, 32) // last_request_time
            .storeUint(0, 8)  // failed_attempts
            .storeUint(1, 32) // subscription_id
            .endCell();
        const stateInit = beginCell()
            .storeUint(0, 2)        // no split_depth, no special
            .storeMaybeRef(subCode)
            .storeMaybeRef(subData)
            .storeUint(0, 1)        // empty libraries
            .endCell();
        const body = beginCell().endCell();
        const pluginAddr = contractAddress(0, { code: subCode, data: subData });

        const toSign = WalletV4.buildSignedBody({
            subwalletId: SUBWALLET_ID, validUntil, seqno: 0, op: 1,
            payload: (b) => {
                b.storeInt(0, 8)               // plugin_workchain
                 .storeCoins(toNano('1.5'))    // plugin_balance
                 .storeRef(stateInit)
                 .storeRef(body);
            },
        });
        const signed = WalletV4.signExternal(toSign, keyPair.secretKey);
        const res = await wallet.sendRawExternal(signed);

        // Wallet should deploy the plugin (state_init present in out msg).
        expect(res.transactions).toHaveTransaction({ from: wallet.address, to: pluginAddr, deploy: true });
        expect(await wallet.getSeqno()).toBe(1);
        expect(await wallet.getIsPluginInstalled(0, BigInt('0x' + pluginAddr.hash.toString('hex')))).toBe(true);
        console.log('[LC1] op1 deployed+installed plugin', pluginAddr.toString());
    });

    // LIFECYCLE: a registered plugin can remove itself (op 0x64737472). A
    // non-registered sender cannot remove an arbitrary plugin via internal msg.
    it('LC2: only the plugin itself can self-remove; spoofing impossible', async () => {
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const plug = await blockchain.treasury('plugLC2');
        const attacker = await blockchain.treasury('attackerLC2');
        await wallet.sendInstallPlugin({
            secretKey: keyPair.secretKey, subwalletId: SUBWALLET_ID, validUntil,
            seqno: 0, pluginAddress: plug.address, amount: toNano('0.01'), queryId: 1,
        });
        const plugHash = BigInt('0x' + plug.address.hash.toString('hex'));
        expect(await wallet.getIsPluginInstalled(0, plugHash)).toBe(true);

        // Attacker tries to remove the plugin by sending dstr op (source = attacker).
        const dstr = beginCell().storeUint(0x64737472, 32).storeUint(0, 64).endCell();
        await attacker.send({ to: wallet.address, value: toNano('0.1'), bounce: true, body: dstr });
        // Still installed: attacker's source addr is not in dict -> early return.
        expect(await wallet.getIsPluginInstalled(0, plugHash)).toBe(true);
        console.log('[LC2] attacker dstr ignored, plugin still installed');

        // The plugin itself self-removes.
        await plug.send({ to: wallet.address, value: toNano('0.1'), bounce: true, body: dstr });
        expect(await wallet.getIsPluginInstalled(0, plugHash)).toBe(false);
        console.log('[LC2] plugin self-removed successfully');
    });
});
