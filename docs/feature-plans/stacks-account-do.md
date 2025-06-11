# Feature Plan: Stacks Account Durable Object (StacksAccountDO)

This document outlines the plan to create a new Durable Object for managing Stacks account-specific data, starting with the account nonce.

## Objective

Create a new Durable Object, `StacksAccountDO`, where each instance is uniquely identified by a Stacks address. This object will manage and cache the nonce for that specific address using the Durable Object's private storage. The API will be extensible for future account-related data.

## API Design

| Method | Endpoint                                  | Description                                                                    |
| :----- | :---------------------------------------- | :----------------------------------------------------------------------------- |
| `GET`  | `/stacks-account/{address}/nonce`         | Gets the cached nonce from DO storage. Fetches if missing.                     |
| `GET`  | `/stacks-account/{address}/nonce?bustCache=true` | Forces a fresh fetch from the blockchain and updates the value in DO storage.    |
| `POST` | `/stacks-account/{address}/nonce/sync`    | Explicitly fetches the latest nonce from the blockchain and updates storage.   |
| `POST` | `/stacks-account/{address}/nonce/update`  | Manually updates the nonce. Expects a JSON body: `{ "nonce": 123 }`.           |

## Implementation Tasks

### Phase 1: Core Logic & Services

- [ ] **Create `StacksAccountDataService`**: A new service to handle rate-limiting and retries for fetching account data from the Hiro API. This prevents direct calls from the DO to the external API, ensuring we don't exceed rate limits.
- [ ] **Update `StacksApiService`**: Add a `getAccountNonce` method that uses `fetch` to call the Hiro `/extended/v1/addresses/{principal}/nonces` endpoint.
- [ ] **Create `StacksAccountDO`**: The main Durable Object class.
    - [ ] Use the Stacks address from `ctx.id` as its identifier.
    - [ ] Use `ctx.storage` for storing the nonce.
    - [ ] Implement the `fetch` handler to route requests to the correct methods.
    - [ ] Implement `getNonce`, `syncNonce`, and `updateNonce` logic.
    - [ ] Use `StacksAccountDataService` for all external data fetching.

### Phase 2: Configuration & Routing

- [ ] **Update `wrangler.toml`**:
    - [ ] Add a new migration for the `StacksAccountDO` class.
    - [ ] Add the `STACKS_ACCOUNT_DO` binding to all environments (`preview`, `staging`, `production`).
- [ ] **Update `worker-configuration.d.ts`**: Add `STACKS_ACCOUNT_DO` to the `Env` interface.
- [ ] **Update `src/config.ts`**: Add `/stacks-account` to the `SUPPORTED_SERVICES` list.
- [ ] **Update `src/index.ts`**:
    - [ ] Import and export the `StacksAccountDO` class.
    - [ ] Add routing logic to forward requests starting with `/stacks-account/{address}` to the correct DO instance.

### Phase 3: Verification

- [ ] Deploy the changes to a preview environment.
- [ ] Test all API endpoints using an HTTP client like `curl`.
    - [ ] Verify initial fetch (cache miss).
    - [ ] Verify subsequent fetch (cache hit).
    - [ ] Verify `bustCache=true` functionality.
    - [ ] Verify `/sync` endpoint.
    - [ ] Verify `/update` endpoint.
