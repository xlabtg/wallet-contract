# TON Bug Bounty Self-Check Report

## Short Assessment

DO NOT SEND!!!
Status: incorrect.
Confidence: 96.
Fit bug bounty confidence: 98.
Component: Wallet V4 reference subscription plugin / README.
Class: other: documentation mismatch without security impact.
Self-check report: audit/findings/F-01-reserve-documentation-mismatch/self-check-report.md.

## Repository State

- Analysis date UTC: 2026-06-26 11:13:05 UTC
- Input: `audit/findings/F-01-reserve-documentation-mismatch/report.md`
- Bug bounty rules repository: https://github.com/ton-blockchain/bug-bounty
- Bug bounty rules commit: `52db73b98ffd3173ecdbb21da770f15540e413c0`
- Repositories analyzed:
  - https://github.com/ton-blockchain/wallet-contract, branch `main`, commit `68b56dc0f7f6a9d41a190a4c91f6dc68b18f0600`, submodules not present.
  - https://github.com/ton-blockchain/wallet-contract, tag `v4r2-stable`, commit `3fd1d7ae39f1c46ec1f2be54c4040d8d87505e0f`, submodules not present.
  - https://github.com/xlabtg/wallet-contract, branch `issue-1-03130b6209a6`, commit `792c97b3ea2427236e20524101eb7e0d519aca77`, submodules not present.
- Local modification warnings: PR branch contains audit harness/report additions. Contract sources differ from upstream `v4r2-stable` only by `#pragma version =0.2.0` lines that the local compiler strips in memory.
- Fetch/build limitations: official `wallet-contract` default branch `main` currently contains no contract source files; the audited Wallet V4 R2 source is the `v4r2-stable` tag and the PR branch copy.

## Scope Validation

- Target component: Wallet V4 reference subscription plugin documentation and reserve constant.
- In scope: uncertain. Bug bounty rules list Wallet V4 and subscription smart contracts, but also state that wallet plugins are examples and out of scope.
- Eligible category: no.
- Redirect required: none.
- Relevant exclusions or warnings: documentation mismatch without concrete security impact; no fund theft, auth bypass, replay, validator impact, or service compromise.

## Technical Finding Summary

The README claims the plugin keeps 1 Toncoin on its balance, while the code reserves `67108864` nanotons, about 0.067 TON.

## Vulnerability Existence

- Exact files/functions: `README.md:25`; `func/simple-subscription-plugin.fc:12`; `forward_funds` at `func/simple-subscription-plugin.fc:65-80`.
- Verified code path: `forward_funds` calls `raw_reserve(max_reserved_funds(), 2)` before forwarding remaining funds.
- Attacker-controlled input path: none. This is a documentation mismatch and the reserve value is static code.
- Assumptions: the report assumes integrators may read README as normative. No attacker-controlled security condition is required or present.
- Already fixed: no in the audited PR branch and `v4r2-stable` source copy.

## Reproducibility

- Reproduced: yes.
- Reproduction method: local TON Sandbox through `audit/tests/02-deploy-sweep.spec.ts`.
- Reproduction confidence: 98.
- Missing reproduction evidence: none for the reserve mismatch.
- Live-target testing avoided: yes; local sandbox only, no mainnet/testnet interaction.

## Bug Bounty Eligibility

- Technical validity: valid as a documentation mismatch, invalid as a security vulnerability.
- Bounty eligibility: not eligible.
- Realistic attacker prerequisites: no attacker path.
- Security impact: no verified security impact.
- Low-priority notes: documentation-only issue; no concrete exploitability.

## Severity and Claim Validation

- Claimed impact/severity: Informational.
- Validated impact: documentation mismatch with possible integrator confusion.
- Overclaiming or downgrade notes: any claim of bounty-eligible vulnerability would be overclaiming.

## Report Completeness Check

- Title: present.
- Summary: present.
- Affected component: present.
- Affected commit: filled with latest analyzed commits in this self-check.
- Affected files/functions: present.
- Attack prerequisites: present; none.
- Trigger conditions: present; static documentation/code mismatch.
- Reproduction steps: present.
- Expected result: present.
- Actual result: present.
- Proof of concept or evidence: present.
- Security impact: present; none.
- Suggested remediation: present.
- Environment details: present through the audit harness and repository state.

## Common Error Scan

- No fund theft, signature bypass, replay, or DoS path is shown.
- The issue has no attacker-controlled trigger.
- This is documentation hygiene, not a TON bounty security issue.
- The report does not hallucinate code paths; cited lines exist in the audited source.

## Final Verdict

Final verdict: REJECTED

Detailed reasoning: the mismatch is real, but it is not a security vulnerability and has no bounty-eligible impact.

Submission guidance: do not send this as a TON bug bounty report. It can be handled as a documentation cleanup.

Note: This self-check is not an official TON triage decision and does not guarantee a bounty. Invalid or low-quality reports may reduce reviewer trust and review priority.
