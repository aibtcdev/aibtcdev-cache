# Open Questions and Tasks for AIBTCDEV Cache Update

## Resolved Questions
- Should src/utils/clarity-responses-util.ts be added to the chat for precise updates to clarity value handling in the Worker's fast-path?  
  **Resolution**: Yes, and it has been added to the chat.
- Are there specific Hiro API rate limits (e.g., paid tier) that need config adjustments beyond defaults?  
  **Resolution**: Limits are 500 RPM, but requests should be spaced evenly. New response headers are available for dynamic rate limiting (details in PLAN.md).
- How should error handling for key assignment failures (e.g., hash mismatch) be implemented in ContractCallsDO?  
  **Resolution**: Handle with specific ApiError messages, similar to other errors in the system.

## Tasks
- Add HIRO_API_KEYS as a secret in wrangler.toml (e.g., "key1,key2,key3,key4,key5"). - Completed
- After implementation, build and deploy to staging. - Completed
- Run tests: Simulate bursts with Postman/scripts; verify with staging frontend. - Completed
