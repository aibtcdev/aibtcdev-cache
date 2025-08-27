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
   - [x] Add warnings for missing keys in `src/durable-objects/contract-calls-do.ts`, `src/services/stacks-api-service.ts`, and `src/config.ts`.
   - Why: Improves debuggability without crashing.
   - Assigned: Developer
   - Status: Completed

5. **Test, Validate, and Document**
   - [x] Re-run `bash tests/run_tests.sh` after each step.
   - [x] Update `docs/RETRO.md` with resolutions.
   - [x] Test edge cases (e.g., manual curls with double slashes).
   - Assigned: Tester/Developer
   - Status: Completed

## Iteration Notes
- Track progress by checking boxes.
- If new issues arise, add to `docs/QUESTIONS.md` and revise this plan.
- External: HIRO_API_KEYS setup is separate; monitor for rate limit impacts.

## Iteration 1: Addressing Remaining Test Failures
Based on latest test output (6 failures: 500s for base/known/ABI/invalid, decode error with "config2.getHiroDoNames is not a function"), root cause is a bug in src/index.ts DO routing (calling getHiroDoNames on config object instead of AppConfig instance, causing TypeError turned to 500). Read-only succeeded possibly due to fast-path cache hit. Invalid returns correct NOT_FOUND body (likely 404 status), but test reports 500—clarify in QUESTIONS.md.

6. **Fix DO Selection Bug in index.ts**
   - [x] Change config.getHiroDoNames() to AppConfig.getInstance(env).getHiroDoNames() in src/index.ts.
   - Why: Corrects method call to avoid TypeError and ensure proper DO routing.
   - Assigned: Developer
   - Status: Completed

7. **Investigate and Fix Test Script Status Checks**
   - [x] Inspect utils.sh (add to chat if needed) and adjust test_endpoint to correctly parse status for error responses.
   - Why: Test reports 500 for invalid but manual curl shows expected NOT_FOUND body; ensure test checks actual HTTP status.
   - Assigned: Developer
   - Status: Completed

8. **Re-Test and Validate**
   - [ ] Re-run `bash tests/run_tests.sh` and manual curls after fixes.
   - [ ] If 500s persist for ABI/known, check server logs for requestIds (e.g., "f67162e8") to trace.
   - [ ] Update RETRO.md with resolutions.
   - Assigned: Tester/Developer
   - Status: Pending
