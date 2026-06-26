import {
    Address, beginCell, Cell, Contract, contractAddress, ContractProvider,
    Sender, SendMode, Builder, Slice, Dictionary, toNano,
} from '@ton/core';
import { sign } from '@ton/crypto';

export type WalletV4Config = {
    seqno: number;
    subwalletId: number;
    publicKey: Buffer; // 32 bytes
    plugins?: Cell | null;
};

export function walletV4ConfigToCell(config: WalletV4Config): Cell {
    return beginCell()
        .storeUint(config.seqno, 32)
        .storeUint(config.subwalletId, 32)
        .storeBuffer(config.publicKey, 32)
        .storeMaybeRef(config.plugins ?? null) // store_dict of empty dict == maybe ref null
        .endCell();
}

// A request action inside the signed external message (op 0: simple send).
export type OutAction = { mode: number; message: Cell };

export class WalletV4 implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromConfig(config: WalletV4Config, code: Cell, workchain = 0) {
        const data = walletV4ConfigToCell(config);
        const init = { code, data };
        return new WalletV4(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint): Promise<any> {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // Build the body that is signed (everything after the 512-bit signature).
    static buildSignedBody(opts: {
        subwalletId: number;
        validUntil: number;
        seqno: number;
        op: number;
        payload?: (b: Builder) => void;
    }): Cell {
        const b = beginCell()
            .storeUint(opts.subwalletId, 32)
            .storeUint(opts.validUntil, 32)
            .storeUint(opts.seqno, 32)
            .storeUint(opts.op, 8);
        if (opts.payload) opts.payload(b);
        return b.endCell();
    }

    static signExternal(toSign: Cell, secretKey: Buffer): Cell {
        const signature = sign(toSign.hash(), secretKey);
        return beginCell().storeBuffer(signature).storeSlice(toSign.beginParse()).endCell();
    }

    // op 0: simple send of arbitrary messages.
    async sendSimple(provider: ContractProvider, opts: {
        secretKey: Buffer;
        subwalletId: number;
        validUntil: number;
        seqno: number;
        actions: OutAction[];
    }) {
        const toSign = WalletV4.buildSignedBody({
            subwalletId: opts.subwalletId,
            validUntil: opts.validUntil,
            seqno: opts.seqno,
            op: 0,
            payload: (b) => {
                for (const a of opts.actions) {
                    b.storeUint(a.mode, 8).storeRef(a.message);
                }
            },
        });
        const body = WalletV4.signExternal(toSign, opts.secretKey);
        return await provider.external(body);
    }

    // op 2: install (already-deployed) plugin by address.
    async sendInstallPlugin(provider: ContractProvider, opts: {
        secretKey: Buffer;
        subwalletId: number;
        validUntil: number;
        seqno: number;
        pluginAddress: Address;
        amount: bigint;
        queryId?: number | bigint;
    }) {
        const toSign = WalletV4.buildSignedBody({
            subwalletId: opts.subwalletId,
            validUntil: opts.validUntil,
            seqno: opts.seqno,
            op: 2,
            payload: (b) => {
                b.storeInt(opts.pluginAddress.workChain, 8)
                 .storeUint(BigInt('0x' + opts.pluginAddress.hash.toString('hex')), 256)
                 .storeCoins(opts.amount)
                 .storeUint(BigInt(opts.queryId ?? 0), 64);
            },
        });
        const body = WalletV4.signExternal(toSign, opts.secretKey);
        return await provider.external(body);
    }

    // op 3: remove plugin by address.
    async sendRemovePlugin(provider: ContractProvider, opts: {
        secretKey: Buffer;
        subwalletId: number;
        validUntil: number;
        seqno: number;
        pluginAddress: Address;
        amount: bigint;
        queryId?: number | bigint;
    }) {
        const toSign = WalletV4.buildSignedBody({
            subwalletId: opts.subwalletId,
            validUntil: opts.validUntil,
            seqno: opts.seqno,
            op: 3,
            payload: (b) => {
                b.storeInt(opts.pluginAddress.workChain, 8)
                 .storeUint(BigInt('0x' + opts.pluginAddress.hash.toString('hex')), 256)
                 .storeCoins(opts.amount)
                 .storeUint(BigInt(opts.queryId ?? 0), 64);
            },
        });
        const body = WalletV4.signExternal(toSign, opts.secretKey);
        return await provider.external(body);
    }

    // Raw external sender (for crafting malicious / malformed messages).
    async sendRawExternal(provider: ContractProvider, body: Cell): Promise<any> {
        return await provider.external(body);
    }

    async getSeqno(provider: ContractProvider): Promise<number> {
        const res = await provider.get('seqno', []);
        return res.stack.readNumber();
    }

    async getPublicKey(provider: ContractProvider): Promise<bigint> {
        const res = await provider.get('get_public_key', []);
        return res.stack.readBigNumber();
    }

    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = await provider.get('get_subwallet_id', []);
        return res.stack.readNumber();
    }

    async getIsPluginInstalled(provider: ContractProvider, wc: number, addrHash: bigint): Promise<boolean> {
        const res = await provider.get('is_plugin_installed', [
            { type: 'int', value: BigInt(wc) },
            { type: 'int', value: addrHash },
        ]);
        return res.stack.readBoolean();
    }

    async getBalance(provider: ContractProvider): Promise<bigint> {
        const state = await provider.getState();
        return state.balance;
    }
}
