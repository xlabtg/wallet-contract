import { Blockchain, SandboxContract, TreasuryContract, internal, createShardAccount } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano, Dictionary } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { SubscriptionPlugin } from '../wrappers/SubscriptionPlugin';
import { loadWalletCode, loadSubscriptionCode } from '../wrappers/loadCode';

const OP_PLUG = 0x706c7567;
const OP_DSTR = 0x64737472;
const OP_SUBS = 0x73756273;
const OP_PLUG_RESP = (0x706c7567 | 0x80000000) >>> 0;
const SUBWALLET_ID = 698983191;
const PERIOD = 3600, TIMEOUT = 60, START = 1_700_000_000;
const AMOUNT = toNano('5');

function pluginsDictDirect(p: Address): Cell {
    const d = Dictionary.empty(Dictionary.Keys.Buffer(33), Dictionary.Values.Cell());
    d.set(Buffer.concat([Buffer.from([p.workChain & 0xff]), p.hash]), beginCell().endCell());
    return beginCell().storeDictDirect(d).endCell();
}

async function wireWallet(blockchain: Blockchain, walletCode: Cell, publicKey: Buffer, pluginAddr: Address, walletAddr: Address, balance: bigint) {
    const data = beginCell()
        .storeUint(0, 32).storeUint(SUBWALLET_ID, 32).storeBuffer(publicKey, 32)
        .storeBit(1).storeRef(pluginsDictDirect(pluginAddr)).endCell();
    await blockchain.setShardAccount(walletAddr, createShardAccount({ address: walletAddr, code: walletCode, data, balance }));
}

describe('Audit PoC: double-payment race & message construction', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let beneficiary: SandboxContract<TreasuryContract>;
    let walletCode: Cell, pluginCode: Cell;
    let keyPair: { publicKey: Buffer; secretKey: Buffer };

    beforeAll(async () => {
        walletCode = loadWalletCode();
        pluginCode = loadSubscriptionCode();
        keyPair = await mnemonicToWalletKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '));
    });

    async function freshPlugin(lastPaymentTime: number, failedAttempts = 0) {
        blockchain = await Blockchain.create();
        blockchain.now = START + 10;
        deployer = await blockchain.treasury('deployer');
        beneficiary = await blockchain.treasury('beneficiary');
        const wallet = blockchain.openContract(WalletV4.createFromConfig({ seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null }, walletCode));
        await wallet.sendDeploy(deployer.getSender(), toNano('100'));
        const plugin = blockchain.openContract(SubscriptionPlugin.createFromConfig({
            wallet: wallet.address, beneficiary: beneficiary.address, amount: AMOUNT,
            period: PERIOD, startTime: START, timeout: TIMEOUT, lastPaymentTime, lastRequestTime: 0, failedAttempts, subscriptionId: 1,
        }, pluginCode));
        await plugin.sendDeploy(deployer.getSender(), toNano('1'));
        await wireWallet(blockchain, walletCode, keyPair.publicKey, plugin.address, wallet.address, toNano('100'));
        return { wallet, plugin };
    }

    it('Two requests issued in one period before any response: BOTH responses; 1st pays, 2nd is rejected (exit 49) and bounces back', async () => {
        const { wallet, plugin } = await freshPlugin(START);
        blockchain.now = START + PERIOD + 100;
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        const walletBefore = (await blockchain.getContract(wallet.address)).balance;

        const body = beginCell().storeUint(OP_PLUG_RESP, 32).storeUint(0, 64).endCell();
        // First response pays.
        const r1 = await blockchain.sendMessage(internal({ from: wallet.address, to: plugin.address, value: AMOUNT, bounced: false, body }));
        expect(r1.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });

        // Second response, same period -> exit 49 -> bounce.
        const r2 = await blockchain.sendMessage(internal({ from: wallet.address, to: plugin.address, value: AMOUNT, bounced: false, body }));
        expect(r2.transactions).not.toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });
        // The throwing tx bounces value back to the wallet.
        const bouncedToWallet = r2.transactions.some(t => t.inMessage?.info.type === 'internal' && t.inMessage.info.bounced === true && t.inMessage.info.dest?.toString() === wallet.address.toString());
        console.log('second response bounced back to wallet:', bouncedToWallet);
        expect(bouncedToWallet).toBe(true);

        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('beneficiary paid total across the two responses:', (benAfter - benBefore).toString(), '(should be ~one payment)');
        // Beneficiary should have received roughly ONE payment, not two.
        expect(benAfter - benBefore).toBeLessThan(AMOUNT + toNano('1'));
        expect(benAfter - benBefore).toBeGreaterThan(AMOUNT - toNano('1'));
    });

    it('Full happy path: poke -> request -> wallet pays -> beneficiary receives ~amount-fees', async () => {
        const { wallet, plugin } = await freshPlugin(START);
        blockchain.now = START + PERIOD + 100;
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        const res = await plugin.sendExternalRequest();
        // The request op the plugin sends to the wallet.
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: wallet.address, op: OP_PLUG });
        // Wallet's payment response op (plug | 0x80000000).
        expect(res.transactions).toHaveTransaction({ from: wallet.address, to: plugin.address });
        // Plugin forwards to beneficiary.
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('happy path beneficiary delta:', (benAfter - benBefore).toString());
        const d = await plugin.getSubscriptionData();
        expect(d.failedAttempts).toBe(0); // reset after payment
        expect(d.lastPaymentTime).toBe(START + PERIOD + 100);
    });

    it('A SECOND poke in the next period correctly pays again (per-period semantics work for honest flow)', async () => {
        const { plugin } = await freshPlugin(START);
        blockchain.now = START + PERIOD + 100;
        await plugin.sendExternalRequest();
        let d = await plugin.getSubscriptionData();
        expect(d.lastPaymentTime).toBe(START + PERIOD + 100);

        // jump to the period after next
        blockchain.now = START + 3 * PERIOD + 50;
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        await plugin.sendExternalRequest();
        d = await plugin.getSubscriptionData();
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('second-period payment delta:', (benAfter - benBefore).toString());
        expect(benAfter).toBeGreaterThan(benBefore);
    });

    it('forward_funds stores the extra-currency dict (pair_second of balance) in the VALUE position - documents the unusual layout', async () => {
        // This is just to confirm the message parses and is accepted (no extra currencies in sandbox => empty dict).
        const { plugin } = await freshPlugin(START);
        blockchain.now = START + PERIOD + 100;
        const res = await plugin.sendExternalRequest();
        // If the cell layout were malformed the wallet/beneficiary txs would fail; assert they succeed.
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, success: true });
    });
});
