# AIBTCDEV Cache Architecture Update Plan

## Overview
This plan addresses performance issues in the aibtcdev-cache system under bursty traffic, particularly with cache-busting requests. The solution combines multi-DO scaling with 5 Hiro API keys, fast-path KV caching in the Worker, round-robin load balancing, and queue prioritization. This enhances throughput, reduces latency for cache hits, and distributes load evenly.

## Key Components
- **Multi-DO Scaling**: 5 DO instances, each tied to one Hiro API key via hashed DO IDs.
- **Fast-Path Caching**: Check KV directly in the Worker for read-only requests; bypass DO if hit.
- **Round-Robin Routing**: For cache misses/busts, cycle through DOs using a KV counter.
- **Queue Prioritization**: In each DO's RequestQueue, prioritize non-busting requests.

## Implementation Steps

### 1. Update src/config.ts (AppConfig) - Completed
- Add `HIRO_API_KEYS` as an array from env.
- Add methods: `getHiroDoIds()` (hash keys to DO IDs), `getKeyForDoId()` (reverse lookup).

### 2. Update src/index.ts (Main Worker) - Completed
- Initialize CacheService and CacheKeyService.
- For /contract-calls/read-only/, parse params/body, generate cache key, check KV if !bustCache.
- On miss/bust, use round-robin to select DO via KV counter.

### 3. Update src/durable-objects/contract-calls-do.ts (ContractCallsDO) - Completed
- Assign hiroApiKey based on DO ID.
- Pass key to StacksContractFetcher.
- When enqueuing, set priority (higher for non-busts).

### 4. Update src/services/stacks-api-service.ts (StacksApiService) - Completed
- Accept hiroApiKey in constructor.
- Use it for API auth middleware.

### 5. Update src/services/stacks-contract-data-service.ts (StacksContractFetcher) - Completed
- Accept and forward hiroApiKey to StacksApiService.

### 6. Update src/services/request-queue-service.ts (RequestQueue) - Completed
- Add `priority` to QueuedRequest.
- Accept priority in enqueue.
- Sort queue by priority in processQueue.

## Benefits
- Cache hits: <100ms, no DO overhead.
- Bursts: Parallel processing across 5 DOs/keys (e.g., 30 reqs ~6/DO).
- Resilience: Even load distribution, prioritization reduces queue starvation.

## Deployment and Testing
- Add HIRO_API_KEYS to wrangler.toml.
- Test with 30+ mixed requests; verify metrics in logs.
- Deploy to staging, integrate with frontend for real-world testing.

## Additional Enhancements
### Integrate Hiro Rate Limit Headers - Completed
- Update StacksApiService to parse response headers (e.g., x-ratelimit-remaining-stacks-minute, ratelimit-remaining) after API calls.
- Use headers to dynamically adjust TokenBucket (e.g., sync available tokens with remaining counts, respect retry-after).
- Log header info for monitoring.
- Align with migration timeline: Use new headers from August 1, 2024; remove legacy support after September 1, 2024.
- Focus on Stacks-specific headers since this project primarily uses Stacks endpoints.
