# F-03: Future `start_time` with `last_payment_time = 0` can activate early

## Vulnerability Details

**Severity**: Low (init-contingent)
**CVSS Score**: N/A for bounty eligibility
**CVSS Vector**: N/A
**Vulnerability Type**: CWE-191 (Integer Underflow) / business logic timing issue
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`
**Affected Lines**: `func/simple-subscription-plugin.fc:160-162`

## Description

The plugin computes timeslots using possibly negative numerators:

```func
int last_timeslot = (last_payment_time - start_time) / period;
int cur_timeslot = (now() - start_time) / period;
throw_unless(30, (cur_timeslot > last_timeslot) & (last_request_time + timeout < now()));
```

If `start_time` is in the future and `last_payment_time = 0`, then `last_timeslot` can be far below `cur_timeslot`, so an external request can pass before `start_time`.

## Root Cause

`last_payment_time = 0` is ambiguous when `start_time` is in the future. Correctly initializing `last_payment_time` to `start_time`, or explicitly checking `now() >= start_time`, prevents the early request.

## Impact

- Financial impact: no theft. Funds are paid only to the configured `beneficiary`.
- Operational impact: payment can be requested before the intended start time if the plugin is initialized with future `start_time` and `last_payment_time = 0`.
- Attacker control: partial trigger only. Anyone can poke the plugin, but the vulnerable state is created by initialization/configuration, not by the attacker.

## Proof of Concept (PoC)

### Attack Scenario

In local sandbox, deploy a plugin with `start_time` in the future and `last_payment_time = 0`, then send an external request before `start_time`.

### PoC Code

`audit/tests/04-timeslot-arith.spec.ts` includes:

- `FINDING (Low, init-contingent): a FUTURE start_time with last_payment_time=0 activates early`
- `CONTROL: with last_payment_time = start_time and now < start_time, the poke is correctly rejected`

### Expected Behavior

No subscription payment should be requested before `start_time`.

### Actual Behavior

With `last_payment_time = 0`, a request before `start_time` is accepted and the wallet pays the configured beneficiary.

### Transaction Trace

The local TON Sandbox trace shows an outgoing payment request from the plugin to the wallet before `start_time`, followed by beneficiary balance increase.

## Remediation

### Root Cause Fix

Initialize `last_payment_time` to `start_time` when a future start time is configured, or add an explicit runtime guard.

### Code Fix

```func
throw_unless(<error_code>, now() >= start_time);
```

Alternatively, enforce this invariant in initialization:

```func
last_payment_time = start_time;
```

### Additional Recommendations

Document initialization invariants for `start_time`, `last_payment_time`, and `period`, and test those invariants in the deployment tooling.

## References

- CWE-191: https://cwe.mitre.org/data/definitions/191.html
- TON bug bounty rules: https://github.com/ton-blockchain/bug-bounty
- TON self-check skill: https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md

## Self-Check Validation

- [x] Verified against current TON bug bounty rules and `wallet-contract` source state.
- [x] PoC tested only in local TON Sandbox, not mainnet/testnet.
- [x] Correct initialization prevents the behavior.
- [x] No fund theft or privilege bypass is demonstrated.
- [x] Attacker cannot create the required initialization state for an already deployed plugin.
- [x] Classified conservatively as not bounty-ready.

See the adjacent self-check file: [`self-check-report.md`](./self-check-report.md).
