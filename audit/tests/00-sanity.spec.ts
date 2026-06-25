import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { mnemonicToWalletKey } from '@ton/crypto';
import '@ton/test-utils';
import { WalletV4 } from '../wrappers/WalletV4';
import { loadWalletCode } from '../wrappers/loadCode';

// Sanity checks: the harness compiles, deploys, and the wallet behaves as the
// canonical Wallet V4 R2 (seqno bump, signature gating, simple send).
describe('Sanity: Wallet V4 harness', () => {
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

    it('reports configured seqno / subwallet / public key', async () => {
        expect(await wallet.getSeqno()).toBe(0);
        expect(await wallet.getSubwalletId()).toBe(SUBWALLET_ID);
        expect(await wallet.getPublicKey()).toBe(
            BigInt('0x' + keyPair.publicKey.toString('hex')),
        );
    });

    it('performs a valid signed simple send and bumps seqno', async () => {
        const dest = await blockchain.treasury('dest');
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        const outMsg = beginCell()
            .storeUint(0x18, 6)
            .storeAddress(dest.address)
            .storeCoins(toNano('1'))
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell();

        const res = await wallet.sendSimple({
            secretKey: keyPair.secretKey,
            subwalletId: SUBWALLET_ID,
            validUntil,
            seqno: 0,
            actions: [{ mode: 3, message: outMsg }],
        });
        expect(res.transactions).toHaveTransaction({ from: wallet.address, to: dest.address, success: true });
        expect(await wallet.getSeqno()).toBe(1);
    });

    it('rejects an external message signed with the wrong key (exit 35)', async () => {
        const wrong = await mnemonicToWalletKey(
            'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'.split(' '),
        );
        const validUntil = Math.floor(Date.now() / 1000) + 3600;
        await expect(
            wallet.sendSimple({
                secretKey: wrong.secretKey,
                subwalletId: SUBWALLET_ID,
                validUntil,
                seqno: 0,
                actions: [],
            }),
        ).rejects.toThrow();
        // seqno unchanged
        expect(await wallet.getSeqno()).toBe(0);
    });
});
