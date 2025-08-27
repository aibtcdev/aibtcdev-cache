# AIBTCDEV Cache Fix Plan

## Overview
This plan addresses test failures from `bash tests/run_tests.sh`, focusing on path malformation (double slashes), error handling (unexpected 500s), and graceful handling of missing Hiro keys. It is sequenced for quick wins first. After each step, re-run tests and update this file with status (e.g., [x] Completed).

## Actionable Steps

1. **Fix Test Script to Eliminate Double Slashes (Quick Win)**
   - [x] In `tests/test_contract_calls.sh` and `tests/run_tests.sh`, trim trailing `/` from API_URL.
   - Why: Prevents // paths in requests.
   - Assigned: Developer
   - Status: Completed

2. **Normalize Paths in ContractCallsDO for Robustness**
   - [x] Add path normalization in `src/durable-objects/contract-calls-do.ts`.
   - Why: Handles double slashes gracefully.
   - Assigned: Developer
   - Status: Completed

3. **Improve Error Handling to Prevent Unexpected 500s**
   - [x] Add try-catch in `src/durable-objects/contract-calls-do.ts`, `src/services/request-queue-service.ts`, and debug logs in `src/services/stacks-api-service.ts`.
   - Why: Ensures correct status codes (e.g., 404 instead of 500).
   - Assigned: Developer
   - Status: Completed

4. **Handle Hiro Key Absences Gracefully**
   - [ ] Add warnings for missing keys in `src/durable-objects/contract-calls-do.ts`, `src/services/stacks-api-service.ts`, and `src/config.ts`.
   - Why: Improves debuggability without crashing.
   - Assigned: Developer
   - Status: Pending

5. **Test, Validate, and Document**
   - [ ] Re-run `bash tests/run_tests.sh` after each step.
   - [ ] Update `docs/RETRO.md` with resolutions.
   - [ ] Test edge cases (e.g., manual curls with double slashes).
   - Assigned: Tester/Developer
   - Status: Pending

## Iteration Notes
- Track progress by checking boxes.
- If new issues arise, add to `docs/QUESTIONS.md` and revise this plan.
- External: HIRO_API_KEYS setup is separate; monitor for rate limit impacts.
