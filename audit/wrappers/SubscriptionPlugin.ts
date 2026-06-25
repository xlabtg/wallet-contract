import {
    Address, beginCell, Cell, Contract, contractAddress, ContractProvider,
    Sender, SendMode,
} from '@ton/core';

// storage$_ wallet:MsgAddressInt beneficiary:MsgAddressInt amount:Grams
//   period:uint32 start_time:uint32 timeout:uint32 last_payment_time:uint32
//   last_request_time:uint32 failed_attempts:uint8 subscription_id:uint32
export type SubscriptionConfig = {
    wallet: Address;
    beneficiary: Address;
    amount: bigint;
    period: number;
    startTime: number;
    timeout: number;
    lastPaymentTime: number;
    lastRequestTime: number;
    failedAttempts: number;
    subscriptionId: number;
};

export function subscriptionConfigToCell(c: SubscriptionConfig): Cell {
    return beginCell()
        .storeAddress(c.wallet)
        .storeAddress(c.beneficiary)
        .storeCoins(c.amount)
        .storeUint(c.period, 32)
        .storeUint(c.startTime, 32)
        .storeUint(c.timeout, 32)
        .storeUint(c.lastPaymentTime, 32)
        .storeUint(c.lastRequestTime, 32)
        .storeUint(c.failedAttempts, 8)
        .storeUint(c.subscriptionId, 32)
        .endCell();
}

export class SubscriptionPlugin implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromConfig(config: SubscriptionConfig, code: Cell, workchain = 0) {
        const data = subscriptionConfigToCell(config);
        const init = { code, data };
        return new SubscriptionPlugin(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint): Promise<any> {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    // Anyone can poke the plugin via external message to request a payment.
    async sendExternalRequest(provider: ContractProvider): Promise<any> {
        return await provider.external(beginCell().endCell());
    }

    // Send a raw internal message (to simulate wallet/beneficiary/attacker).
    async sendInternal(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        body: Cell;
        bounce?: boolean;
        sendMode?: SendMode;
    }): Promise<any> {
        return await provider.internal(via, {
            value: opts.value,
            sendMode: opts.sendMode ?? SendMode.PAY_GAS_SEPARATELY,
            bounce: opts.bounce ?? true,
            body: opts.body,
        });
    }

    async getSubscriptionData(provider: ContractProvider) {
        const res = await provider.get('get_subscription_data', []);
        const wallet = res.stack.readTuple();
        const beneficiary = res.stack.readTuple();
        return {
            walletWc: wallet.readNumber(),
            walletHash: wallet.readBigNumber(),
            beneficiaryWc: beneficiary.readNumber(),
            beneficiaryHash: beneficiary.readBigNumber(),
            amount: res.stack.readBigNumber(),
            period: res.stack.readNumber(),
            startTime: res.stack.readNumber(),
            timeout: res.stack.readNumber(),
            lastPaymentTime: res.stack.readNumber(),
            lastRequestTime: res.stack.readNumber(),
            failedAttempts: res.stack.readNumber(),
            subscriptionId: res.stack.readNumber(),
        };
    }
}
