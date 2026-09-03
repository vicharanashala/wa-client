# AjraSakha — WhatsApp AI Agricultural Assistant

> A WhatsApp bot for Indian farmers that delivers agricultural assistance through text, voice notes, location sharing, and expert-review integration.

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

**AjraSakha** (`wa-client`) is a [NestJS](https://nestjs.com/) WhatsApp Business API integration that uses CQRS to handle text, voice-note, and location messages. It connects each WhatsApp user to the configured LangGraph service and sends replies through the WhatsApp Business API.

### Business Objective

Make agricultural assistance accessible to farmers by:

1. **Answering farming questions** received as text messages or voice notes
2. **Passing conversation and location context** to the configured LangGraph assistant
3. **Routing selected questions** to the expert-review workflow
4. **Delivering answers** back to farmers through WhatsApp text and voice notes

---

## Key Features

| Category | Capability |
|---|---|
| **Multi-Modal Input** | Text messages, voice notes, and location messages |
| **AI-Powered Responses** | LangGraph conversation orchestration with configured MCP tools |
| **Voice Processing** | Sarvam AI speech-to-text for voice notes and text-to-speech for replies |
| **Progress Updates** | Configurable WhatsApp messages while a text or voice response is being prepared |
| **Expert Review Pipeline** | Reviewer polling, reviewer webhooks, and manual outbound reviewer messages |
| **Location Context** | Shared locations are written to the associated LangGraph conversation state |
| **Access Control** | MongoDB-backed whitelist and blacklist rules |
| **User Analytics** | User records, unique-user counts, and authenticated user-list endpoints |
| **CQRS Architecture** | Dedicated command handlers for text, voice, and location flows |
| **Webhook Security** | Meta subscription verification and HMAC-SHA256 signature validation |

---

## Architecture

```
┌──────────────────────┐
│  Meta WhatsApp Cloud │
│    Business API      │
└──────────┬───────────┘
           │ Webhook (POST /whatsapp/webhook)
           ▼
┌──────────────────────┐     ┌─────────────────┐
│  WhatsApp Controller │────▶│ CQRS Command Bus │
│  (Signature verify)  │     │    (NestJS)      │
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
          │ Conversation thread │              │ (Location Update)  │
          │  ┌───────────────┐  │              └────────────────────┘
          │  │ Configured    │  │
          │  │ MCP Tools     │  │
          │  └───────────────┘  │
          └──────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ MongoDB  │  │ Reviewer │  │ WhatsApp API │
│ (State)  │  │ System   │  │ (Outbound)   │
└──────────┘  └──────────┘  └──────────────┘
```

For complete architecture documentation including data-flow diagrams and sequence diagrams, see [docs/architecture.md](docs/architecture.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20 on Alpine Linux in the production container |
| **Framework** | NestJS 11 with CQRS (`@nestjs/cqrs`) |
| **Language** | TypeScript 5.7 |
| **Database** | MongoDB with Mongoose 9 |
| **Local Infrastructure** | Docker Compose with MongoDB 7 and Redis 7 |
| **AI Orchestration** | LangGraph SDK with a configured LangGraph service |
| **Voice AI** | Sarvam AI (speech-to-text and text-to-speech) |
| **Protocol** | Model Context Protocol (MCP) adapters for configured tools |
| **Container** | Multi-stage Docker build with s6-overlay and Tailscale userspace networking |
| **CI/CD** | GitHub Actions → Docker Hub → Google Cloud Run |

---

## Quick Start

### Prerequisites

- **Node.js** 20.x
- **MongoDB** (local or managed)
- **Docker and Docker Compose** for the included local services
- **Meta WhatsApp Business API** credentials for a verified phone number
- Credentials for the LangGraph service, LLM provider, Sarvam AI, and reviewer system

### 1. Clone & Install

```bash
git clone <repository-url>
cd wa-client
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with the required credentials and connection values. Review `config.yaml` for version-controlled application settings; `config.example.yaml` is a reference template.

See [docs/setup.md](docs/setup.md), [CONFIG_README.md](CONFIG_README.md), and [ENV_VARIABLES.md](ENV_VARIABLES.md) for configuration details.

### 3. Start Infrastructure

```bash
# Start MongoDB and Redis, then run the application with hot reload
npm run docker:dev

# Or, use an existing MongoDB instance and run the application locally
npm run start:dev
```

To start the full Docker Compose stack, including the application, run:

```bash
npm run docker:up
```

### 4. Configure WhatsApp Webhook

1. Go to the [Meta Developer Dashboard](https://developers.facebook.com/)
2. Set the webhook URL to `https://<your-domain>/whatsapp/webhook`
3. Set the verify token to match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`
4. Subscribe to the `messages` field

### 5. Run

```bash
# Development (with hot reload)
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
│   ├── main.ts                          # Application bootstrap and global validation
│   ├── app.module.ts                    # Root module (configuration, MongoDB, WhatsApp)
│   ├── config/                          # YAML configuration and validation
│   │   ├── configuration.ts             # YAML loader with environment overrides
│   │   ├── config.schema.ts             # Validation schemas
│   │   ├── validate-config.ts           # Configuration validation
│   │   ├── app-config.service.ts        # Typed configuration accessor
│   │   └── index.ts                     # Barrel exports
│   └── whatsapp/                        # Core WhatsApp module
│       ├── whatsapp.module.ts           # Module registration
│       ├── whatsapp.controller.ts       # Webhook and internal HTTP endpoints
│       ├── manual-outbound-message.ts   # Reviewer message formatting
│       ├── whatsapp-api/                # Meta Graph API integration
│       │   ├── whatsapp.service.ts      # Send text, voice, location, and media
│       │   ├── whatsapp.config.ts       # API URL construction
│       │   └── whatsapp-api.module.ts   # Module
│       ├── conversations/               # CQRS conversation pipeline
│       │   ├── conversation.module.ts   # Module registration
│       │   ├── langgraph-client.service.ts # LangGraph SDK wrapper
│       │   ├── response-progress.service.ts # Progress-message lifecycle
│       │   ├── langgraph.module.ts      # Module
│       │   └── application/             # Command handlers
│       │       ├── add-user-text-message/
│       │       ├── add-user-voice-message/
│       │       └── set-user-location/
│       ├── pending-questions/           # Expert-review pipeline
│       │   ├── reviewer-polling.service.ts      # Polling and webhook answer handling
│       │   ├── reviewer-answer-localization.service.ts # Reviewer answer localization
│       │   ├── pending-question.schema.ts       # Mongoose schema
│       │   ├── pending-question.repository.ts   # Abstract repository
│       │   ├── mongo-pending-question.repository.ts # MongoDB implementation
│       │   └── pending-questions.module.ts      # Module
│       ├── access-control/              # Whitelist and blacklist rules
│       ├── sarvam-api/                  # Speech-to-text and text-to-speech
│       ├── script-detection/            # Message-script detection
│       ├── user-details/                # User-detail persistence
│       └── user-stats/                  # User analytics and records
├── test/                                # End-to-end tests
├── docs/                                # Detailed technical documentation
├── s6-scripts/                          # Tailscale and Node container services
├── config.yaml                          # Application configuration
├── config.example.yaml                  # Example configuration
├── .env.example                         # Environment variable template
├── Dockerfile                           # Production container image
├── docker-compose.yml                   # Local application and infrastructure services
├── .github/workflows/
│   └── cloudrun-deploy.yml              # Staging and production deployment
├── TAILSCALE.md                         # Runtime networking guide
└── package.json                         # Dependencies and scripts
```

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/whatsapp/webhook` | Verify token | WhatsApp webhook subscription verification |
| `POST` | `/whatsapp/webhook` | HMAC-SHA256 | Incoming message and status events |
| `POST` | `/whatsapp/send-message` | `x-internal-api-key` | Send an outbound reviewer or administrator message |
| `POST` | `/whatsapp/reviewer-webhook` | `x-internal-api-key` | Receive reviewer-system answers |
| `GET` | `/whatsapp/test-poll` | `x-internal-api-key` | Manually trigger reviewer polling |
| `GET` | `/whatsapp/users/count` | `x-internal-api-key` | Return the unique-user count |
| `GET` | `/whatsapp/users` | `x-internal-api-key` | List tracked users; supports pagination parameters |

Full API documentation: [docs/api-reference.md](docs/api-reference.md)

---

## Configuration

The application uses a **dual-layer configuration** system:

| Layer | File | Purpose |
|---|---|---|
| **Environment** | `.env` | Credentials, service URLs, database connections, and deployment-specific values |
| **Application Config** | `config.yaml` | Application settings, MCP servers, feature flags, audio settings, and logging |

Environment variables are validated at startup and can override supported `config.yaml` values. Start with `.env.example`, then consult [CONFIG_README.md](CONFIG_README.md) and [ENV_VARIABLES.md](ENV_VARIABLES.md).

---

## Deployment

Production deployment uses:

- **Docker** images published to Docker Hub
- **Google Cloud Run** for staging and production services
- **Tailscale** userspace networking for configured LangGraph traffic
- **GitHub Actions** in [cloudrun-deploy.yml](.github/workflows/cloudrun-deploy.yml) for build and deployment

```bash
# Build the production image
docker build -t wa-client .

# Start the local Docker Compose stack
npm run docker:up
```

For deployment requirements and operational guidance, see [docs/deployment.md](docs/deployment.md) and [TAILSCALE.md](TAILSCALE.md).

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flows, and sequence diagrams |
| [Setup Guide](docs/setup.md) | Prerequisites, environment variables, and local development |
| [API Reference](docs/api-reference.md) | Endpoints, payloads, authentication, and webhook events |
| [Database](docs/database.md) | MongoDB collections, schemas, and indexes |
| [Deployment](docs/deployment.md) | Docker, CI/CD, infrastructure, and operations guidance |
| [Security](docs/security.md) | Authentication, secrets, and webhook verification |
| [Troubleshooting](docs/troubleshooting.md) | Common setup, webhook, voice, and deployment issues |
| [Configuration Guide](CONFIG_README.md) | YAML configuration and configuration access patterns |
| [Environment Variables](ENV_VARIABLES.md) | Required and optional environment settings |
| [Tailscale Integration](TAILSCALE.md) | Container networking and Tailscale setup |

---

## Contributing

1. Create a feature branch from `main`
2. Follow the existing NestJS module pattern (module → service → repository)
3. Use the CQRS pattern for new message-handling flows
4. Add entries to `config.yaml` and its validation schema for new configurable values
5. Keep credentials and other sensitive values out of version control
6. Run `npm run lint` and relevant tests before committing
7. See [docs/architecture.md](docs/architecture.md) for developer guidance

---

## License

UNLICENSED — Proprietary. All rights reserved by Annam.AI Foundation.
