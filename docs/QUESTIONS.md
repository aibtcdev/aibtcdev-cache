# Open Questions and External Tasks for AIBTCDEV Cache Fixes

This file tracks clarifications needed or tasks outside our code change process. Update as we progress.

## Questions/Clarifications

## External Tasks
- If new files are needed (e.g., for unexpected dependencies), add them to the chat.

## Resolved
- Are there specific error status mappings in `src/utils/error-catalog-util.ts` that differ from standards (e.g., NOT_FOUND not 404)? If so, provide the file for review. -> File added; mappings are standard (e.g., NOT_FOUND=404).
- During testing, if persistent 500s occur, can we access server-side logs for a specific requestId (e.g., from test output) to trace upstream errors? -> Yes, viewable but use minimal logging for cost.
- Set HIRO_API_KEYS in the environment to avoid rate limiting issues (as per original query, handled separately). -> Officially set via wrangler secret put.
- In test_contract_calls.sh, why does test_endpoint report 500 for invalid endpoint when manual curl shows NOT_FOUND body (expected for 404)? Add tests/utils.sh to chat for review if needed to check status parsing logic. -> File added; fixed parsing by separating status curl and adjusting headers/body extraction.
