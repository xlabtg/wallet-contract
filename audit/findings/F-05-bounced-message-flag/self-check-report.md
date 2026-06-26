# TON Bug Bounty Self-Check Report

## Short Assessment

DO NOT SEND!!!
Status: incorrect.
Confidence: 97.
Fit bug bounty confidence: 98.
Component: Wallet V4 reference subscription plugin.
Class: other: defense-in-depth without current impact.
Self-check report: audit/findings/F-05-bounced-message-flag/self-check-report.md.

## Repository State

- Analysis date UTC: 2026-06-26 11:13:05 UTC
- Input: `audit/findings/F-05-bounced-message-flag/report.md`
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
- Relevant exclusions or warnings: defense-in-depth issue with no current impact.

## Technical Finding Summary

The plugin does not explicitly ignore bounced internal messages, but current bounced message bodies do not match actionable plugin operations and no state or fund movement occurs.

## Vulnerability Existence

- Exact files/functions: `recv_internal` at `func/simple-subscription-plugin.fc:116-156`; comparison point in Wallet V4 `recv_internal` at `func/wallet-v4-code.fc:8-14`.
- Verified code path: plugin reads `flags` but does not branch on `flags & 1`; current bounced `request_payment` body starts with `0xffffffff`, which does not match plugin payment or destruct handlers.
- Attacker-controlled input path: a bounced message can exist, but no current code path turns it into a security effect.
- Assumptions: future code changes could make this relevant, but that is not current exploitability.
- Already fixed: no explicit guard in audited plugin source; not a vulnerability because current behavior is inert.

## Reproducibility

- Reproduced: yes.
- Reproduction method: local TON Sandbox through `audit/tests/01-audit-poc.spec.ts`.
- Reproduction confidence: 98.
- Missing reproduction evidence: missing security impact because none is observed.
- Live-target testing avoided: yes; local sandbox only, no mainnet/testnet interaction.

## Bug Bounty Eligibility

- Technical validity: valid as a defense-in-depth observation, invalid as an exploitable vulnerability.
- Bounty eligibility: not eligible.
- Realistic attacker prerequisites: irrelevant because no current impact path is shown.
- Security impact: none verified.
- Low-priority notes: future-proofing recommendation only.

## Severity and Claim Validation

- Claimed impact/severity: Informational.
- Validated impact: no current impact.
- Overclaiming or downgrade notes: any claim that this currently steals funds or bypasses authentication would be unsupported.

## Report Completeness Check

- Title: present.
- Summary: present.
- Affected component: present.
- Affected commit: filled with latest analyzed commits in this self-check.
- Affected files/functions: present.
- Attack prerequisites: present; no exploit path.
- Trigger conditions: present.
- Reproduction steps: present.
- Expected result: present.
- Actual result: present.
- Proof of concept or evidence: present.
- Security impact: present; none.
- Suggested remediation: present.
- Environment details: present through the audit harness and repository state.

## Common Error Scan

- Defense-in-depth without current impact is generally out of scope.
- The PoC confirms inert behavior rather than exploitability.
- No fund theft, state corruption, authorization bypass, or DoS is demonstrated.
- The report clearly separates future risk from current verified behavior.

## Final Verdict

Final verdict: REJECTED

Detailed reasoning: the missing bounce guard is a valid hardening observation, but current message formats make bounced messages inert and no bounty-eligible impact exists.

Submission guidance: do not send this as a TON bug bounty report. Keep it as a defense-in-depth recommendation.

Note: This self-check is not an official TON triage decision and does not guarantee a bounty. Invalid or low-quality reports may reduce reviewer trust and review priority.
