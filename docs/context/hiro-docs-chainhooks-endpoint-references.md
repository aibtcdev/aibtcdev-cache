# Get all chainhooks

Get all of your chainhooks through the Hiro Platform

## Endpoint

```
GET /v1/ext/{apiKey}/chainhooks
```

## Parameters

### Path Parameters

| Name   | Type   | Required | Description  |
| ------ | ------ | -------- | ------------ |
| apiKey | string | Yes      | Hiro API key |

## Request Example \

\

```bash \
curl -X GET "https://api.platform.hiro.so/v1/ext/example/chainhooks" \
```

## Response

### 200 OK

Default Response

```json
[{}]
```

## Authentication

This endpoint does not require authentication.

# Get a specific chainhook

Get a specific chainhook through the Hiro Platform

## Endpoint

```
GET /v1/ext/{apiKey}/chainhooks/{chainhookUuid}
```

## Parameters

### Path Parameters

| Name          | Type   | Required | Description    |
| ------------- | ------ | -------- | -------------- |
| apiKey        | string | Yes      | Hiro API key   |
| chainhookUuid | string | Yes      | Chainhook UUID |

## Request Example \

\

```bash \
curl -X GET "https://api.platform.hiro.so/v1/ext/0941f307fd270ace19a5bfed67fbd3bc/chainhooks/aa3626dc-2090-49cd-8f1e-8f9994393aed" \
```

## Response

### 200 OK

Default Response

```json
{}
```

### 404 Not Found

Default Response

## Authentication

This endpoint does not require authentication.

# Get a chainhook status

Retrieve the status of a specific chainhook through the Hiro Platform

## Endpoint

```
GET /v1/ext/{apiKey}/chainhooks/{chainhookUuid}/status
```

## Parameters

### Path Parameters

| Name          | Type   | Required | Description    |
| ------------- | ------ | -------- | -------------- |
| apiKey        | string | Yes      | Hiro API key   |
| chainhookUuid | string | Yes      | Chainhook UUID |

## Request Example \

\

```bash \
curl -X GET "https://api.platform.hiro.so/v1/ext/0941f307fd270ace19a5bfed67fbd3bc/chainhooks/aa3626dc-2090-49cd-8f1e-8f9994393aed/status" \
```

## Response

### 200 OK

Successfully retrieved chainhook status

```json
{
	"status": {
		"info": {
			"expired_at_block_height": 1,
			"last_evaluated_block_height": 1,
			"last_occurrence": 1,
			"number_of_blocks_evaluated": 1,
			"number_of_times_triggered": 1
		},
		"type": "string"
	},
	"enabled": true
}
```

### 404 Not Found

Chainhook not found

## Authentication

This endpoint does not require authentication.

# Create a chainhook

Create a chainhook through the Hiro Platform

## Endpoint

```
POST /v1/ext/{apiKey}/chainhooks
```

## Parameters

### Path Parameters

| Name   | Type   | Required | Description  |
| ------ | ------ | -------- | ------------ |
| apiKey | string | Yes      | Hiro API key |

## Request Body

Chainhook predicate configuration

**Required**: Yes

### Content Type: `application/json`

```json
[object Object]
```

## Request Example \

\

```bash \
curl -X POST "https://api.platform.hiro.so/v1/ext/0941f307fd270ace19a5bfed67fbd3bc/chainhooks" \
```

## Response

### 200 OK

Default Response

```json
{
	"status": "string",
	"chainhookUuid": "string"
}
```

## Authentication

This endpoint does not require authentication.

# Update a chainhook

Update a chainhook through the Hiro Platform

## Endpoint

```
PUT /v1/ext/{apiKey}/chainhooks/{chainhookUuid}
```

## Parameters

### Path Parameters

| Name          | Type   | Required | Description    |
| ------------- | ------ | -------- | -------------- |
| apiKey        | string | Yes      | Hiro API key   |
| chainhookUuid | string | Yes      | Chainhook UUID |

## Request Body

Chainhook predicate configuration

**Required**: No

### Content Type: `application/json`

```json
[object Object]
```

## Request Example \

\

```bash \
curl -X PUT "https://api.platform.hiro.so/v1/ext/0941f307fd270ace19a5bfed67fbd3bc/chainhooks/aa3626dc-2090-49cd-8f1e-8f9994393aed" \
```

## Response

### 200 OK

Default Response

```json
{
	"status": "string",
	"chainhookUuid": "string"
}
```

### 404 Not Found

Default Response

### 500 Internal Server Error

Default Response

### Error Responses

| Status | Description      |
| ------ | ---------------- |
| 404    | Default Response |
| 500    | Default Response |

## Authentication

This endpoint does not require authentication.

# Delete a chainhook

Delete a chainhook through the Hiro Platform

## Endpoint

```
DELETE /v1/ext/{apiKey}/chainhooks/{chainhookUuid}
```

## Parameters

### Path Parameters

| Name          | Type   | Required | Description    |
| ------------- | ------ | -------- | -------------- |
| apiKey        | string | Yes      | Hiro API key   |
| chainhookUuid | string | Yes      | Chainhook UUID |

## Request Example \

\

```bash \
curl -X DELETE "https://api.platform.hiro.so/v1/ext/0941f307fd270ace19a5bfed67fbd3bc/chainhooks/aa3626dc-2090-49cd-8f1e-8f9994393aed" \
```

## Response

### 200 OK

Default Response

```json
{
	"status": "string",
	"chainhookUuid": "string",
	"message": "string"
}
```

## Authentication

This endpoint does not require authentication.
