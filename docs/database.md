# Database Documentation

> MongoDB schema design, collections, indexes, relationships, and migration strategy for the AjraSakha WhatsApp AI Assistant.

---

## Table of Contents

- [Database Architecture](#database-architecture)
- [Connection Configuration](#connection-configuration)
- [Collections](#collections)
  - [pending_questions](#pending_questions)
  - [whatsapp_users](#whatsapp_users)
  - [whitelist](#whitelist)
  - [blacklist](#blacklist)
- [Indexes](#indexes)
- [Entity Relationship Diagram](#entity-relationship-diagram)
- [Important Queries](#important-queries)
- [External State Stores](#external-state-stores)
- [Migration Process](#migration-process)
- [Data Retention](#data-retention)

---

## Database Architecture

The application uses **MongoDB** as its primary persistence layer. The architecture follows a **lean local storage** pattern — the bulk of conversation state (messages, thread history, user profiles) is managed by the external **LangGraph/Aegra server**. MongoDB stores only:

1. **Operational state** — Pending questions awaiting expert review
2. **Analytics** — User interaction statistics
3. **Access control** — Whitelist/blacklist phone numbers

```mermaid
graph TB
    subgraph "MongoDB (wa-client)"
        PQ["pending_questions"]
        WU["whatsapp_users"]
        WL["whitelist"]
        BL["blacklist"]
    end

    subgraph "LangGraph/Aegra Server"
        THREADS["Threads<br/>(per user per day)"]
        STATE["Thread State<br/>(messages, location)"]
        STORE["Store<br/>(farmer profiles,<br/>daily summaries)"]
    end

    subgraph "Application"
        APP["wa-client"]
    end

    APP --> PQ
    APP --> WU
    APP --> WL
    APP --> BL
    APP --> THREADS
    APP --> STATE
    APP --> STORE
```

---

## Connection Configuration

**Connection URI**: Set via `MONGO_URI` environment variable.

```env
# Local development
MONGO_URI=mongodb://localhost:27017/whatsapp-bot

# MongoDB Atlas (production)
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/whatsapp-bot?retryWrites=true&w=majority
```

**Connection Options** (from `config.yaml`):

```yaml
database:
  mongodb:
    options:
      retryWrites: true
      w: 'majority'
```

The connection is established at startup via NestJS `MongooseModule.forRootAsync()` in `AppModule`.

---

## Collections

### `pending_questions`

**Purpose**: Tracks questions that have been uploaded to the reviewer system and are awaiting expert answers.

**Schema**: `PendingQuestionModel`
**File**: `src/whatsapp/pending-questions/pending-question.schema.ts`

| Field | Type | Required | Default | Index | Description |
|---|---|---|---|---|---|
| `questionId` | `String` | ✅ | — | ✅ Single | UUID from the reviewer system |
| `phoneNumber` | `String` | ✅ | — | ✅ Single | User's WhatsApp phone number |
| `queryText` | `String` | ✅ | — | — | Original question text (English translation) |
| `toolCallId` | `String` | ✅ | — | — | LangChain `tool_call_id` for traceability |
| `originalMessageId` | `String` | ⬜ | `null` | — | WhatsApp `wamid` — enables quoted replies |
| `langGraphThreadId` | `String` | ⬜ | `null` | — | Thread ID when question was created (`phone-YYYY-MM-DD`) |
| `questionLanguageCode` | `String` | ⬜ | `null` | — | BCP-47 language code from Sarvam STT (for localization) |
| `status` | `String` | ✅ | `'pending'` | ✅ Single | `'pending'` \| `'answered'` \| `'notified'` |
| `answer` | `String` | ⬜ | `null` | — | Expert's answer (populated when answered) |
| `answeredAt` | `Date` | ⬜ | `null` | — | Timestamp when answer was received |
| `notifiedAt` | `Date` | ⬜ | `null` | — | Timestamp when user was notified |
| `createdAt` | `Date` | Auto | Auto | — | Mongoose timestamp |
| `updatedAt` | `Date` | Auto | Auto | — | Mongoose timestamp |

**Lifecycle**:

```mermaid
stateDiagram-v2
    [*] --> pending: Question uploaded to reviewer
    pending --> answered: Expert provides answer
    answered --> notified: User notified via WhatsApp
    notified --> [*]
    
    note right of pending
        Checked by cron (every 2h)
        or webhook push
    end note
    
    note right of answered
        Answer stored, localized,
        sent to user
    end note
```

---

### `whatsapp_users`

**Purpose**: Tracks unique users and their message counts for analytics.

**Schema**: `WhatsappUserModel`
**File**: `src/whatsapp/user-stats/whatsapp-user.schema.ts`

| Field | Type | Required | Default | Unique | Index | Description |
|---|---|---|---|---|---|---|
| `phoneNumber` | `String` | ✅ | — | ✅ | ✅ Single | User's WhatsApp phone number |
| `messageCount` | `Number` | ✅ | `0` | — | — | Total messages sent (post-location) |
| `firstMessageAt` | `Date` | ✅ | — | — | — | Timestamp of first interaction |
| `lastMessageAt` | `Date` | ✅ | — | — | ✅ Descending | Timestamp of most recent interaction |
| `lastMessageText` | `String` | ✅ | — | — | — | Text of the last message sent |
| `firstMessageText` | `String` | ⬜ | `null` | — | — | Text of the first LangGraph-bound message |
| `createdAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |
| `updatedAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |

**Write Pattern**: Upsert on each message — if user exists, increment `messageCount` and update `lastMessageAt`/`lastMessageText`; if new, insert with initial values.

> **Note**: Only messages that pass the location gate (i.e., after the user has shared their location and LangGraph processing begins) are counted. Acknowledgment messages, location requests, and access-denied responses are not tracked.

---

### `whitelist`

**Purpose**: Phone numbers allowed to interact with the bot in **development mode** (`IS_PRODUCTION=false`).

**Schema**: `WhitelistModel`
**File**: `src/whatsapp/access-control/whitelist.schema.ts`

| Field | Type | Required | Default | Unique | Index | Description |
|---|---|---|---|---|---|---|
| `phoneNumber` | `String` | ✅ | — | ✅ | ✅ Single | Phone number (with country code) |
| `name` | `String` | ✅ | — | — | — | Identifier / label for this entry |
| `isActive` | `Boolean` | ⬜ | `true` | — | — | Whether this entry is active |
| `addedBy` | `String` | ⬜ | `null` | — | — | Who added this entry |
| `notes` | `String` | ⬜ | `null` | — | — | Optional notes |
| `createdAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |
| `updatedAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |

**Management**: Entries are managed directly via MongoDB (no API endpoints for CRUD).

---

### `blacklist`

**Purpose**: Phone numbers blocked from interacting with the bot in **production mode** (`IS_PRODUCTION=true`).

**Schema**: `BlacklistModel`
**File**: `src/whatsapp/access-control/blacklist.schema.ts`

| Field | Type | Required | Default | Unique | Index | Description |
|---|---|---|---|---|---|---|
| `phoneNumber` | `String` | ✅ | — | ✅ | ✅ Single | Phone number (with country code) |
| `name` | `String` | ✅ | — | — | — | Identifier / label |
| `reason` | `String` | ⬜ | `null` | — | — | Why this number was blacklisted |
| `isActive` | `Boolean` | ⬜ | `true` | — | — | Whether this block is active |
| `addedBy` | `String` | ⬜ | `null` | — | — | Who added this entry |
| `createdAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |
| `updatedAt` | `Date` | Auto | Auto | — | — | Mongoose timestamp |

**Management**: Entries are managed directly via MongoDB (no API endpoints for CRUD).

---

## Indexes

### Explicit Indexes

| Collection | Index | Type | Purpose |
|---|---|---|---|
| `pending_questions` | `{ questionId: 1 }` | Single field | Fast lookup by reviewer question ID |
| `pending_questions` | `{ phoneNumber: 1 }` | Single field | Lookup by user phone number |
| `pending_questions` | `{ status: 1 }` | Single field | Filter pending/answered/notified |
| `pending_questions` | `{ status: 1, createdAt: 1 }` | Compound | Efficient polling queries (pending + oldest first) |
| `whatsapp_users` | `{ phoneNumber: 1 }` | Single field, unique | Primary lookup by phone |
| `whatsapp_users` | `{ lastMessageAt: -1 }` | Single field, descending | User list sorted by recency |
| `whitelist` | `{ phoneNumber: 1 }` | Single field, unique | Access control lookup |
| `blacklist` | `{ phoneNumber: 1 }` | Single field, unique | Access control lookup |

### Implicit Indexes

All collections have the default `_id` index created by MongoDB.

---

## Entity Relationship Diagram

```mermaid
erDiagram
    PENDING_QUESTIONS {
        string questionId PK "UUID from reviewer system"
        string phoneNumber FK "Links to whatsapp_users"
        string queryText "Original question"
        string toolCallId "LangChain trace"
        string originalMessageId "WhatsApp wamid"
        string langGraphThreadId "Thread for expert append"
        string questionLanguageCode "BCP-47 for localization"
        string status "pending | answered | notified"
        string answer "Expert answer"
        date answeredAt
        date notifiedAt
    }

    WHATSAPP_USERS {
        string phoneNumber PK "User identifier"
        number messageCount "Total messages"
        date firstMessageAt
        date lastMessageAt
        string firstMessageText
        string lastMessageText
    }

    WHITELIST {
        string phoneNumber PK "Allowed phone"
        string name "Label"
        boolean isActive
        string addedBy
        string notes
    }

    BLACKLIST {
        string phoneNumber PK "Blocked phone"
        string name "Label"
        string reason
        boolean isActive
        string addedBy
    }

    WHATSAPP_USERS ||--o{ PENDING_QUESTIONS : "phoneNumber"
    WHITELIST ||--o| WHATSAPP_USERS : "phoneNumber (logical)"
    BLACKLIST ||--o| WHATSAPP_USERS : "phoneNumber (logical)"
```

> **Note**: Relationships are logical (application-enforced), not MongoDB foreign keys. The `phoneNumber` field serves as the natural join key across collections.

---

## Important Queries

### Polling for Pending Questions

```javascript
// Find all questions awaiting expert review
db.pending_questions.find({ status: 'pending' }).sort({ createdAt: 1 });
```

### User Analytics

```javascript
// Count unique users
db.whatsapp_users.countDocuments();

// Paginated user list sorted by most recent activity
db.whatsapp_users
  .find({})
  .sort({ lastMessageAt: -1 })
  .skip(0)
  .limit(20);
```

### Access Control

```javascript
// Check if number is whitelisted (dev mode)
db.whitelist.findOne({ phoneNumber: '919876543210', isActive: true });

// Check if number is blacklisted (prod mode)
db.blacklist.findOne({ phoneNumber: '919876543210', isActive: true });
```

### Manual Whitelist Management

```javascript
// Add a number to whitelist
db.whitelist.insertOne({
  phoneNumber: '919876543210',
  name: 'Test Farmer',
  isActive: true,
  addedBy: 'admin',
  notes: 'Dev testing'
});

// Deactivate a whitelist entry
db.whitelist.updateOne(
  { phoneNumber: '919876543210' },
  { $set: { isActive: false } }
);
```

---

## External State Stores

### LangGraph/Aegra Server

The majority of conversation state is stored on the LangGraph server, **not in MongoDB**:

| Data | Storage Location | Thread ID Format |
|---|---|---|
| Message history | LangGraph thread state | `{phone}-{YYYY-MM-DD}` |
| User location | LangGraph thread state (`location` field) | Per-thread |
| Farmer profiles | LangGraph store (`farmer_profiles/{phone}`) | Persistent |
| Daily summaries | LangGraph store (`daily_summary_{date}`) | Persistent |
| Tool call results | LangGraph thread state | Per-run |

> **Requires clarification from the development team**: The LangGraph/Aegra server's own persistence layer (SQLite, PostgreSQL, or cloud storage) and its backup/recovery strategy are not documented in this repository.

### Redis

Redis is referenced in `docker-compose.yml` and `.env.example` but is **not actively used** in the current codebase. The `enableCaching` feature flag defaults to `false`. Redis infrastructure is provisioned for future caching implementation.

---

## Migration Process

### Current Approach

The application uses **Mongoose schema-based migrations** — there is no dedicated migration tool or versioned migration files:

1. Schema changes are made in the `*.schema.ts` files
2. Mongoose handles schema updates automatically on connection
3. New fields are added with `default: null` to maintain backward compatibility with existing documents
4. Indexes are created declaratively in schema files using `@Prop({ index: true })` and `SchemaFactory`

### Adding a New Field

1. Add the `@Prop()` decorator to the schema class with `{ default: null }` for backward compatibility
2. Update the abstract repository interface if the field affects queries
3. Update the concrete MongoDB repository implementation
4. Existing documents will remain valid — Mongoose treats missing fields as `undefined`

### Index Management

Indexes defined in schema files are created automatically when the application connects to MongoDB. To verify indexes:

```javascript
db.pending_questions.getIndexes();
db.whatsapp_users.getIndexes();
```

> **Requires clarification from the development team**: There is no versioned migration tool (e.g., `migrate-mongo`) configured. For production schema changes that require data backfills, a manual migration script would need to be created.

---

## Data Retention

> **Requires clarification from the development team**: No explicit data retention or cleanup policies are implemented in the codebase. The `pending_questions` collection will grow indefinitely as questions accumulate. Consider implementing:
>
> - TTL indexes for old `notified` questions
> - Archival strategy for `whatsapp_users` data
> - GDPR-compliant data deletion endpoints
