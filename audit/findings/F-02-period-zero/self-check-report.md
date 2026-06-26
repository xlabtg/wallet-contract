# TON Bug Bounty Self-Check Report

## Short Assessment

DO NOT SEND!!!
Status: incorrect.
Confidence: 94.
Fit bug bounty confidence: 96.
Component: Wallet V4 reference subscription plugin.
Class: not attacker controlled.
Self-check report: audit/findings/F-02-period-zero/self-check-report.md.

## Repository State

- Analysis date UTC: 2026-06-26 11:13:05 UTC
- Input: `audit/findings/F-02-period-zero/report.md`
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
- Relevant exclusions or warnings: requires invalid owner/operator-controlled initialization; no arbitrary attacker can set `period` on an existing plugin.

## Technical Finding Summary

The plugin divides by `period` in timeslot calculations without first checking `period > 0`. With invalid initialization data, `period == 0` causes division by zero.

## Vulnerability Existence

- Exact files/functions: `recv_internal` at `func/simple-subscription-plugin.fc:138-150`; `recv_external` at `func/simple-subscription-plugin.fc:158-170`.
- Verified code path: both handlers compute `(last_payment_time - start_time) / period` and `(now() - start_time) / period`.
- Attacker-controlled input path: not verified. `period` is stored configuration chosen during initialization, not a message field controlled by any sender.
- Assumptions: the report assumes a plugin can be deployed with invalid `period = 0` data. That is owner/operator configuration.
- Already fixed: not fixed in audited source, but not bounty-eligible because trigger is not attacker controlled.

## Reproducibility

- Reproduced: yes.
- Reproduction method: local TON Sandbox through `audit/tests/01-audit-poc.spec.ts`.
- Reproduction confidence: 95.
- Missing reproduction evidence: no missing evidence for local invalid configuration behavior; missing attacker-controlled path for bounty eligibility.
- Live-target testing avoided: yes; local sandbox only, no mainnet/testnet interaction.

## Bug Bounty Eligibility

- Technical validity: valid under invalid initialization data.
- Bounty eligibility: not eligible.
- Realistic attacker prerequisites: no.
- Security impact: operator can brick their own misconfigured subscription; no third-party exploit path is shown.
- Low-priority notes: hardening issue only.

## Severity and Claim Validation

- Claimed impact/severity: Low hardening.
- Validated impact: local robustness failure under invalid owner configuration.
- Overclaiming or downgrade notes: claiming DoS by arbitrary attacker would be unsupported.

## Report Completeness Check

- Title: present.
- Summary: present.
- Affected component: present.
- Affected commit: filled with latest analyzed commits in this self-check.
- Affected files/functions: present.
- Attack prerequisites: present; invalid owner/operator configuration.
- Trigger conditions: present.
- Reproduction steps: present.
- Expected result: present.
- Actual result: present.
- Proof of concept or evidence: present.
- Security impact: present; limited and not attacker-controlled.
- Suggested remediation: present.
- Environment details: present through the audit harness and repository state.

## Common Error Scan

- The report does not show an attacker-controlled path to set `period`.
- This matches the self-check rejection class `not attacker controlled`.
- No fund theft, signature bypass, replay, or validator impact is demonstrated.
- The report does not rely on live targets.

## Final Verdict

Final verdict: REJECTED

Detailed reasoning: the divide-by-zero behavior is real for invalid initialization, but the trigger is owner/operator-controlled configuration, not an attacker-controlled bounty issue.

Submission guidance: do not send this as a TON bug bounty report. Treat it as hardening guidance.

Note: This self-check is not an official TON triage decision and does not guarantee a bounty. Invalid or low-quality reports may reduce reviewer trust and review priority.
