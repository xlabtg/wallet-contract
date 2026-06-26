# TON Bug Bounty Self-Check Report

## Short Assessment

DO NOT SEND!!!
Status: out-of-scope but technically valid.
Confidence: 90.
Fit bug bounty confidence: 90.
Component: Wallet V4 reference subscription plugin.
Class: other: low-impact smart contract business logic.
Self-check report: audit/findings/F-04-failed-attempts-per-request/self-check-report.md.

## Repository State

- Analysis date UTC: 2026-06-26 11:13:05 UTC
- Input: `audit/findings/F-04-failed-attempts-per-request/report.md`
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
- Relevant exclusions or warnings: minimal security impact; no fund theft; behavior requires a non-responding wallet or intentionally short timeout/request conditions.

## Technical Finding Summary

`failed_attempts` increments per accepted request, not per missed period. A non-responding wallet can let repeated permissionless requests in the same period trigger plugin self-destruction.

## Vulnerability Existence

- Exact files/functions: `recv_external` at `func/simple-subscription-plugin.fc:158-170`; `max_failed_attempts` at `func/simple-subscription-plugin.fc:11`; `self_destruct` at `func/simple-subscription-plugin.fc:98-114`.
- Verified code path: accepted external request increments `failed_attempts`; when `failed_attempts >= 2`, the plugin calls `self_destruct`.
- Attacker-controlled input path: anyone can call `recv_external`, subject to timeslot and `timeout`. The meaningful impact requires the configured wallet not to pay.
- Assumptions: the wallet does not answer or cannot pay; the requester can wait beyond `timeout` while remaining in the same `period`.
- Already fixed: no in the audited source.

## Reproducibility

- Reproduced: yes.
- Reproduction method: local TON Sandbox through `audit/tests/01-audit-poc.spec.ts`.
- Reproduction confidence: 92.
- Missing reproduction evidence: no missing evidence for the local behavior; missing concrete high-impact security consequence.
- Live-target testing avoided: yes; local sandbox only, no mainnet/testnet interaction.

## Bug Bounty Eligibility

- Technical validity: valid.
- Bounty eligibility: not eligible.
- Realistic attacker prerequisites: partially realistic for triggering external requests, but meaningful impact depends on an already failing or non-paying subscription.
- Security impact: early termination of an already non-paying subscription; remaining funds go to the configured beneficiary.
- Low-priority notes: no theft, no attacker profit, no signature/auth bypass.

## Severity and Claim Validation

- Claimed impact/severity: Low.
- Validated impact: low-impact business logic mismatch between request-attempt and missed-period semantics.
- Overclaiming or downgrade notes: claiming fund theft, permanent wallet DoS, or Critical/High severity would be unsupported.

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
- Security impact: present; low and not bounty-eligible.
- Suggested remediation: present.
- Environment details: present through the audit harness and repository state.

## Common Error Scan

- The report does not claim theft or attacker-controlled redirection of funds.
- It distinguishes non-paying wallet behavior from healthy subscription behavior.
- It includes a mitigation/control test showing payment resets the counter and blocks same-period re-poke.
- The likely impact is below TON bounty severity expectations.

## Final Verdict

Final verdict: REJECTED

Detailed reasoning: the per-request behavior is technically reproducible, but the impact is minimal, funds are not stolen, and the report is not ready as a TON bounty submission.

Submission guidance: do not send this as a TON bug bounty report in its current form. Keep it as a low-priority design/hardening note.

Note: This self-check is not an official TON triage decision and does not guarantee a bounty. Invalid or low-quality reports may reduce reviewer trust and review priority.
