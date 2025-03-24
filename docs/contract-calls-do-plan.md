# Contract Calls Durable Object Implementation Plan

## 1. Create the Durable Object Class

Create a new file `src/durable-objects/contract-calls-do.ts` following the pattern of existing DOs:

- Implement a `ContractCallsDO` class extending `DurableObject<Env>`
- Define configuration constants from AppConfig
- Set up rate limiting and caching similar to other DOs
- Implement the `alarm()` method for background tasks
- Implement the `fetch()` method to handle requests
- All functions should include clear JSDoc style comments

## 2. Define Core Functionality

- Create a method to fetch and cache contract ABIs
- Implement validation of function arguments against ABI
- Create a method to execute read-only contract calls
- Set up proper caching of results with appropriate TTLs

## 3. Define API Endpoints

- `/contract-calls/read-only/{contractAddress}/{contractName}/{functionName}` - POST endpoint for read-only calls
- `/contract-calls/abi/{contractAddress}/{contractName}` - GET endpoint to fetch contract ABI
- `/contract-calls/known-contracts` - GET endpoint to list cached contracts

## 4. Update Project Configuration

- Add the DO to `worker-configuration.d.ts`
- Register the DO in `wrangler.toml`
- Export the DO in `src/index.ts`

## 5. Implement Helper Classes/Functions

- Create a contract ABI validator utility
- Implement a contract call formatter for readable responses
- Add contract address storage similar to address-store.ts

## Implementation Approach

1. Leverage the existing `StacksContractFetcher` for making the actual contract calls
2. Use `CacheService` for caching ABIs and call results
3. Follow the pattern of other DOs for rate limiting and request handling
4. Implement clear error handling with descriptive messages
5. Add documentation for each endpoint
