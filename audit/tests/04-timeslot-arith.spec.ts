import { Blockchain, SandboxContract, TreasuryContract, createShardAccount } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano, Dictionary } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { SubscriptionPlugin } from '../wrappers/SubscriptionPlugin';
import { loadWalletCode, loadSubscriptionCode } from '../wrappers/loadCode';

const OP_PLUG = 0x706c7567;
const SUBWALLET_ID = 698983191;
const PERIOD = 3600, TIMEOUT = 60, START = 1_700_000_000;
const AMOUNT = toNano('5');

function pluginsDictDirect(p: Address): Cell {
    const d = Dictionary.empty(Dictionary.Keys.Buffer(33), Dictionary.Values.Cell());
    d.set(Buffer.concat([Buffer.from([p.workChain & 0xff]), p.hash]), beginCell().endCell());
    return beginCell().storeDictDirect(d).endCell();
}

describe('Audit PoC: timeslot arithmetic edge cases', () => {
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

    async function mk(opts: { now: number; lastPaymentTime: number; startTime: number; period?: number; failedAttempts?: number }) {
        blockchain = await Blockchain.create();
        blockchain.now = opts.now;
        deployer = await blockchain.treasury('deployer');
        beneficiary = await blockchain.treasury('beneficiary');
        const wallet = blockchain.openContract(WalletV4.createFromConfig({ seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null }, walletCode));
        await wallet.sendDeploy(deployer.getSender(), toNano('100'));
        const plugin = blockchain.openContract(SubscriptionPlugin.createFromConfig({
            wallet: wallet.address, beneficiary: beneficiary.address, amount: AMOUNT,
            period: opts.period ?? PERIOD, startTime: opts.startTime, timeout: TIMEOUT,
            lastPaymentTime: opts.lastPaymentTime, lastRequestTime: 0, failedAttempts: opts.failedAttempts ?? 0, subscriptionId: 1,
        }, pluginCode));
        await plugin.sendDeploy(deployer.getSender(), toNano('1'));
        const data = beginCell().storeUint(0, 32).storeUint(SUBWALLET_ID, 32).storeBuffer(keyPair.publicKey, 32).storeBit(1).storeRef(pluginsDictDirect(plugin.address)).endCell();
        await blockchain.setShardAccount(wallet.address, createShardAccount({ address: wallet.address, code: walletCode, data, balance: toNano('100') }));
        return { wallet, plugin };
    }

    it('FINDING (Low, init-contingent): a FUTURE start_time with last_payment_time=0 activates early (now < start_time)', async () => {
        // start_time far in the future, but a poke now still passes the timing check because
        // cur_timeslot (=(now-start)/period) > last_timeslot (=(0-start)/period), since now>0.
        const futureStart = START + 10 * PERIOD; // starts in 10 periods
        const { wallet, plugin } = await mk({ now: START + 5, lastPaymentTime: 0, startTime: futureStart });
        // now (START+5) is well BEFORE futureStart; an honest scheduler should reject, but the plugin accepts.
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        const res = await plugin.sendExternalRequest();
        // It accepted and fired a payment request at the wallet => premature activation.
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: wallet.address, op: OP_PLUG });
        const d = await plugin.getSubscriptionData();
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('FUTURE-start: failedAttempts=', d.failedAttempts, 'lastRequestTime=', d.lastRequestTime, 'lastPaymentTime=', d.lastPaymentTime, 'benDelta=', (benAfter - benBefore).toString());
        // The wallet actually paid: lastPaymentTime advanced and the beneficiary got funds BEFORE start_time.
        expect(d.lastRequestTime).toBe(START + 5);          // poke accepted before start_time
        expect(benAfter).toBeGreaterThan(benBefore);        // payment forwarded prematurely
    });

    it('CONTROL: with last_payment_time = start_time and now < start_time, the poke is correctly rejected (exit 30)', async () => {
        // This shows the early-activation only happens because last_payment_time is left at 0 in init.
        const futureStart = START + 10 * PERIOD;
        const { plugin } = await mk({ now: START + 5, lastPaymentTime: START + 10 * PERIOD, startTime: futureStart });
        await expect(plugin.sendExternalRequest()).rejects.toThrow(); // cur_timeslot <= last_timeslot -> exit 30
    });

    it('CHECK: when last_payment_time=0 and start_time<=now, the very first poke pays in the current slot (by design)', async () => {
        const { wallet, plugin } = await mk({ now: START + 100, lastPaymentTime: 0, startTime: START });
        const res = await plugin.sendExternalRequest();
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: wallet.address, op: OP_PLUG });
    });
});
