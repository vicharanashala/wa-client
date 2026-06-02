# AjraSakha — WhatsApp AI Agricultural Assistant

> An AI-powered WhatsApp bot built for Indian farmers, delivering expert agricultural advice through text, voice, and real-time phone calls — backed by human reviewer verification, multi-lingual localization, and a rich ecosystem of domain-specific MCP tool servers.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**AjraSakha** (`wa-client`) is a production-grade WhatsApp Business API integration built on [NestJS](https://nestjs.com/) using CQRS architecture. It serves as the communication layer of the **Annam.AI Foundation** platform — connecting Indian farmers with AI-driven agricultural intelligence through WhatsApp text, voice notes, and real-time VoIP calls.

### Business Objective

Provide accessible, multilingual agricultural advisory services to Indian farmers who may be illiterate or semi-literate, by:

1. **Answering farming questions** via text or voice in the farmer's local language
2. **Routing unanswered questions** to human expert reviewers for quality assurance
3. **Delivering expert-reviewed answers** back to farmers, automatically localized
4. **Providing real-time voice consultations** via WhatsApp VoIP calls powered by Gemini Live

---

## Key Features

| Category | Capability |
|---|---|
| **Multi-Modal Input** | Text messages, voice notes (STT via Sarvam AI), real-time VoIP calls |
| **AI-Powered Responses** | LangGraph agent orchestration with MCP tool integration |
| **Voice Output** | Text-to-Speech via Sarvam AI, delivered as WhatsApp voice notes |
| **Real-Time Calling** | WebRTC ↔ Gemini Live bridge for live voice conversations |
| **Expert Review Pipeline** | Questions auto-uploaded to reviewer system; answers polled/webhoooked and localized |
| **Multi-Lingual** | Auto-detects 10+ Indian languages; translates expert answers via Claude |
| **Access Control** | Whitelist (dev) / Blacklist (prod) system backed by MongoDB |
| **User Analytics** | Unique user counts, message history, engagement tracking |
| **CQRS Architecture** | Clean command/query separation for maintainable business logic |
| **Production Hardened** | Webhook signature verification, thread repair, graceful error handling |

---

## Architecture

```
┌──────────────────────┐
│  Meta WhatsApp Cloud  │
│    Business API       │
└──────────┬───────────┘
           │ Webhook (POST /whatsapp/webhook)
           ▼
┌──────────────────────┐     ┌─────────────────┐
│  WhatsApp Controller │────▶│   CQRS Command  │
│  (Signature verify)  │     │   Bus (NestJS)   │
└──────────────────────┘     └────────┬────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ AddUserText     │     │ AddUserVoice     │     │ SetUserLocation  │
│ MessageHandler  │     │ MessageHandler   │     │ Handler          │
└────────┬────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                       │                         │
         │              ┌────────▼─────────┐               │
         │              │  Sarvam AI STT   │               │
         │              │  (Voice → Text)  │               │
         │              └────────┬─────────┘               │
         │                       │                         │
         └───────────┬───────────┘                         │
                     ▼                                     ▼
          ┌─────────────────────┐              ┌────────────────────┐
          │  LangGraph Client   │              │  LangGraph Client  │
          │  (Aegra Server)     │              │  (Location Update) │
          │  ┌───────────────┐  │              └────────────────────┘
          │  │ MCP Tool      │  │
          │  │ Servers (7+)  │  │
          │  └───────────────┘  │
          └──────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ MongoDB  │  │ Reviewer  │  │ WhatsApp API │
│ (State)  │  │ System    │  │ (Outbound)   │
└──────────┘  └──────────┘  └──────────────┘
```

For complete architecture documentation including data flow diagrams and sequence diagrams, see [docs/architecture.md](docs/architecture.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20 (Debian Bookworm Slim) |
| **Framework** | NestJS 11 with CQRS (`@nestjs/cqrs`) |
| **Language** | TypeScript 5.7 |
| **Database** | MongoDB 7 (Mongoose 9) |
| **Cache** | Redis 7 (ioredis) — *referenced but not actively used* |
| **AI Orchestration** | LangGraph SDK (`@langchain/langgraph-sdk`) via Aegra server |
| **LLM Providers** | OpenAI-compatible APIs, Anthropic (Claude), Google Gemini |
| **Voice AI** | Sarvam AI (STT/TTS), Gemini Live (real-time voice) |
| **WebRTC** | werift (Node.js WebRTC), @discordjs/opus |
| **Protocol** | MCP (Model Context Protocol) for tool integration |
| **Secrets** | Infisical (production), `.env` (development) |
| **Container** | Docker (single-stage), docker-compose |
| **CI/CD** | GitHub Actions → Docker Hub → GCP VM via Tailscale |

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.x
- **MongoDB** ≥ 7.x (local or cloud — e.g., MongoDB Atlas)
- **Redis** ≥ 7.x *(optional — not actively used)*
- **Meta WhatsApp Business API** account with verified phone number
- **API Keys**: Sarvam AI, Gemini, LLM provider, LangGraph/Aegra server

### 1. Clone & Install

```bash
git clone <repository-url>
cd wa-client
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

Edit `.env` with your secrets (API keys, tokens, MongoDB URI).
Edit `config.yaml` for non-secret configuration (system prompts, MCP servers, feature flags).

See [docs/setup.md](docs/setup.md) for detailed configuration guide.

### 3. Start Infrastructure

```bash
# Option A: Docker (MongoDB + Redis)
npm run docker:dev

# Option B: Use managed cloud services
# Set MONGO_URI in .env to your Atlas connection string
npm run start:dev
```

### 4. Configure WhatsApp Webhook

1. Go to [Meta Developer Dashboard](https://developers.facebook.com/)
2. Set webhook URL: `https://yourdomain.com/whatsapp/webhook`
3. Set verify token to match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`
4. Subscribe to `messages` and `calls` fields

### 5. Run

```bash
# Development (with hot-reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

---

## Project Structure

```
wa-client/
├── src/
│   ├── main.ts                          # Application bootstrap
│   ├── app.module.ts                    # Root module (Config, MongoDB, WhatsApp)
│   ├── config/                          # Configuration subsystem
│   │   ├── configuration.ts             # YAML loader with env overrides
│   │   ├── config.schema.ts             # class-validator schemas
│   │   ├── validate-config.ts           # Validation logic
│   │   ├── app-config.service.ts        # Typed config accessor
│   │   └── index.ts                     # Barrel exports
│   └── whatsapp/                        # Core WhatsApp module
│       ├── whatsapp.module.ts           # Module registration
│       ├── whatsapp.controller.ts       # HTTP endpoints (webhook, API)
│       ├── manual-outbound-message.ts   # Expert message formatting
│       ├── whatsapp-api/                # Meta Graph API integration
│       │   ├── whatsapp.service.ts      # Send text/voice/location/media
│       │   ├── whatsapp.config.ts       # API URL construction
│       │   └── whatsapp-api.module.ts   # Module
│       ├── conversations/               # CQRS conversation pipeline
│       │   ├── conversation.module.ts   # Module registration
│       │   ├── langgraph-client.service.ts  # LangGraph SDK wrapper
│       │   ├── langgraph.module.ts      # Module
│       │   └── application/             # Command handlers
│       │       ├── add-user-text-message/
│       │       ├── add-user-voice-message/
│       │       └── set-user-location/
│       ├── calling/                     # Real-time VoIP module
│       │   ├── calling.service.ts       # WebRTC lifecycle & RTP pacing
│       │   ├── gemini-live.service.ts   # Gemini Live WebSocket bridge
│       │   ├── audio-codec.service.ts   # Opus ↔ PCM transcoding
│       │   ├── mcp-tools.service.ts     # MCP tool discovery for voice
│       │   └── calling.module.ts        # Module
│       ├── pending-questions/           # Expert review pipeline
│       │   ├── reviewer-polling.service.ts      # Cron polling + webhook handler
│       │   ├── reviewer-answer-localization.service.ts # Multi-lingual translation
│       │   ├── pending-question.schema.ts       # Mongoose schema
│       │   ├── pending-question.repository.ts   # Abstract repository
│       │   ├── mongo-pending-question.repository.ts # MongoDB implementation
│       │   └── pending-questions.module.ts       # Module
│       ├── access-control/             # Whitelist/Blacklist system
│       │   ├── access-control.service.ts
│       │   ├── whitelist.schema.ts
│       │   ├── blacklist.schema.ts
│       │   └── access-control.module.ts
│       ├── sarvam-api/                 # Speech-to-Text & Text-to-Speech
│       │   ├── sarvam.service.ts
│       │   └── sarvam.module.ts
│       └── user-stats/                 # User analytics
│           ├── whatsapp-user.schema.ts
│           ├── whatsapp-user.repository.ts
│           ├── mongo-whatsapp-user.repository.ts
│           └── user-stats.module.ts
├── test/                               # E2E tests
├── config.yaml                         # Non-secret configuration
├── config.example.yaml                 # Example config (version-controlled)
├── .env                                # Secrets (git-ignored)
├── .env.example                        # Secret template
├── Dockerfile                          # Production container
├── docker-compose.yml                  # Local dev infrastructure
├── .github/workflows/                  # CI/CD
│   └── dockerhub-build.yml             # Build → Deploy pipeline
└── package.json                        # Dependencies & scripts
```

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/whatsapp/webhook` | Verify Token | WhatsApp webhook subscription verification |
| `POST` | `/whatsapp/webhook` | HMAC-SHA256 | Incoming messages, statuses, and call events |
| `GET` | `/whatsapp/health` | None | Health check |
| `POST` | `/whatsapp/send-message` | `x-internal-api-key` | Send outbound message (expert/admin) |
| `POST` | `/whatsapp/reviewer-webhook` | `x-internal-api-key` | Receive real-time expert answers |
| `GET` | `/whatsapp/test-poll` | `x-internal-api-key` | Manually trigger reviewer polling |
| `GET` | `/whatsapp/users/count` | `x-internal-api-key` | Unique user count |
| `GET` | `/whatsapp/users` | `x-internal-api-key` | Paginated user list |

Full API documentation: [docs/api-reference.md](docs/api-reference.md)

---

## Configuration

The application uses a **dual-layer configuration** system:

| Layer | File | Purpose |
|---|---|---|
| **Secrets** | `.env` | API keys, tokens, database URIs — never committed |
| **Config** | `config.yaml` | System prompts, MCP servers, feature flags, thresholds — safe to commit |

Environment variables in `.env` can override `config.yaml` values at runtime.

Full configuration reference: [docs/setup.md](docs/setup.md)

---

## Deployment

Production deployment uses:
- **Docker** containers on a GCP VM
- **Infisical** for secrets management in production
- **Tailscale** mesh VPN for secure CI/CD access
- **GitHub Actions** for automated build → push → deploy pipeline

```bash
# Manual Docker deployment
docker build -t wa-bot .
docker run -d --env-file .env -p 3000:3000 wa-bot

# Via docker-compose (includes MongoDB + Redis)
docker-compose up -d
```

Full deployment guide: [docs/deployment.md](docs/deployment.md)

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flows, sequence diagrams |
| [Setup Guide](docs/setup.md) | Prerequisites, environment variables, local development |
| [API Reference](docs/api-reference.md) | All endpoints, payloads, authentication |
| [Database](docs/database.md) | MongoDB collections, schemas, indexes |
| [Deployment](docs/deployment.md) | CI/CD, Docker, infrastructure, rollback |
| [Security](docs/security.md) | Auth, secrets, webhook verification |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and resolution steps |

---

## Contributing

1. Create a feature branch from `main`
2. Follow the existing NestJS module pattern (module → service → repository)
3. Use the CQRS pattern for new message-handling flows
4. Add entries to `config.yaml` for new configurable values
5. Keep secrets in `.env` only
6. Run `npm run lint` and `npm run format` before committing
7. See [docs/architecture.md](docs/architecture.md) for detailed developer guidance

---

## License

UNLICENSED — Proprietary. All rights reserved by Annam.AI Foundation.