# F-05: Plugin `recv_internal` does not explicitly ignore bounced messages

## Vulnerability Details

**Severity**: Informational (defense-in-depth)
**CVSS Score**: 0.0
**CVSS Vector**: N/A
**Vulnerability Type**: CWE-940 (Improper Verification of Source of a Communication Channel) - defense-in-depth only
**Affected Contract**: `func/simple-subscription-plugin.fc`
**Affected Function**: `recv_internal`
**Affected Lines**: `func/simple-subscription-plugin.fc:116-136`

## Description

The plugin parses message flags but does not explicitly return on bounced messages:

```func
var cs = in_msg_cell.begin_parse();
var flags = cs~load_uint(4);
slice s_addr = cs~load_msg_addr();
```

Wallet V4 does include this early return:

```func
if (flags & 1) {
  return ();
}
```

In the current plugin code this is inert because the bounced body does not match any meaningful plugin operation.

## Root Cause

The plugin lacks a defensive `if (flags & 1) return ();` guard in `recv_internal`.

## Impact

- Current financial impact: none verified.
- Current operational impact: none verified.
- Future risk: if future changes make a bounceable outgoing message body collide with a meaningful incoming `op`, lack of a bounce guard could become relevant.

## Proof of Concept (PoC)

### Attack Scenario

There is no current exploit. The PoC sends a bounced payment-request-like message from the wallet address and verifies that it is inert.

### PoC Code

`audit/tests/01-audit-poc.spec.ts` includes `CHECK: bounced payment_request from wallet is harmless (no fund movement)`.

### Expected Behavior

Bounced messages should be ignored explicitly or at least be inert.

### Actual Behavior

The plugin does not explicitly check `flags & 1`, but the current bounced message body is inert and does not move funds or state.

### Transaction Trace

The local TON Sandbox trace shows no outgoing transfer from the plugin to the beneficiary after the bounced message.

## Remediation

### Root Cause Fix

Add an explicit bounce guard at the start of `recv_internal`.

### Code Fix

```func
var flags = cs~load_uint(4);
if (flags & 1) {
  return ();
}
```

### Additional Recommendations

Keep the guard even if current message formats are inert. It is defense-in-depth against future protocol or plugin message changes.

## References

- CWE-940: https://cwe.mitre.org/data/definitions/940.html
- TON bug bounty rules: https://github.com/ton-blockchain/bug-bounty
- TON self-check skill: https://github.com/ton-blockchain/bug-bounty/blob/main/skills/bug-bounty-self-check.md

## Self-Check Validation

- [x] Verified against current TON bug bounty rules and `wallet-contract` source state.
- [x] PoC tested only in local TON Sandbox, not mainnet/testnet.
- [x] Current behavior is inert.
- [x] No fund theft, state corruption, or authorization bypass is demonstrated.
- [x] Remediation is defense-in-depth.
- [x] Classified conservatively as not bounty-ready.

See the adjacent self-check file: [`self-check-report.md`](./self-check-report.md).
