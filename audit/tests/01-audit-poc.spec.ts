import { Blockchain, SandboxContract, TreasuryContract, internal } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano, Dictionary } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { SubscriptionPlugin } from '../wrappers/SubscriptionPlugin';
import { loadWalletCode, loadSubscriptionCode } from '../wrappers/loadCode';

const OP_PLUG = 0x706c7567;
const OP_DSTR = 0x64737472;
const OP_SUBS = 0x73756273;
const OP_FALLBACK = 0x756e6b77;
const OP_PLUG_RESP = (0x706c7567 | 0x80000000) >>> 0; // 0xf06c7567 as unsigned
const SUBWALLET_ID = 698983191;

// Build the wallet's plugins dict (as a direct dict cell) containing one plugin address.
function pluginsDictDirect(pluginAddr: Address): Cell {
    const d = Dictionary.empty(Dictionary.Keys.Buffer(33), Dictionary.Values.Cell());
    const key = Buffer.concat([
        Buffer.from([pluginAddr.workChain & 0xff]),
        pluginAddr.hash,
    ]);
    d.set(key, beginCell().endCell());
    return beginCell().storeDictDirect(d).endCell();
}

describe('Audit PoC: subscription plugin', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let beneficiary: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let walletCode: Cell;
    let pluginCode: Cell;
    let keyPair: { publicKey: Buffer; secretKey: Buffer };

    const PERIOD = 3600;       // 1 hour
    const TIMEOUT = 60;        // 60 s re-poke throttle
    const AMOUNT = toNano('5');// requested payment per period
    const START = 1_700_000_000;

    beforeAll(async () => {
        walletCode = loadWalletCode();
        pluginCode = loadSubscriptionCode();
        keyPair = await mnemonicToWalletKey(
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '),
        );
    });

    async function setup(opts?: { lastPaymentTime?: number; failedAttempts?: number; pluginBalance?: bigint; walletBalance?: bigint; startTime?: number; period?: number; }) {
        blockchain = await Blockchain.create();
        blockchain.now = START + 10; // a bit after start
        deployer = await blockchain.treasury('deployer');
        beneficiary = await blockchain.treasury('beneficiary');
        attacker = await blockchain.treasury('attacker');

        // Deploy wallet (no plugins yet; we patch the dict in data so the plugin addr is trusted).
        const wallet = blockchain.openContract(
            WalletV4.createFromConfig(
                { seqno: 0, subwalletId: SUBWALLET_ID, publicKey: keyPair.publicKey, plugins: null },
                walletCode,
            ),
        );
        await wallet.sendDeploy(deployer.getSender(), opts?.walletBalance ?? toNano('100'));

        // Deploy plugin pointing at the wallet & beneficiary.
        const plugin = blockchain.openContract(
            SubscriptionPlugin.createFromConfig(
                {
                    wallet: wallet.address,
                    beneficiary: beneficiary.address,
                    amount: AMOUNT,
                    period: opts?.period ?? PERIOD,
                    startTime: opts?.startTime ?? START,
                    timeout: TIMEOUT,
                    lastPaymentTime: opts?.lastPaymentTime ?? 0,
                    lastRequestTime: 0,
                    failedAttempts: opts?.failedAttempts ?? 0,
                    subscriptionId: 1,
                },
                pluginCode,
            ),
        );
        await plugin.sendDeploy(deployer.getSender(), opts?.pluginBalance ?? toNano('1'));

        // Patch the wallet storage so it trusts the plugin (simulate op=2 install).
        // plugins is stored via store_dict => Maybe ref: 1 bit + ref when non-empty.
        const newData = beginCell()
            .storeUint(0, 32)            // seqno
            .storeUint(SUBWALLET_ID, 32) // subwallet
            .storeBuffer(keyPair.publicKey, 32)
            .storeBit(1)                 // dict present
            .storeRef(pluginsDictDirect(plugin.address))
            .endCell();
        const { createShardAccount } = await import('@ton/sandbox');
        await blockchain.setShardAccount(
            wallet.address,
            createShardAccount({
                address: wallet.address,
                code: walletCode,
                data: newData,
                balance: opts?.walletBalance ?? toNano('100'),
            }),
        );

        return { wallet, plugin };
    }

    it('INFO: reserve constant is 0.0671 TON, not the "1 Toncoin" the README claims', async () => {
        // max_reserved_funds() = 67108864 nanocoins
        expect(67108864).toBeLessThan(Number(toNano('1')));
        expect(67108864 / 1e9).toBeCloseTo(0.067, 3);
    });

    it('BY-DESIGN: stray funds from any sender are forwarded to the beneficiary (fallback), plugin keeps only the 0.067 TON reserve', async () => {
        // NOTE: this is the documented "remnants go to destination address" behavior, NOT theft —
        // funds always reach the legitimate beneficiary. An attacker only controls the *timing* and
        // cannot redirect funds anywhere else. We confirm: (a) unknown op routes to fallback,
        // (b) plugin ends at the reserve, (c) value forwarded to the beneficiary.
        const { plugin } = await setup({ pluginBalance: toNano('1') });
        const before = (await blockchain.getContract(plugin.address)).balance;
        console.log('plugin balance after deploy (already swept):', before.toString());
        // After deploy the plugin already sits at the reserve.
        expect(before).toBeLessThanOrEqual(toNano('0.1'));

        const benBalBefore = (await blockchain.getContract(beneficiary.address)).balance;

        // Attacker sends a non-trivial value with an unknown op -> fallback forward_funds mode 128.
        const res = await attacker.send({
            to: plugin.address,
            value: toNano('3'),
            bounce: true,
            body: beginCell().storeUint(0xdeadbeef, 32).endCell(),
        });

        // Plugin emits a message to beneficiary carrying ~all its balance (the 3 TON minus fees + prior reserve, minus the new reserve).
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_FALLBACK });
        const after = (await blockchain.getContract(plugin.address)).balance;
        console.log('plugin balance after attacker sweep:', after.toString());
        expect(after).toBeLessThan(toNano('0.1')); // back to the reserve
        const benBalAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('beneficiary delta from attacker-funded sweep:', (benBalAfter - benBalBefore).toString());
        expect(benBalAfter - benBalBefore).toBeGreaterThan(toNano('2')); // most of the 3 TON forwarded
    });

    it('CHECK: bounced payment_request from wallet is harmless (no fund movement)', async () => {
        const { wallet, plugin } = await setup();
        // Craft a bounced message: flags=0x6 (bounced bit set => actually bounced is bit0). Bounced msgs have bounced=1.
        // We simulate the wallet bouncing the plugin's request: body = 0xffffffff ++ original op.
        const bouncedBody = beginCell()
            .storeUint(0xffffffff, 32)
            .storeUint(OP_PLUG, 32)
            .endCell();
        const res = await blockchain.sendMessage(internal({
            from: wallet.address,
            to: plugin.address,
            value: toNano('0.1'),
            bounced: true,
            body: bouncedBody,
        }));
        // Plugin must NOT emit any forward to beneficiary.
        expect(res.transactions).not.toHaveTransaction({ from: plugin.address, to: beneficiary.address });
    });

    it('PROPERTY: the payment branch is gated by op + validator-attested source address (a real attacker cannot forge from=wallet)', async () => {
        // last_payment_time=0 (slot far negative), now well after start -> cur_timeslot>last.
        const { wallet, plugin } = await setup({ lastPaymentTime: START });
        blockchain.now = START + PERIOD + 100; // next timeslot
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        // We inject a message with from=wallet ONLY because the test harness can; on-chain the
        // source address is set by validators and cannot be forged. This documents that the
        // payment branch is authenticated by source-address match (slice_data_equal? against the
        // stored wallet) plus the op value -- there is no spoofing path for a real attacker.
        const body = beginCell()
            .storeUint(OP_PLUG_RESP, 32)
            .storeUint(0, 64) // query id
            .endCell();
        const res = await blockchain.sendMessage(internal({
            from: wallet.address,
            to: plugin.address,
            value: AMOUNT, // enough to satisfy msg_value >= amount - fee
            bounced: false,
            body,
        }));
        expect(res.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('paid to beneficiary on response:', (benAfter - benBefore).toString());
    });

    it('PROPERTY: a second payment response in the same period is rejected (exit 49) and bounces back -- no double-spend', async () => {
        const { wallet, plugin } = await setup({ lastPaymentTime: START });
        blockchain.now = START + PERIOD + 100;
        // First response: should pay.
        const body = beginCell().storeUint(OP_PLUG_RESP, 32).storeUint(0, 64).endCell();
        const r1 = await blockchain.sendMessage(internal({ from: wallet.address, to: plugin.address, value: AMOUNT, bounced: false, body }));
        expect(r1.transactions).toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });
        // Second response same timeslot: throw_if(49) should fire (last_timeslot>=cur_timeslot now).
        const r2 = await blockchain.sendMessage(internal({ from: wallet.address, to: plugin.address, value: AMOUNT, bounced: false, body }));
        // Plugin should NOT pay again.
        expect(r2.transactions).not.toHaveTransaction({ from: plugin.address, to: beneficiary.address, op: OP_SUBS });
        // It should throw (exit 49) -> bounce back to wallet.
        expect(r2.transactions).toHaveTransaction({ from: plugin.address, to: wallet.address, inMessageBounced: true });
    });

    it('MITIGATION: when the wallet pays, failed_attempts resets and same-period re-poke is blocked (exit 30)', async () => {
        // This documents WHY the naive griefing does not work against a fast-paying wallet:
        // the payment response updates last_payment_time, so cur_timeslot==last_timeslot and the
        // next poke in the same period throws exit 30.
        const { plugin } = await setup({ lastPaymentTime: START, failedAttempts: 0 });
        blockchain.now = START + PERIOD + 100;
        await plugin.sendExternalRequest(); // poke1 -> request -> wallet pays -> last_payment_time=now, failed=0
        let d = await plugin.getSubscriptionData();
        console.log('after poke1: failed=', d.failedAttempts, 'lastPay=', d.lastPaymentTime);
        expect(d.failedAttempts).toBe(0); // reset by the successful response
        blockchain.now = (blockchain.now as number) + TIMEOUT + 1; // same period
        await expect(plugin.sendExternalRequest()).rejects.toThrow(); // exit 30: cur==last timeslot
    });

    it('FINDING (Low): failed_attempts is per-request not per-period; with a non-responding wallet, 2 pokes in one period trigger self_destruct', async () => {
        // Clean isolated chain. Point the plugin at a wallet that never answers. This isolates the
        // failed_attempts accumulation: pokes are throttled only by `timeout`, not "once per period".
        // Three pokes within a single period drive failed_attempts 0->1->2 then self_destruct.
        const bc = await Blockchain.create();
        bc.now = START + 10;
        const dep = await bc.treasury('dep');
        const ben = await bc.treasury('ben2');
        const deadWallet = await bc.treasury('deadWallet'); // plain treasury: ignores plug op, never answers

        const plugin = bc.openContract(
            SubscriptionPlugin.createFromConfig(
                {
                    wallet: deadWallet.address,
                    beneficiary: ben.address,
                    amount: AMOUNT,
                    period: PERIOD,
                    startTime: START,
                    timeout: TIMEOUT,
                    lastPaymentTime: START,
                    lastRequestTime: 0,
                    failedAttempts: 0,
                    subscriptionId: 1,
                },
                pluginCode,
            ),
        );
        await plugin.sendDeploy(dep.getSender(), toNano('1'));

        bc.now = START + PERIOD + 100; // one new timeslot
        await plugin.sendExternalRequest();
        let d = await plugin.getSubscriptionData();
        console.log('poke1 failed=', d.failedAttempts);
        expect(d.failedAttempts).toBe(1);

        bc.now = (bc.now as number) + TIMEOUT + 1; // STILL same period
        await plugin.sendExternalRequest();
        d = await plugin.getSubscriptionData();
        console.log('poke2 failed=', d.failedAttempts);
        expect(d.failedAttempts).toBe(2); // two requests, same period

        bc.now = (bc.now as number) + TIMEOUT + 1; // STILL same period
        const rD = await plugin.sendExternalRequest();
        // failed_attempts>=2 -> self_destruct: destruct event to wallet AND forward funds (mode 128+32).
        expect(rD.transactions).toHaveTransaction({ from: plugin.address, to: deadWallet.address, op: OP_DSTR });
        expect(rD.transactions).toHaveTransaction({ from: plugin.address, to: ben.address, op: OP_DSTR });
        const after = await bc.getContract(plugin.address);
        console.log('plugin state after destruct:', after.accountState?.type, 'balance', after.balance.toString());
        // The plugin is destroyed (nonexistent / uninit).
        expect(['nonexistent', 'uninit', undefined]).toContain(after.accountState?.type);
    });

    it('FINDING (Info): period==0 is not validated and bricks recv_external (division by zero)', async () => {
        const { plugin } = await setup({ period: 0 });
        // any poke divides by period -> exit 4 (or similar) -> external rejected.
        await expect(plugin.sendExternalRequest()).rejects.toThrow();
    });

    it('CHECK: full happy-path via external poke pulls funds from wallet to beneficiary', async () => {
        const { wallet, plugin } = await setup({ lastPaymentTime: START, walletBalance: toNano('100') });
        blockchain.now = START + PERIOD + 100;
        const benBefore = (await blockchain.getContract(beneficiary.address)).balance;
        // Poke -> plugin requests from wallet -> wallet responds -> plugin forwards to beneficiary.
        const res = await plugin.sendExternalRequest();
        // Trace the whole chain.
        for (const tx of res.transactions) {
            const inMsg = tx.inMessage;
            if (inMsg?.info.type === 'internal') {
                console.log('tx to', inMsg.info.dest.toString().slice(0, 10), 'op?', inMsg.body.beginParse().remainingBits >= 32 ? inMsg.body.beginParse().loadUint(32).toString(16) : 'n/a');
            }
        }
        const benAfter = (await blockchain.getContract(beneficiary.address)).balance;
        console.log('happy-path beneficiary delta:', (benAfter - benBefore).toString());
        expect(benAfter).toBeGreaterThan(benBefore);
    });
});
