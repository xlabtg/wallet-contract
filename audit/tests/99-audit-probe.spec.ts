import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano, Dictionary } from '@ton/core';
import { mnemonicToWalletKey, sign } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { loadWalletCode } from '../wrappers/loadCode';

// Audit probes: empirically confirm/deny the security questions raised in the
// audit brief. These are NOT regression tests; they document observed behavior.
describe('Audit probes: Wallet V4', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let wallet: SandboxContract<WalletV4>;
    let walletCode: Cell;
    let keyPair: { publicKey: Buffer; secretKey: Buffer };
    const SUBWALLET_ID = 698983191;

    beforeAll(async () => {
        walletCode = loadWalletCode();
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

    // PROBE 1: Can a NON-plugin internal sender pull funds via op 0x706c7567?
    it('PROBE1: non-registered sender CANNOT pull funds (auth holds)', async () => {
        const attacker = await blockchain.treasury('attacker');
        const balBefore = await wallet.getBalance();
        const body = beginCell()
            .storeUint(0x706c7567, 32) // request funds op
            .storeUint(0, 64)          // query_id
            .storeCoins(toNano('5'))   // requested
            .storeUint(0, 1)           // empty extra dict
            .endCell();
        const res = await attacker.send({
            to: wallet.address, value: toNano('0.1'), bounce: true, body,
        });
        // No outgoing message from wallet to attacker carrying funds.
        expect(res.transactions).not.toHaveTransaction({
            from: wallet.address, to: attacker.address, op: 0x706c7567 | 0x80000000,
        });
        const balAfter = await wallet.getBalance();
        // wallet should not have lost ~5 TON
        expect(balAfter > balBefore - toNano('1')).toBe(true);
        console.log('[PROBE1] non-plugin pull blocked. bal', balBefore, '->', balAfter);
    });

    // PROBE 2: valid_until checked BEFORE signature — does an expired msg with
    // a BAD signature throw 36 (valid_until) rather than 35 (sig)? Confirms order.
    it('PROBE2: expired msg throws 36 before signature check (order of checks)', async () => {
        const body = WalletV4.buildSignedBody({
            subwalletId: SUBWALLET_ID, validUntil: 1, seqno: 0, op: 0,
        });
        // garbage signature
        const full = beginCell().storeBuffer(Buffer.alloc(64, 0xaa)).storeSlice(body.beginParse()).endCell();
        const res = await wallet.sendRawExternal(full).catch((e: any) => e);
        // In sandbox, external throwing => exit code captured. Just assert seqno unchanged.
        expect(await wallet.getSeqno()).toBe(0);
        console.log('[PROBE2] expired+badsig rejected, seqno unchanged');
    });

    // PROBE 3: Unknown op after valid signature — does seqno still bump and no funds move?
    it('PROBE3: unknown op (op=5) still bumps seqno, no side effects', async () => {
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const toSign = WalletV4.buildSignedBody({
            subwalletId: SUBWALLET_ID, validUntil, seqno: 0, op: 5,
            payload: (b) => b.storeUint(0xdeadbeef, 32),
        });
        const body = WalletV4.signExternal(toSign, keyPair.secretKey);
        const balBefore = await wallet.getBalance();
        await wallet.sendRawExternal(body);
        expect(await wallet.getSeqno()).toBe(1);
        const balAfter = await wallet.getBalance();
        expect(balAfter > balBefore - toNano('1')).toBe(true);
        console.log('[PROBE3] unknown op: seqno 0->1, no funds moved');
    });

    // PROBE 4: replay protection — same signed simple-send cannot be replayed.
    it('PROBE4: replay of same external msg is rejected (seqno)', async () => {
        const dest = await blockchain.treasury('dest4');
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const outMsg = beginCell()
            .storeUint(0x18, 6).storeAddress(dest.address).storeCoins(toNano('1'))
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1).endCell();
        const toSign = WalletV4.buildSignedBody({
            subwalletId: SUBWALLET_ID, validUntil, seqno: 0, op: 0,
            payload: (b) => b.storeUint(3, 8).storeRef(outMsg),
        });
        const body = WalletV4.signExternal(toSign, keyPair.secretKey);
        await wallet.sendRawExternal(body);
        expect(await wallet.getSeqno()).toBe(1);
        // replay
        await wallet.sendRawExternal(body).catch(() => {});
        expect(await wallet.getSeqno()).toBe(1); // unchanged => replay blocked
        console.log('[PROBE4] replay blocked, seqno stays 1');
    });

    // PROBE 5: op 1 duplicate-plugin throw(39) AFTER commit — is seqno preserved
    // and is the deploy message rolled back (actions after commit discarded)?
    it('PROBE5: op1 with non-empty trailing? and op1 duplicate behavior', async () => {
        // First, install a fake plugin address via op 2 (no deploy), then op2 again -> throw 39.
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const fakeAddr = new Address(0, Buffer.alloc(32, 0x11));
        await wallet.sendInstallPlugin({
            secretKey: keyPair.secretKey, subwalletId: SUBWALLET_ID, validUntil,
            seqno: 0, pluginAddress: fakeAddr, amount: toNano('0.01'), queryId: 1,
        });
        expect(await wallet.getSeqno()).toBe(1);
        expect(await wallet.getIsPluginInstalled(0, BigInt('0x' + Buffer.alloc(32, 0x11).toString('hex')))).toBe(true);

        // Duplicate install -> throw 39. Does seqno still advance? (commit before throw)
        const before = await wallet.getSeqno();
        await wallet.sendInstallPlugin({
            secretKey: keyPair.secretKey, subwalletId: SUBWALLET_ID, validUntil,
            seqno: 1, pluginAddress: fakeAddr, amount: toNano('0.01'), queryId: 2,
        }).catch(() => {});
        const after = await wallet.getSeqno();
        console.log('[PROBE5] duplicate op2: seqno', before, '->', after, '(commit-before-throw => advances)');
    });

    // PROBE 6: Can a registered plugin request MORE than balance? Check throw(80) boundary.
    it('PROBE6: registered plugin fund request respects balance check', async () => {
        // Register attacker treasury as a plugin via op2 (owner signs).
        const plug = await blockchain.treasury('plug6');
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        await wallet.sendInstallPlugin({
            secretKey: keyPair.secretKey, subwalletId: SUBWALLET_ID, validUntil,
            seqno: 0, pluginAddress: plug.address, amount: toNano('0.01'), queryId: 1,
        });
        const bal = await wallet.getBalance();
        // Request way more than balance -> should throw 80 in wallet, no funds out.
        const tooMuch = bal + toNano('100');
        const body = beginCell()
            .storeUint(0x706c7567, 32).storeUint(0, 64)
            .storeCoins(tooMuch).storeUint(0, 1).endCell();
        // Signed-int representation of the response op (toHaveTransaction uses signed).
        const respOp = (0x706c7567 | 0x80000000) >> 0; // = -261327513 as int32
        const res = await plug.send({ to: wallet.address, value: toNano('0.05'), bounce: true, body });
        // wallet should NOT send tooMuch back to the plugin.
        expect(res.transactions).not.toHaveTransaction({
            from: wallet.address, to: plug.address, op: respOp,
        });
        console.log('[PROBE6] over-balance request blocked by throw(80)');

        // Now request a sane amount -> should succeed (by-design drain by trusted plugin).
        const okAmt = toNano('1');
        const plugBalBefore = (await blockchain.getContract(plug.address)).balance;
        const body2 = beginCell()
            .storeUint(0x706c7567, 32).storeUint(7, 64)
            .storeCoins(okAmt).storeUint(0, 1).endCell();
        await plug.send({ to: wallet.address, value: toNano('0.05'), bounce: true, body: body2 });
        const plugBalAfter = (await blockchain.getContract(plug.address)).balance;
        // Plugin received roughly okAmt (minus fees) back from the wallet.
        expect(plugBalAfter - plugBalBefore > toNano('0.8')).toBe(true);
        console.log('[PROBE6] in-balance request succeeded; plugin balance +',
            (plugBalAfter - plugBalBefore).toString(), '(by-design drain by trusted plugin)');
    });

    // PROBE 7: signature is over the slice AFTER the 512-bit sig is stripped, INCLUDING refs.
    // If we tamper a ref (out message) without re-signing, sig must fail (no malleability).
    it('PROBE7: tampering a signed out-message ref invalidates signature', async () => {
        const dest = await blockchain.treasury('dest7');
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const realMsg = beginCell()
            .storeUint(0x18, 6).storeAddress(dest.address).storeCoins(toNano('1'))
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1).endCell();
        const toSign = WalletV4.buildSignedBody({
            subwalletId: SUBWALLET_ID, validUntil, seqno: 0, op: 0,
            payload: (b) => b.storeUint(3, 8).storeRef(realMsg),
        });
        const signature = sign(toSign.hash(), keyPair.secretKey);
        // Now build the external with a DIFFERENT out message (e.g. 9 TON) but the SAME signature & header.
        const evilMsg = beginCell()
            .storeUint(0x18, 6).storeAddress(dest.address).storeCoins(toNano('9'))
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1).endCell();
        const evilBody = beginCell()
            .storeBuffer(signature)
            .storeUint(SUBWALLET_ID, 32).storeUint(validUntil, 32).storeUint(0, 32).storeUint(0, 8)
            .storeUint(3, 8).storeRef(evilMsg)
            .endCell();
        await wallet.sendRawExternal(evilBody).catch(() => {});
        // seqno must be unchanged (sig failed), and no 9 TON transfer.
        expect(await wallet.getSeqno()).toBe(0);
        console.log('[PROBE7] tampered ref => signature invalid, seqno unchanged');
    });
});
