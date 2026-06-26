# TON Bug Bounty Self-Check Report

## Short Assessment

DO NOT SEND!!!
Status: incorrect.
Confidence: 92.
Fit bug bounty confidence: 94.
Component: Wallet V4 reference subscription plugin.
Class: not attacker controlled.
Self-check report: audit/findings/F-03-future-start-time/self-check-report.md.

## Repository State

- Analysis date UTC: 2026-06-26 11:13:05 UTC
- Input: `audit/findings/F-03-future-start-time/report.md`
- Bug bounty rules repository: https://github.com/ton-blockchain/bug-bounty
- Bug bounty rules commit: `52db73b98ffd3173ecdbb21da770f15540e413c0`
- Repositories analyzed:
  - https://github.com/ton-blockchain/wallet-contract, branch `main`, commit `68b56dc0f7f6a9d41a190a4c91f6dc68b18f0600`, submodules not present.
  - https://github.com/ton-blockchain/wallet-contract, tag `v4r2-stable`, commit `3fd1d7ae39f1c46ec1f2be54c4040d8d87505e0f`, submodules not present.
  - https://github.com/xlabtg/wallet-contract, branch `issue-1-03130b6209a6`, commit `792c97b3ea2427236e20524101eb7e0d519aca77`, submodules not present.
- Local modification warnings: PR branch contains audit harness/report additions. Contract sources differ from upstream `v4r2-stable` only by `#pragma version =0.2.0` lines that the local compiler strips in memory.
- Fetch/build limitations: official `wallet-contract` default branch `main` currently contains no contract source files; the audited Wallet V4 R2 source is the `v4r2-stable` tag and the PR branch copy.

## Scope Validation

- Target component: Wallet V4 reference subscription plugin.
- In scope: uncertain. Bug bounty rules list Wallet V4 and subscription smart contracts, but also state that wallet plugins are examples and out of scope.
- Eligible category: no.
- Redirect required: none.
- Relevant exclusions or warnings: requires an init-contingent state; no attacker can set `start_time`/`last_payment_time` on an existing plugin; no security-critical impact is shown.

## Technical Finding Summary

If the plugin is initialized with future `start_time` and `last_payment_time = 0`, timeslot arithmetic allows a payment request before the intended start time.

## Vulnerability Existence

- Exact files/functions: `recv_external` at `func/simple-subscription-plugin.fc:158-170`.
- Verified code path: `last_timeslot` and `cur_timeslot` are computed from stored timestamps and `period`, then compared in the external request gate.
- Attacker-controlled input path: partial only. Anyone can call `recv_external`, but the required state (`start_time` future, `last_payment_time = 0`) is initialization-controlled.
- Assumptions: the plugin is deployed with future `start_time` and `last_payment_time = 0`. The control test shows `last_payment_time = start_time` prevents the behavior.
- Already fixed: upstream tag `v4r2-stable` commit message indicates start time handling in init state, but the audited standalone plugin source still relies on stored values. Bounty eligibility remains rejected because the trigger is not attacker controlled and impact is low.

## Reproducibility

- Reproduced: yes.
- Reproduction method: local TON Sandbox through `audit/tests/04-timeslot-arith.spec.ts`.
- Reproduction confidence: 94.
- Missing reproduction evidence: no missing evidence for init-contingent behavior; missing attacker-controlled path and concrete security impact.
- Live-target testing avoided: yes; local sandbox only, no mainnet/testnet interaction.

## Bug Bounty Eligibility

- Technical validity: valid under the specified initialization state.
- Bounty eligibility: not eligible.
- Realistic attacker prerequisites: no for creating the vulnerable state; yes only for sending a permissionless poke after the owner-created state exists.
- Security impact: early payment to the configured beneficiary; no theft, no attacker profit, no auth bypass.
- Low-priority notes: timing/invariant issue, not a Critical/High/Medium bounty vulnerability.

## Severity and Claim Validation

- Claimed impact/severity: Low init-contingent.
- Validated impact: early activation before `start_time` under owner-controlled initialization.
- Overclaiming or downgrade notes: claiming fund theft or attacker-controlled DoS would be unsupported.

## Report Completeness Check

- Title: present.
- Summary: present.
- Affected component: present.
- Affected commit: filled with latest analyzed commits in this self-check.
- Affected files/functions: present.
- Attack prerequisites: present.
- Trigger conditions: present.
- Reproduction steps: present.
- Expected result: present.
- Actual result: present.
- Proof of concept or evidence: present.
- Security impact: present; limited and not bounty-eligible.
- Suggested remediation: present.
- Environment details: present through the audit harness and repository state.

## Common Error Scan

- The report does not demonstrate attacker control over initialization.
- The payment target remains the configured `beneficiary`.
- No signature bypass, replay, seqno bypass, or fund theft is shown.
- The report correctly includes a control case showing proper initialization blocks the behavior.

## Final Verdict

Final verdict: REJECTED

Detailed reasoning: the behavior is reproducible in a local sandbox, but it depends on owner-controlled initialization and has no demonstrated bounty-eligible security impact.

Submission guidance: do not send this as a TON bug bounty report. Treat it as an initialization invariant/hardening note.

Note: This self-check is not an official TON triage decision and does not guarantee a bounty. Invalid or low-quality reports may reduce reviewer trust and review priority.
