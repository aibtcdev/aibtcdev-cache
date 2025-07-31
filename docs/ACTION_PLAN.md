# Action Plan: Create `ChainhookAggregatorDO`

This plan outlines the steps to create a new Durable Object, `ChainhookAggregatorDO`, for managing and relaying blockchain events from an external chainhook service. It follows modern Cloudflare best practices, including RPC-style communication and SQLite-backed storage, and aligns with the project's existing architecture as described in `docs/START.md`.

## Phase 1: Scaffolding and Configuration

1.  **Create New Durable Object File**:

    - Create `src/durable-objects/chainhook-aggregator-do.ts`.
    - Define the `ChainhookAggregatorDO` class extending `DurableObject`.
    - Add a constructor and placeholder RPC methods (`handleEvent`, `getStatus`) and an `alarm()` handler to establish the basic structure.

2.  **Update Worker Configuration**:

    - In `worker-configuration.d.ts`, update the `Env` interface to include:
      ```typescript
      CHAINHOOK_AGGREGATOR_DO: DurableObjectNamespace<ChainhookAggregatorDO>;
      HIRO_PLATFORM_API_KEY: string; // For the external service
      RELAY_WORKER_URL: string; // The endpoint for the relay logic
      ```
    - In `wrangler.toml` (or `.jsonc`):
      - Add a new durable object binding for `CHAINHOOK_AGGREGATOR_DO`.
      - Add a migration for `ChainhookAggregatorDO` using `new_sqlite_classes` to enable the SQLite backend.
      - Add secrets for `HIRO_PLATFORM_API_KEY` and `RELAY_WORKER_URL`.

3.  **Update Entrypoint for Routing (`src/index.ts`)**:
    - Export the new `ChainhookAggregatorDO` class.
    - Add a new route like `/chainhook-event/[do-name]` to the main `fetch` handler. This will be the public endpoint the external chainhook service calls.
    - This route handler will:
      1.  Get the DO stub via `env.CHAINHOOK_AGGREGATOR_DO.idFromName('[do-name]')`.
      2.  Call an RPC method on the stub (e.g., `await stub.handleEvent(request)`), forwarding the request.

## Phase 2: Durable Object Core Logic

4.  **Implement the `ChainhookAggregatorDO` Constructor**:

    - Initialize services like `Logger`.
    - Use `ctx.blockConcurrencyWhile()` to load the DO's state (e.g., `chainhook_id`, `last_block_hash`) from `this.ctx.storage`. If state doesn't exist, trigger the initial chainhook creation logic and set the first alarm.

5.  **Implement State Management**:

    - Define class properties for the DO's state (`chainhook_id`, `last_activity_timestamp`, etc.).
    - Use `this.ctx.storage.put()` to persist state to durable storage after it's modified.

6.  **Implement RPC Method: `handleEvent(request)`**:

    - This method receives the webhook payload from the main worker.
    - **Log the raw request body.** This fulfills the requirement to capture the payload structure for future typing.
    - Extract the `block_hash` and update `last_activity_timestamp` in storage.
    - Forward the payload to the `RELAY_WORKER_URL` using `fetch()`.
    - Log the result of the forwarding action.

7.  **Implement RPC Method: `getStatus()`**:
    - Create this method to return the DO's current state from memory for debugging purposes, as planned in `START.md`.

## Phase 3: Lifecycle Management and External API Interaction

8.  **Implement `alarm()` Handler**:

    - The alarm will periodically trigger this method.
    - Inside, implement the health check: call the Hiro Platform API to get the status of the managed `chainhook_id`.
    - If the hook is unhealthy or stale, log the issue and trigger a recreation method.
    - Finally, call `this.ctx.storage.setAlarm()` to schedule the next health check.

9.  **Implement Chainhook Creation/Recreation Logic**:
    - Create a private method (e.g., `_recreateChainhook()`).
    - This method will make an authenticated API call to the Hiro Platform to create a new chainhook, providing the public URL for the webhook (`/chainhook-event/[do-name]`).
    - It will store the new `chainhook_id` in `this.ctx.storage`.
