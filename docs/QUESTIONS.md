# Open Questions and Tasks for AIBTCDEV Cache Update

## Open Questions
- Should src/utils/clarity-responses-util.ts be added to the chat for precise updates to clarity value handling in the Worker's fast-path? (Currently referenced but not edited.)
- Are there specific Hiro API rate limits (e.g., paid tier) that need config adjustments beyond defaults?
- How should error handling for key assignment failures (e.g., hash mismatch) be implemented in ContractCallsDO?

## Tasks
- Add HIRO_API_KEYS as a secret in wrangler.toml (e.g., "key1,key2,key3,key4,key5").
- After implementation, build and deploy to staging.
- Run tests: Simulate bursts with Postman/scripts; verify with staging frontend.
