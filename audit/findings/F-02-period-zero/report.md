# F-02: `period == 0` is not validated before timeslot division

## Vulnerability Details

**Severity**: Low (robustness / hardening)
**CVSS Score**: N/A for bounty eligibility
**CVSS Vector**: N/A
**Vulnerability Type**: CWE-369 (Divide By Zero)
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_external`, `recv_internal`
**Affected Lines**: `func/simple-subscription-plugin.fc:139-140`, `func/simple-subscription-plugin.fc:160-161`

## Description

The subscription `period` value is used as a divisor without a local `period > 0` check:

```func
int last_timeslot = (last_payment_time - start_time) / period;
int cur_timeslot = (now() - start_time) / period;
```

If a plugin instance is initialized with `period == 0`, external payment requests and wallet payment responses fail with a division-by-zero exception.

## Root Cause

The plugin trusts its stored initialization data. `period` is configuration controlled by the plugin deployer/owner flow, not by an arbitrary external attacker.

## Impact

- Financial impact: none verified.
- Operational impact: an incorrectly initialized subscription can become unusable.
- Attacker control: not verified. An arbitrary attacker cannot set `period` for an already deployed plugin.

## Proof of Concept (PoC)

### Attack Scenario

This is not an attacker-controlled attack. The PoC initializes the plugin with `period = 0` in a local sandbox and confirms that external request processing fails.

### PoC Code

`audit/tests/01-audit-poc.spec.ts` includes `FINDING (Info): period==0 is not validated and bricks recv_external (division by zero)`.

### Expected Behavior

The plugin should either reject invalid configuration at initialization or fail with an explicit validation error before division.

### Actual Behavior

The plugin reaches division by zero when processing timeslot arithmetic.

### Transaction Trace

The Jest/Ton Sandbox test expects `plugin.sendExternalRequest()` to throw for `period = 0`.

## Remediation

### Root Cause Fix

Validate `period > 0` in the plugin initialization path and/or defensively in message handlers before timeslot arithmetic.

### Code Fix

```func
throw_unless(<error_code>, period > 0);
```

The check should run before computing `(last_payment_time - start_time) / period` or `(now() - start_time) / period`.

### Additional Recommendations

If initialization code is maintained outside this repository, document that `period` must be non-zero and add an init-level regression test there.

## References

- CWE-369: https://cwe.mitre.org/data/definitions/369.html
- TON bug bounty rules: https://github.com/ton-blockchain/bug-bounty
- TON self-check skill: https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md

## Self-Check Validation

- [x] Verified against current TON bug bounty rules and `wallet-contract` source state.
- [x] PoC tested only in local TON Sandbox, not mainnet/testnet.
- [x] Trigger is operator/owner-controlled configuration, not attacker-controlled input.
- [x] No fund theft or privilege bypass is demonstrated.
- [x] Remediation is practical hardening.
- [x] Classified conservatively as not bounty-ready.

See the adjacent self-check file: [`self-check-report.md`](./self-check-report.md).
