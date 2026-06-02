# API Reference

> Complete documentation of all HTTP endpoints exposed by the AjraSakha WhatsApp AI Assistant.

---

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Webhook Verification](#get-whatsappwebhook)
  - [Webhook Receiver](#post-whatsappwebhook)
  - [Send Message](#post-whatsappsend-message)
  - [Reviewer Webhook](#post-whatsappreviewer-webhook)
  - [Manual Poll Trigger](#get-whatsapptest-poll)
  - [User Count](#get-whatsappuserscount)
  - [User List](#get-whatsappusers)
- [Error Responses](#error-responses)
- [Webhook Payload Types](#webhook-payload-types)

---

## Base URL

```
http://localhost:3000
```

All endpoints are prefixed with `/whatsapp`.

---

## Authentication

The application uses three distinct authentication mechanisms depending on the endpoint:

| Mechanism | Used By | How |
|---|---|---|
| **Webhook Verify Token** | `GET /whatsapp/webhook` | Query parameter `hub.verify_token` matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| **HMAC-SHA256 Signature** | `POST /whatsapp/webhook` | `x-hub-signature-256` header verified against `WHATSAPP_META_APP_SECRET` |
| **Internal API Key** | All internal endpoints | `x-internal-api-key` header matches `REVIEWER_INTERNAL_API_KEY` |

---

## Endpoints

### `GET /whatsapp/webhook`

**Purpose**: WhatsApp webhook subscription verification (called by Meta during webhook setup).

**Authentication**: Webhook verify token

**Query Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `hub.mode` | `string` | ✅ | Must be `subscribe` |
| `hub.challenge` | `string` | ✅ | Challenge string to echo back |
| `hub.verify_token` | `string` | ✅ | Must match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |

**Success Response** (`200 OK`):

```
<hub.challenge value echoed back as plain text>
```

**Error Response** (`403 Forbidden`):

```json
{
  "statusCode": 403,
  "message": "Invalid verify token"
}
```

---

### `POST /whatsapp/webhook`

**Purpose**: Core webhook endpoint receiving all inbound WhatsApp events — messages, statuses, call events.

**Authentication**: HMAC-SHA256 signature verification

**Headers**:

| Header | Type | Required | Description |
|---|---|---|---|
| `x-hub-signature-256` | `string` | ✅ | `sha256=<HMAC of raw body using app secret>` |
| `Content-Type` | `string` | ✅ | `application/json` |

**Request Body**: Meta WhatsApp Cloud API webhook payload.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "1234567890",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": { "name": "Farmer Name" },
                "wa_id": "919876543210"
              }
            ],
            "messages": [
              {
                "from": "919876543210",
                "id": "wamid.XXXX",
                "timestamp": "1234567890",
                "type": "text",
                "text": { "body": "How to grow wheat?" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Supported Message Types**:

| Type | Processing |
|---|---|
| `text` | Dispatched to `AddUserTextMessageCommand` → LangGraph → AI reply |
| `audio` (voice note) | Downloaded → Sarvam STT → LangGraph → Voice + text reply |
| `location` | Dispatched to `SetUserLocationCommand` → Stored in thread state |
| `reaction` (👍/👎) | Appended to LangGraph thread for feedback tracking |
| `calls` (field: `calls`) | Connect → WebRTC + Gemini Live; Terminate → cleanup |

**Success Response** (`200 OK`): Empty body (always returns 200 to prevent Meta retries).

**Error Response** (`403 Forbidden`):

```json
{
  "statusCode": 403,
  "message": "Invalid signature"
}
```

---

### `POST /whatsapp/send-message`

**Purpose**: Send an outbound text message to a user from the reviewer desk / admin panel. The message is also appended to the user's LangGraph thread history.

**Authentication**: Internal API key

**Headers**:

| Header | Type | Required |
|---|---|---|
| `x-internal-api-key` | `string` | ✅ |
| `Content-Type` | `application/json` | ✅ |

**Request Body**:

```json
{
  "phoneNumber": "919876543210",
  "messageText": "Use Neem oil spray at 5ml per liter of water for pest control.",
  "sendBy": "Dr. Sharma",
  "userId": "reviewer-uuid-123"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | User's WhatsApp number (with country code) |
| `messageText` | `string` | ✅ | Message content to send |
| `sendBy` | `string` | ✅ | Name of the sender (appended as expert attribution) |
| `userId` | `string` | ✅ | Reviewer system user ID |

**Success Response** (`200 OK`):

```json
{
  "status": "success",
  "message": "Message sent successfully",
  "langGraphAppended": true,
  "langGraphThreadId": "919876543210-2026-05-30"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | `"success"` |
| `message` | `string` | Human-readable status |
| `langGraphAppended` | `boolean` | Whether the message was saved to LangGraph history |
| `langGraphThreadId` | `string` | Thread ID where the message was appended |

**Error Responses**:

| Status | Condition |
|---|---|
| `400 Bad Request` | Missing required fields |
| `403 Forbidden` | Invalid API key |
| `500 Internal Server Error` | WhatsApp API send failure |

---

### `POST /whatsapp/reviewer-webhook`

**Purpose**: Receive real-time notifications when an expert answers a pending question. This is an alternative to polling — the reviewer desk can push answers directly.

**Authentication**: Internal API key

**Headers**:

| Header | Type | Required |
|---|---|---|
| `x-internal-api-key` | `string` | ✅ |
| `Content-Type` | `application/json` | ✅ |

**Request Body**:

```json
{
  "question_id": "q-uuid-abc123",
  "status": "closed",
  "answer": "Apply Trichoderma at 2kg per acre before sowing.",
  "author": "Dr. Patel",
  "sources": [
    { "source": "IIHR Bangalore Research Paper", "page": "42" },
    { "source": "KVK Extension Bulletin" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `question_id` | `string` | ✅ | Pending question UUID |
| `status` | `string` | ✅ | Must be `"closed"` for processing |
| `answer` | `string` | ✅ | Expert's answer text |
| `author` | `string` | ⬜ | Expert's name |
| `sources` | `array` | ⬜ | Reference sources |
| `sources[].source` | `string` | ✅ | Source name or URL |
| `sources[].page` | `string\|null` | ⬜ | Page reference |

**Success Response** (`200 OK`):

```
OK
```

Processing happens asynchronously in the background. The endpoint returns immediately.

---

### `GET /whatsapp/test-poll`

**Purpose**: Manually trigger the reviewer system polling job (instead of waiting for the cron schedule).

**Authentication**: Internal API key

**Headers**:

| Header | Type | Required |
|---|---|---|
| `x-internal-api-key` | `string` | ✅ |

**Success Response** (`200 OK`):

```
Polling triggered successfully! Check your server logs.
```

---

### `GET /whatsapp/users/count`

**Purpose**: Get the total number of unique users who have interacted with the bot.

**Authentication**: Internal API key

**Headers**:

| Header | Type | Required |
|---|---|---|
| `x-internal-api-key` | `string` | ✅ |

**Success Response** (`200 OK`):

```json
{
  "uniqueUserCount": 42
}
```

---

### `GET /whatsapp/users`

**Purpose**: List all users with their engagement statistics.

**Authentication**: Internal API key

**Headers**:

| Header | Type | Required |
|---|---|---|
| `x-internal-api-key` | `string` | ✅ |

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `isPaginated` | `string` | ✅ | — | `"true"` for paginated, `"false"` for all |
| `skip` | `string` | ⬜ | `0` | Offset for pagination |
| `limit` | `string` | ⬜ | `20` | Page size (max 100) |

**Success Response** (`200 OK`):

```json
{
  "data": [
    {
      "phoneNumber": "919876543210",
      "messageCount": 15,
      "firstMessageAt": "2026-01-15T10:30:00.000Z",
      "lastMessageAt": "2026-05-30T08:15:00.000Z",
      "firstMessageText": "Namaste, how to grow tomatoes?",
      "lastMessageText": "What is best fertilizer for rice?"
    }
  ],
  "total": 42,
  "skip": 0,
  "limit": 20,
  "isPaginated": true
}
```

| Field | Type | Description |
|---|---|---|
| `data` | `array` | User objects sorted by `lastMessageAt` descending |
| `data[].phoneNumber` | `string` | User's WhatsApp number |
| `data[].messageCount` | `number` | Total messages sent (after location set) |
| `data[].firstMessageAt` | `string` | ISO timestamp of first interaction |
| `data[].lastMessageAt` | `string` | ISO timestamp of most recent interaction |
| `data[].firstMessageText` | `string\|null` | Text of first LangGraph-bound message |
| `data[].lastMessageText` | `string` | Text of most recent message |
| `total` | `number` | Total user count |
| `skip` | `number` | Current offset |
| `limit` | `number` | Current page size |
| `isPaginated` | `boolean` | Whether pagination was applied |

**Error Responses**:

| Status | Condition |
|---|---|
| `400 Bad Request` | `isPaginated` not provided, or invalid `skip`/`limit` values |
| `403 Forbidden` | Invalid API key |

---

## Error Responses

All error responses follow NestJS standard format:

```json
{
  "statusCode": 400,
  "message": "Descriptive error message",
  "error": "Bad Request"
}
```

| Status Code | Meaning |
|---|---|
| `400 Bad Request` | Missing/invalid request parameters |
| `403 Forbidden` | Authentication failure (invalid token, signature, or API key) |
| `500 Internal Server Error` | Server-side processing failure |

---

## Webhook Payload Types

### Message Types Handled

| `message.type` | Action |
|---|---|
| `text` | Text message → LangGraph processing → AI reply |
| `audio` (with `voice: true`) | Voice note → STT → LangGraph → Voice + text reply |
| `location` | Location share → Stored in LangGraph thread state |
| `reaction` | Emoji reaction (👍/👎 only) → Appended to thread as feedback |
| All other types | Logged and ignored |

### Status Updates

Status updates (`value.statuses`) with types `sent`, `delivered`, `read`, `failed` are silently ignored.

### Group Events

Group lifecycle, settings, and participant updates are silently ignored.

### Call Events

Call webhooks arrive with `change.field === "calls"`:

| Event | Action |
|---|---|
| `connect` | Initiate WebRTC, create Gemini session, accept call |
| `terminate` | Clean up resources, close connections |
