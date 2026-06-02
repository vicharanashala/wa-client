# Architecture Documentation

> System architecture, component interactions, data flows, and design decisions for the AjraSakha WhatsApp AI Assistant.

---

## Table of Contents

- [System Overview](#system-overview)
- [High-Level Architecture](#high-level-architecture)
- [Module Architecture](#module-architecture)
- [Request/Response Flows](#requestresponse-flows)
- [Component Interactions](#component-interactions)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Design Patterns](#design-patterns)
- [Developer Guide](#developer-guide)

---

## System Overview

AjraSakha is a **NestJS monolithic application** structured as a modular monolith. The application serves as the communication bridge between:

1. **Meta WhatsApp Cloud API** — Inbound/outbound messaging
2. **LangGraph/Aegra Server** — AI agent orchestration with tool calling
3. **MCP Tool Servers** — Domain-specific data sources (crop prices, weather, government schemes)
4. **Reviewer System (Vicharanashala Desk)** — Human expert review platform
5. **Sarvam AI** — Indian-language Speech-to-Text and Text-to-Speech
6. **Gemini Live** — Real-time voice conversation via WebSocket

```mermaid
graph TB
    subgraph "External Services"
        META["Meta WhatsApp<br/>Cloud API"]
        AEGRA["LangGraph<br/>Aegra Server"]
        MCP["MCP Tool Servers<br/>(7+ services)"]
        REVIEWER["Reviewer Desk<br/>(Vicharanashala)"]
        SARVAM["Sarvam AI<br/>(STT/TTS)"]
        GEMINI["Gemini Live<br/>(Voice AI)"]
        ANTHROPIC["Anthropic<br/>(Localization)"]
    end

    subgraph "wa-client Application"
        CTRL["WhatsApp Controller"]
        CMD["CQRS Command Bus"]
        LANG["LangGraph Client"]
        CALL["Calling Service"]
        POLL["Reviewer Polling"]
        WA_SVC["WhatsApp Service"]
        SARVAM_SVC["Sarvam Service"]
        ACC["Access Control"]
        STATS["User Stats"]
        LOCALIZE["Answer Localization"]
    end

    subgraph "Data Layer"
        MONGO[("MongoDB")]
    end

    META -->|Webhook| CTRL
    CTRL -->|Commands| CMD
    CTRL -->|Call events| CALL
    CMD -->|Text/Voice| LANG
    CMD -->|Voice| SARVAM_SVC
    LANG -->|Runs| AEGRA
    AEGRA -->|Tools| MCP
    CALL -->|Audio stream| GEMINI
    CALL -->|Voice tools| MCP
    POLL -->|Check answers| REVIEWER
    POLL -->|Localize| LOCALIZE
    LOCALIZE -->|Translate| ANTHROPIC
    POLL -->|Notify user| WA_SVC
    WA_SVC -->|Graph API| META
    SARVAM_SVC -->|API| SARVAM
    ACC -->|Query| MONGO
    STATS -->|Upsert| MONGO
    POLL -->|Pending Qs| MONGO
    LANG -->|Thread state| AEGRA
```

---

## Module Architecture

### Module Dependency Tree

```mermaid
graph TD
    APP["AppModule"]
    APP --> CONFIG["ConfigModule<br/>(Global)"]
    APP --> MONGOOSE["MongooseModule"]
    APP --> WA["WhatsappModule"]

    WA --> CQRS["CqrsModule"]
    WA --> CONV["ConversationModule"]
    WA --> PQ["PendingQuestionsModule"]
    WA --> CALLING["CallingModule"]
    WA --> AC["AccessControlModule"]
    WA --> US["UserStatsModule"]

    CONV --> LG["LangGraphModule"]
    CONV --> WA_API["WhatsappApiModule"]
    CONV --> SARV["SarvamModule"]
    CONV --> PQ
    CONV --> US
```

### Module Responsibilities

| Module | Location | Responsibility |
|---|---|---|
| `AppModule` | `src/app.module.ts` | Root module. Registers ConfigModule (global), MongooseModule, WhatsappModule |
| `WhatsappModule` | `src/whatsapp/whatsapp.module.ts` | Registers controller, imports sub-modules, provides WhatsappService |
| `ConversationModule` | `src/whatsapp/conversations/conversation.module.ts` | CQRS command handlers for text, voice, and location messages |
| `LangGraphModule` | `src/whatsapp/conversations/langgraph.module.ts` | LangGraph SDK client for Aegra server communication |
| `CallingModule` | `src/whatsapp/calling/calling.module.ts` | Real-time VoIP: WebRTC, Opus codec, Gemini Live, MCP tools |
| `PendingQuestionsModule` | `src/whatsapp/pending-questions/pending-questions.module.ts` | Expert review pipeline: persistence, polling, webhook, localization |
| `AccessControlModule` | `src/whatsapp/access-control/access-control.module.ts` | Whitelist/blacklist phone number gating |
| `UserStatsModule` | `src/whatsapp/user-stats/user-stats.module.ts` | User engagement tracking and analytics |
| `SarvamModule` | `src/whatsapp/sarvam-api/sarvam.module.ts` | Sarvam AI integration for STT and TTS |
| `WhatsappApiModule` | `src/whatsapp/whatsapp-api/whatsapp-api.module.ts` | Meta Graph API wrapper for outbound messaging |

---

## Request/Response Flows

### Text Message Flow

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant M as Meta Cloud API
    participant C as WhatsApp Controller
    participant AC as Access Control
    participant CB as CQRS Command Bus
    participant TH as AddUserTextMessageHandler
    participant LG as LangGraph Client
    participant AG as Aegra Server
    participant MCP as MCP Tools
    participant WA as WhatsApp Service
    participant DB as MongoDB

    U->>M: Send text message
    M->>C: POST /whatsapp/webhook (signed)
    C->>C: Verify HMAC-SHA256 signature
    C->>AC: isNumberAllowed(phoneNumber)
    AC->>DB: Check whitelist/blacklist
    DB-->>AC: allowed: true
    AC-->>C: ✅ Allowed

    C->>WA: sendTextMessage(ack)
    WA->>M: "🌱 Answer is getting generated..."
    M->>U: Acknowledgment received

    C->>CB: execute(AddUserTextMessageCommand)
    CB->>TH: handle(command)
    TH->>LG: prepareDailyThread(phone)
    TH->>WA: showTyping(messageId)
    TH->>LG: hasLocation(phone)
    
    alt No location set
        LG-->>TH: false
        TH->>WA: sendLocationRequest(phone)
        WA->>M: Location request interactive message
        M->>U: "Share your location"
    else Has location
        LG-->>TH: true
        TH->>LG: sendMessage(phone, content)
        LG->>AG: runs.wait(threadId, assistantId, input)
        AG->>MCP: Tool calls (weather, crop prices, etc.)
        MCP-->>AG: Tool results
        AG-->>LG: Final state with AI reply
        LG-->>TH: {reply, reviewId}
        
        TH->>DB: recordMessage(phone, content)
        
        opt reviewId present
            TH->>DB: create(pendingQuestion)
        end
        
        TH->>WA: sendTextMessage(phone, reply)
        WA->>M: Outbound message
        M->>U: AI response delivered
    end
```

### Voice Message Flow

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant M as Meta Cloud API
    participant C as WhatsApp Controller
    participant VH as AddUserVoiceMessageHandler
    participant WA as WhatsApp Service
    participant SAR as Sarvam AI
    participant LG as LangGraph Client
    participant AG as Aegra Server

    U->>M: Send voice note
    M->>C: POST /whatsapp/webhook (audio type)
    C->>WA: sendTextMessage(ack)
    C->>VH: execute(AddUserVoiceMessageCommand)
    
    VH->>LG: prepareDailyThread(phone)
    VH->>LG: hasLocation(phone)
    
    VH->>WA: downloadMedia(mediaId)
    WA->>M: GET media URL
    M-->>WA: audio buffer
    
    VH->>SAR: transcribeToEnglish(buffer, mimeType)
    SAR-->>VH: {transcript, languageCode}
    
    VH->>LG: sendMessage(phone, transcript)
    LG->>AG: runs.wait(...)
    AG-->>LG: AI reply
    LG-->>VH: {reply, reviewId}
    
    VH->>SAR: synthesizeChunks(voiceText, languageCode)
    SAR-->>VH: audioBuffers[]
    
    loop Each audio chunk
        VH->>WA: uploadMedia(buffer)
        WA->>M: Upload OGG/Opus
        M-->>WA: mediaId
        VH->>WA: sendVoiceMessage(phone, mediaId)
    end
    
    VH->>WA: sendTextMessage(phone, reply)
    
    Note over U: User receives both voice notes AND text
```

### VoIP Call Flow

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant M as Meta Cloud API
    participant C as WhatsApp Controller
    participant CS as Calling Service
    participant PC as WebRTC PeerConnection
    participant AC as Audio Codec
    participant GL as Gemini Live WS
    participant MCP as MCP Tools

    U->>M: Initiate VoIP call
    M->>C: POST /webhook (calls field, event=connect)
    C->>CS: handleIncomingCall(callId, phone, sdpOffer)
    
    CS->>PC: new RTCPeerConnection()
    CS->>PC: addTransceiver('audio', sendrecv)
    CS->>PC: setRemoteDescription(sdpOffer)
    CS->>PC: createAnswer()
    CS->>PC: setLocalDescription(answer)
    CS->>PC: Wait for ICE gathering complete
    
    CS->>GL: createSession(callbacks)
    GL->>GL: Connect WebSocket to Gemini
    GL->>GL: Send setup (model, tools, system instruction)
    GL-->>CS: onSetupComplete
    CS->>GL: sendGreeting() — Hindi welcome
    
    CS->>M: pre_accept(callId, sdpAnswer)
    CS->>M: accept(callId, sdpAnswer)
    CS->>CS: startSilenceFrames() — keep-alive
    
    loop During Call
        U->>PC: Audio RTP (Opus 48kHz)
        PC->>AC: decodeOpusToPcm16k(payload)
        AC-->>GL: sendAudio(pcmBase64)
        
        GL-->>CS: onAudio(pcmBase64, sampleRate)
        CS->>AC: encodePcmToOpus(pcmBase64, rate)
        AC-->>CS: opusFrames[]
        CS->>CS: Queue frames, drain at 20ms pacing
        CS->>PC: sendRtp(opusPacket)
        PC->>U: Audio response
        
        opt Tool call triggered
            GL->>MCP: callTool(name, args)
            MCP-->>GL: result
            GL->>GL: Send toolResponse to Gemini
        end
    end
    
    M->>C: POST /webhook (event=terminate)
    C->>CS: handleCallEnd(callId)
    CS->>GL: close()
    CS->>PC: close()
```

### Expert Review Pipeline

```mermaid
sequenceDiagram
    participant LG as LangGraph Agent
    participant TH as Message Handler
    participant DB as MongoDB
    participant POLL as Reviewer Polling
    participant DESK as Reviewer Desk
    participant LOC as Localization Service
    participant ANTHR as Anthropic API
    participant WA as WhatsApp Service
    participant U as User

    Note over LG: LangGraph calls upload_question_to_reviewer_system tool
    LG-->>TH: reply contains reviewId
    TH->>DB: pendingQuestionRepo.create({questionId, phone, queryText})
    
    alt Webhook Path (real-time)
        DESK->>POLL: POST /reviewer-webhook {question_id, answer}
        POLL->>DB: findByQuestionId()
        POLL->>DB: markAnswered(questionId, answer)
    else Polling Path (every 2 hours)
        POLL->>DESK: POST /questions/check-status (batch)
        DESK-->>POLL: {question_id, status: "closed", answer}
        POLL->>DB: markAnswered(questionId, answer)
    end
    
    POLL->>LOC: localizeExpertWhatsAppNotification(params)
    LOC->>LOC: Detect question language (script analysis + STT code)
    
    alt Non-English question
        LOC->>ANTHR: Translate labels + answer to user's language
        ANTHR-->>LOC: Localized notification
    else English question
        LOC-->>POLL: English notification (no translation)
    end
    
    POLL->>WA: sendTextMessage(phone, notification)
    WA->>U: "✅ Your question has been reviewed by an expert!"
    
    POLL->>LG: appendAiMessage(phone, notification)
    POLL->>DB: markNotified(questionId)
```

---

## Component Interactions

### LangGraph Client — Thread Management

The `LangGraphClientService` is the central orchestration layer for AI conversations:

- **Thread ID Strategy**: `{phoneNumber}-{YYYY-MM-DD}` (IST timezone) — one thread per user per day
- **Daily Handover**: At IST midnight boundary, yesterday's thread is summarized (via `summaryAssistantId`), the summary stored in LangGraph `store`, and location state is carried forward
- **Thread Repair**: If a thread has orphaned tool calls (AI message with `tool_calls` but no tool responses), the service injects synthetic tool responses before retrying
- **Thread Reset**: As a last resort, corrupted threads are deleted and recreated (loses history)

### MCP Tool Integration

Two separate MCP integrations exist:

1. **Text Pipeline**: Tools are integrated server-side within the LangGraph/Aegra agent. The wa-client doesn't directly manage text MCP tools — it just forwards messages to the agent.

2. **Voice Pipeline**: The `McpToolsService` discovers and invokes tools directly from the wa-client during Gemini Live calls. It connects to 8 MCP servers on startup:
   - `golden` — Golden dataset queries
   - `pop` — Package of Practices
   - `agmarknet` — Agricultural market prices
   - `enam` — National Agriculture Market
   - `weather` — IMD weather data
   - `faq-videos` — FAQ video references
   - `golden-n` — Extended golden dataset
   - `govt-schemes` — Government agricultural schemes

### Audio Processing Pipeline

```mermaid
graph LR
    subgraph "Inbound (User → Gemini)"
        A["Opus RTP<br/>48kHz mono"] -->|decode| B["PCM 48kHz<br/>16-bit LE"]
        B -->|resample 3:1| C["PCM 16kHz<br/>16-bit LE"]
        C -->|base64| D["Gemini Live<br/>WebSocket"]
    end

    subgraph "Outbound (Gemini → User)"
        E["Gemini PCM<br/>24kHz base64"] -->|decode| F["PCM 24kHz"]
        F -->|resample| G["PCM 48kHz"]
        G -->|encode| H["Opus frames"]
        H -->|20ms pacing| I["RTP packets"]
    end
```

The audio codec service uses `@discordjs/opus` for Opus encoding/decoding and linear interpolation for sample rate conversion (48kHz ↔ 16kHz/24kHz). Silence frames are sent during idle periods to keep the WebRTC connection alive.

---

## Design Patterns

### CQRS (Command Query Responsibility Segregation)

All user-initiated actions are dispatched as **commands** through NestJS's `CommandBus`:

| Command | Handler | Trigger |
|---|---|---|
| `AddUserTextMessageCommand` | `AddUserTextMessageHandler` | Incoming text message |
| `AddUserVoiceMessageCommand` | `AddUserVoiceMessageHandler` | Incoming voice note |
| `SetUserLocationCommand` | `SetUserLocationHandler` | Incoming location share |

This separation ensures the controller remains thin — it only handles HTTP concerns (signature verification, access control gating) and delegates business logic to handlers.

### Repository Pattern

Database access is abstracted through **abstract repository classes** with concrete MongoDB implementations:

| Abstract | Concrete | Collection |
|---|---|---|
| `PendingQuestionRepository` | `MongoPendingQuestionRepository` | `pending_questions` |
| `WhatsappUserRepository` | `MongoWhatsappUserRepository` | `whatsapp_users` |

This allows swapping storage backends without changing business logic.

### Fire-and-Forget with Error Boundaries

The controller dispatches commands asynchronously with `.catch()` error handlers:

```typescript
this.commandBus
  .execute(new AddUserTextMessageCommand(...))
  .catch((err) => this.logger.error(`Command failed: ${err.message}`));
```

This ensures the webhook always returns `200 OK` to Meta immediately, while processing happens in the background. If processing fails, errors are logged but don't cause webhook retries.

---

## Developer Guide

### Adding a New Message Type Handler

1. Create a new directory under `src/whatsapp/conversations/application/`
2. Define a **Command** class and a **CommandHandler** class in a single file
3. Register the handler as a provider in `ConversationModule`
4. Add webhook parsing logic in `WhatsappController.receive()`

### Adding a New MCP Server

1. Add the server configuration to `config.yaml` under `mcp.servers.text` and/or `mcp.servers.voice`
2. For voice calls: Add the server URL to `McpToolsService.MCP_SERVERS`
3. For text: The LangGraph agent handles MCP tool integration server-side

### Adding a New API Endpoint

1. Add the route handler method to `WhatsappController`
2. Use `@Headers('x-internal-api-key')` for internal endpoints
3. Call `this.assertInternalApiKey(apiKey)` for authentication
4. Add request/response types inline or in dedicated DTO files

### Coding Standards

- **Module Pattern**: Every feature is a NestJS module with its own folder
- **Service Injection**: Use constructor injection with NestJS DI
- **Error Handling**: Log errors with NestJS `Logger`, never throw uncaught exceptions in async handlers
- **Naming**: PascalCase for classes, camelCase for methods/properties, kebab-case for file names
- **Configuration**: Secrets in `.env`, everything else in `config.yaml`
- **Linting**: ESLint + Prettier (run `npm run lint` and `npm run format`)
