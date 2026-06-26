# F-04: `failed_attempts` counts requests, not missed periods

## Vulnerability Details

**Severity**: Low
**CVSS Score**: N/A for bounty eligibility
**CVSS Vector**: N/A
**Vulnerability Type**: CWE-840 (Business Logic Errors)
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`
**Affected Lines**: `func/simple-subscription-plugin.fc:162-170`

## Description

`recv_external` is permissionless. Each accepted external request increments `failed_attempts` when no successful wallet payment resets it:

```func
throw_unless(30, (cur_timeslot > last_timeslot) & (last_request_time + timeout < now()));
accept_message();
if (failed_attempts >= max_failed_attempts()) {
  self_destruct(wallet, beneficiary);
} else {
  request_payment(wallet, amount);
  failed_attempts += 1;
}
```

The counter therefore counts accepted requests, not missed billing periods. Against a non-responding wallet, repeated requests in the same period can reach `max_failed_attempts()` and destroy the subscription.

## Root Cause

The contract stores only `failed_attempts`, not the last attempted period. The throttle is `timeout`, so more than one request can occur in a single payment period when the wallet does not pay.

## Impact

- Financial impact: no theft. `self_destruct` sends the remaining funds to the configured `beneficiary` and sends a destruct notification to the configured `wallet`.
- Operational impact: a subscription that is already failing to receive wallet payments can be terminated earlier than "missed periods" semantics might imply.
- Attacker benefit: minimal to none. An attacker can trigger requests, but cannot redirect funds.

## Proof of Concept (PoC)

### Attack Scenario

Point the plugin at a wallet-like address that does not answer payment requests. Send three external requests separated by `timeout` but still inside one `period`.

### PoC Code

`audit/tests/01-audit-poc.spec.ts` includes:

- `FINDING (Low): failed_attempts is per-request not per-period`
- `MITIGATION: when the wallet pays, failed_attempts resets and same-period re-poke is blocked`

### Expected Behavior

If the intended semantics are missed periods, only one failed attempt should be counted per period.

### Actual Behavior

For a non-responding wallet, multiple accepted requests in the same period increment `failed_attempts` and can trigger `self_destruct`.

### Transaction Trace

The local TON Sandbox trace shows two request attempts increasing `failed_attempts` to 2 and the third request emitting destruct messages to the wallet and beneficiary.

## Remediation

### Root Cause Fix

Track the last attempted timeslot and increment `failed_attempts` only when a new period is attempted, or require `timeout >= period` if request-level counting is intended.

### Code Fix

```func
if (cur_timeslot > last_attempt_timeslot) {
  failed_attempts += 1;
  last_attempt_timeslot = cur_timeslot;
}
```

This requires adding a storage field such as `last_attempt_timeslot`.

### Additional Recommendations

Document whether `max_failed_attempts()` is meant to count missed periods or request attempts. Keep the current behavior if request-attempt semantics are intentional.

## References

- CWE-840: https://cwe.mitre.org/data/definitions/840.html
- TON bug bounty rules: https://github.com/ton-blockchain/bug-bounty
- TON self-check skill: https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md

## Self-Check Validation

- [x] Verified against current TON bug bounty rules and `wallet-contract` source state.
- [x] PoC tested only in local TON Sandbox, not mainnet/testnet.
- [x] Trigger is permissionless, but the impact requires a non-paying wallet.
- [x] No fund theft or redirection is demonstrated.
- [x] Healthy paying subscription behavior is covered by a mitigation/control test.
- [x] Classified conservatively as not bounty-ready.

See the adjacent self-check file: [`self-check-report.md`](./self-check-report.md).
