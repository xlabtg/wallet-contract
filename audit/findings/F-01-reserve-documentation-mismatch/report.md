# F-01: README promises a 1 TON reserve, but the plugin reserves about 0.067 TON

## Vulnerability Details

**Severity**: Informational
**CVSS Score**: 0.0 (N/A - documentation mismatch without security impact)
**CVSS Vector**: N/A
**Vulnerability Type**: CWE-1059 (Insufficient/Incorrect Documentation)
**Affected Contract**: `func/simple-subscription-plugin.fc`; `README.md`
**Affected Function**: `forward_funds`, `max_reserved_funds`
**Affected Lines**: `func/simple-subscription-plugin.fc:12`, `func/simple-subscription-plugin.fc:67`, `README.md:25`

## Description

The README says the subscription plugin leaves 1 Toncoin on the plugin balance until destruction. The code actually reserves `67108864` nanotons, about 0.067 TON:

```func
int max_reserved_funds() asm "67108864 PUSHINT"; ;; 0.0671 TON
...
raw_reserve(max_reserved_funds(), 2); ;; reserve at most `max_reserved_funds` nanocoins
```

This is a documentation/code mismatch, not a fund theft or authorization issue.

## Root Cause

The README text was not updated to match the `max_reserved_funds()` constant in `simple-subscription-plugin.fc`.

## Impact

- Financial impact: none verified. Funds are forwarded to the configured `beneficiary`, not to an attacker.
- Operational impact: integrators may incorrectly assume that the plugin keeps about 1 TON for storage fees, while the actual reserve is about 0.067 TON.

## Proof of Concept (PoC)

### Attack Scenario

There is no attack scenario. The PoC demonstrates the actual retained balance after forwarding.

### PoC Code

`audit/tests/02-deploy-sweep.spec.ts` deploys/funds the plugin and verifies that the plugin balance is below `0.1 TON`, not around `1 TON`.

### Expected Behavior

The README should describe the same reserve value that the contract enforces.

### Actual Behavior

The README says 1 Toncoin remains on the plugin balance, while the contract reserves about 0.067 TON.

### Transaction Trace

The local TON Sandbox trace in `audit/tests/02-deploy-sweep.spec.ts` shows fallback forwarding to the configured `beneficiary` and a remaining plugin balance below `0.1 TON`.

## Remediation

### Root Cause Fix

Update the README wording to say about 0.067 TON, or change the code constant if the intended reserve is 1 TON.

### Code Fix

If the intended behavior is documentation-only, update `README.md`.

If the intended behavior is to reserve 1 TON:

```func
int max_reserved_funds() asm "1000000000 PUSHINT"; ;; 1 TON
```

### Additional Recommendations

Keep the reserve value in documentation and code synchronized. If possible, add a small regression test that documents the expected reserve.

## References

- CWE-1059: https://cwe.mitre.org/data/definitions/1059.html
- TON bug bounty rules: https://github.com/ton-blockchain/bug-bounty
- TON self-check skill: https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md

## Self-Check Validation

- [x] Verified against current TON bug bounty rules and `wallet-contract` source state.
- [x] Confirmed this is not a Critical/High/Medium bounty vulnerability.
- [x] PoC tested only in local TON Sandbox, not mainnet/testnet.
- [x] Impact assessment is limited to documentation mismatch.
- [x] Remediation is practical and does not change security assumptions.
- [x] No false positive submitted as a security vulnerability.

See the adjacent self-check file: [`self-check-report.md`](./self-check-report.md).
