# Chainhook Relay Infrastructure (MVP)

## Overview

This system ensures reliable delivery of block-level webhook events from an external blockchain event source ("Chainhook"). Using Cloudflare Durable Objects and Workers, the architecture provides:

* **Resilience to duplication**
* **Robust handling of chainhook failure**
* **Efficient, scalable event delivery**
* **Future-ready fan-out support to multiple destinations**

---

## Core Goals

* Receive **every anchored block** event from the chainhook
* Prevent duplicate forwarding via global deduplication (using `block_hash`)
* Deliver payloads to at least **one downstream service**, with future fan-out support
* Handle chainhook creation, health monitoring, and re-creation in a modular way
* Scale horizontally as new API keys and use cases are added

---

## Architecture Summary

External Chainhook Service → ChainhookDO (per API key) → RelayWorker → Destination Webhook(s)

* ChainhookDO handles:

  * Chainhook lifecycle (create, monitor, recreate)
  * Receiving webhook payloads
  * Forwarding to Worker
* RelayWorker handles:

  * Deduplication via KV
  * Forwarding to destinations
* KV Store handles:

  * Global deduplication keyed by `block_hash`

---

## Components

### 1. Durable Object: `ChainhookDO`

#### Responsibilities

* **Initialize and manage** the chainhook (via external API)
* **Receive POSTs** from the chainhook
* **Forward payloads** to `RelayWorker`
* **Monitor health** and recreate chainhook if it's stale or failed

#### State Stored (per DO instance)

* `chainhook_id`
* Last known `block_hash` (optional)
* Last activity timestamp

#### Endpoints

* `POST /event` – handles incoming block payloads
* `GET /status` – returns internal DO state (for debugging)

#### Periodic Logic (`alarm()` or scheduler)

* Check chainhook status via external API
* Compare expected vs. actual block delivery timing
* Recreate hook if needed

---

### 2. Cloudflare Worker: `RelayWorker`

#### Responsibilities

* Receive block payload from DO
* Extract `block_hash`
* Check for deduplication in KV store
* If new:

  * Store hash in KV
  * Forward payload to downstream endpoint
* If duplicate:

  * Drop silently (or log)

#### KV Schema

* **Key**: block hash (e.g., `blk_0xabc123...`)
* **Value**: `"delivered"` or timestamp (optional)
* **TTL**: \~24–48 hours (adjust for expected reorgs)

#### Environment Bindings

* `KV_BLOCKS` – KV namespace for deduplication
* `DESTINATION_URL` – initial destination for payloads

---

### 3. KV Store: `KV_BLOCKS`

Used globally to deduplicate block events across all DOs and Workers.

| Key          | Value         | TTL      |
| ------------ | ------------- | -------- |
| `block_hash` | `"delivered"` | 1–2 days |

---

## Logging

### `ChainhookDO`

| Event            | Log Message                                     |
| ---------------- | ----------------------------------------------- |
| Startup          | `"DO started for API key: {key}"`               |
| Hook creation    | `"Created chainhook: {id}"`                     |
| Incoming webhook | `"Received block: {block_hash}"`                |
| Forwarded        | `"Forwarded block {block_hash} to RelayWorker"` |
| Health check     | `"Checking chainhook health"`                   |
| Recreation       | `"Recreated chainhook for {key}"`               |
| Error            | `"Error handling block {block_hash}: {error}"`  |

### `RelayWorker`

| Event          | Log Message                                        |
| -------------- | -------------------------------------------------- |
| Incoming       | `"Received block: {block_hash}"`                   |
| Duplicate      | `"Duplicate block: {block_hash}"`                  |
| Forwarded      | `"Forwarded block {block_hash} to {destination}"`  |
| Failed forward | `"Failed to deliver block {block_hash}: {status}"` |

---

## Scaling Plan

| Component     | Scales How?                    | Notes                                  |
| ------------- | ------------------------------ | -------------------------------------- |
| `ChainhookDO` | Horizontally, 1 per API key    | Clean sharding model                   |
| `RelayWorker` | Cloudflare handles concurrency | Stateless, fast                        |
| `KV Store`    | Global, distributed            | Efficient for deduplication            |
| Destinations  | Must scale with traffic        | Fan-out and retry queues planned later |

---

## Future Enhancements

* Fan-out to multiple destinations
* Retry and queueing for failed deliveries
* Chain reorg detection and rollback handling
* Signature verification of incoming payloads
* Dashboard for chainhook status and logs

---

## Next Steps

This document forms the foundation for the implementation task plan.

Tasks will include:

* [ ] DO scaffold with fetch + alarm
* [ ] Chainhook API integration
* [ ] Worker with KV dedup and forward logic
* [ ] Logging utility functions
* [ ] Deployment scripts + testing

---

## Notes

* Each block has a globally unique `block_hash`, making it ideal for use as the KV deduplication key.
* No payload filtering is done at this stage — every anchored block is delivered.
