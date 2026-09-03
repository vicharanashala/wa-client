# AjraSakha — WhatsApp AI Agricultural Assistant

> A WhatsApp Business API client for AjraSakha that connects farmers with agricultural assistance through text, voice notes, location sharing, and WhatsApp calls.

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

**AjraSakha** (`wa-client`) is a NestJS service that receives WhatsApp Cloud API webhooks and manages conversations with the AjraSakha LangGraph service. It accepts text, voice notes, and location messages; sends replies through WhatsApp; and supports incoming WhatsApp calls.

The service also records user and conversation-related state in MongoDB, sends progress updates while a reply is being prepared, and integrates with the reviewer system for questions and expert responses.

### Business Objective

Make agricultural assistance accessible over WhatsApp by:

1. **Receiving farmer questions** as text messages, voice notes, or calls
2. **Passing conversation context** to the configured LangGraph assistant
3. **Returning text and voice responses** through the WhatsApp Business API
4. **Supporting expert review** when a question is sent to the reviewer system

---

## Key Features

| Category | Capability |
|---|---|
| **WhatsApp Messaging** | Receives text, voice, and location webhooks; sends text and voice replies |
| **Conversation Orchestration** | Uses LangGraph threads to preserve per-user conversation context |
| **Progress Updates** | Sends configurable WhatsApp updates while text or voice responses are being prepared |
| **Voice Processing** | Transcribes voice notes and creates WhatsApp voice responses with Sarvam AI |
| **Real-Time Calling** | Handles incoming WhatsApp calls through a WebRTC and Gemini Live bridge |
| **Reviewer Workflow** | Supports reviewer polling, reviewer webhooks, and manual outbound reviewer messages |
| **Location Context** | Stores shared location in the conversation state for the LangGraph assistant |
| **Access Control** | Applies whitelist or blacklist rules backed by MongoDB |
| **User Records** | Tracks WhatsApp users and exposes authenticated user-statistics endpoints |
| **Webhook Security** | Verifies Meta webhook subscriptions and HMAC-SHA256 signatures |
| **CQRS Architecture** | Uses NestJS CQRS command handlers for message-processing flows |

---

## Architecture

```
┌──────────────────────┐
│ Meta WhatsApp Cloud  │
│     Business API     │
└──────────┬───────────┘
           │ Webhooks and outbound messages
           ▼
┌──────────────────────┐
│  WhatsApp Controller │
│ Subscription + HMAC  │
│     verification     │
└──────────┬───────────┘
           │
           ├───────────────────────────────┐
           ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│ Conversation handlers │         │    Calling service   │
│ Text, voice, location │         │ WebRTC + Gemini Live │
└───────┬───────┬───────┘         └──────────────────────┘
        │       │
        │       └───────────┐
        ▼                   ▼
┌──────────────┐  ┌──────────────────────┐
│  Sarvam AI   │  │  LangGraph service   │
│  STT / TTS   │  │ Conversation threads │
└──────────────┘  └───────┬───────┬──────┘
                           │       │
                           ▼       ▼
                    ┌──────────┐ ┌─────────────────┐
                    │ MongoDB  │ │ Reviewer system │
                    │  state   │ │ questions/answers│
                    └──────────┘ └─────────────────┘
```

For the detailed module and request-flow documentation, see [docs/architecture.md](docs/architecture.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20 |
| **Framework** | NestJS 11 with `@nestjs/cqrs` |
| **Language** | TypeScript 5.7 |
| **Database** | MongoDB with Mongoose 9 |
| **Local Infrastructure** | Docker Compose with MongoDB 7 and Redis 7 |
| **Conversation Orchestration** | LangGraph SDK and a configured LangGraph service |
| **AI Services** | Configurable LLM endpoint, Sarvam AI, and Gemini Live |
| **Calling** | WebRTC via werift and Opus audio processing |
| **Tool Integration** | Model Context Protocol (MCP) adapters |
| **Container Runtime** | Docker, s6-overlay, and Tailscale userspace networking |
| **CI/CD** | GitHub Actions, Docker Hub, and Google Cloud Run |

---

## Quick Start

### Prerequisites

- **Node.js** 20.x
- **MongoDB** (local or managed)
- **Docker and Docker Compose** for the included local infrastructure
- A **Meta WhatsApp Business API** app and phone-number credentials
- Credentials for the LangGraph service and any enabled AI services

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

Set the required credentials and connection values in `.env`. Review `config.yaml` for application configuration and use `config.example.yaml` as a reference when changing it.

See [docs/setup.md](docs/setup.md), [CONFIG_README.md](CONFIG_README.md), and [ENV_VARIABLES.md](ENV_VARIABLES.md) for configuration details.

### 3. Start the Application

```bash
# Start MongoDB and Redis, then run the application with hot reload
npm run docker:dev

# Or, with MongoDB already available, run the application locally
npm run start:dev
```

To start the full Docker Compose stack, including the application, run:

```bash
npm run docker:up
```

### 4. Configure WhatsApp Webhook

1. Open the [Meta Developer Dashboard](https://developers.facebook.com/)
2. Set the callback URL to `https://<your-domain>/whatsapp/webhook`
3. Set the verify token to the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to the `messages` and `calls` webhook fields used by this service

### 5. Build for Production

```bash
npm run build
npm run start:prod
```

---

## Project Structure

```
wa-client/
├── src/
│   ├── main.ts                          # Application bootstrap and global validation
│   ├── app.module.ts                    # Root module, configuration, and MongoDB wiring
│   ├── config/                          # YAML configuration and validation
│   └── whatsapp/                        # WhatsApp feature modules
│       ├── whatsapp.controller.ts       # Webhook and internal HTTP endpoints
│       ├── whatsapp-api/                # Meta Graph API client
│       ├── conversations/               # CQRS text, voice, location, and progress flows
│       ├── calling/                     # WhatsApp calls, WebRTC, and Gemini Live
│       ├── pending-questions/           # Reviewer polling and answer processing
│       ├── access-control/              # Whitelist and blacklist rules
│       ├── sarvam-api/                  # Speech-to-text and text-to-speech integration
│       ├── script-detection/            # Script detection for message handling
│       ├── user-details/                # User-detail persistence
│       └── user-stats/                  # WhatsApp user records and statistics
├── docs/                                # Setup, architecture, API, security, and deployment guides
├── s6-scripts/                          # Tailscale and Node service scripts for the container
├── .github/workflows/
│   └── cloudrun-deploy.yml              # Staging and production Cloud Run deployment
├── .env.example                         # Environment variable template
├── config.yaml                          # Application configuration
├── config.example.yaml                  # Configuration reference
├── docker-compose.yml                   # Local application and infrastructure services
├── Dockerfile                           # Production container image
├── TAILSCALE.md                         # Tailscale runtime networking guide
└── package.json                         # Dependencies and scripts
```

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/whatsapp/webhook` | Verify token | Meta webhook subscription verification |
| `POST` | `/whatsapp/webhook` | HMAC-SHA256 | Incoming message, status, and call events |
| `POST` | `/whatsapp/send-message` | `x-internal-api-key` | Send an outbound reviewer or administrator message |
| `POST` | `/whatsapp/reviewer-webhook` | `x-internal-api-key` | Receive an expert answer from the reviewer system |
| `GET` | `/whatsapp/test-poll` | `x-internal-api-key` | Trigger reviewer polling manually |
| `GET` | `/whatsapp/users/count` | `x-internal-api-key` | Return the unique-user count |
| `GET` | `/whatsapp/users` | `x-internal-api-key` | List tracked users; supports pagination parameters |

Full API documentation: [docs/api-reference.md](docs/api-reference.md)

---

## Configuration

The application loads configuration from two places:

| Source | Purpose |
|---|---|
| `.env` | Credentials, service URLs, database connections, and deployment-specific values |
| `config.yaml` | Application settings, feature flags, MCP servers, audio settings, and logging configuration |

Environment variables are validated at startup and can override supported `config.yaml` settings. Start with `.env.example`, then consult the [configuration guide](CONFIG_README.md) and [environment-variable reference](ENV_VARIABLES.md).

---

## Deployment

The active deployment workflow, [cloudrun-deploy.yml](.github/workflows/cloudrun-deploy.yml), is run manually from GitHub Actions. It builds a Docker image, publishes it to Docker Hub, and can deploy separate staging and production revisions to Google Cloud Run.

The production container runs the Node.js service and Tailscale through s6-overlay. Tailscale provides the userspace network path used for configured LangGraph traffic. See [TAILSCALE.md](TAILSCALE.md) for setup and operational details.

For local containers, use the Docker Compose commands in [Quick Start](#quick-start). For deployment requirements and operational guidance, see [docs/deployment.md](docs/deployment.md).

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, module responsibilities, and request flows |
| [Setup Guide](docs/setup.md) | Prerequisites, configuration, local development, and tests |
| [API Reference](docs/api-reference.md) | Endpoint payloads, authentication, and webhook events |
| [Database](docs/database.md) | MongoDB collections, schemas, indexes, and data handling |
| [Deployment](docs/deployment.md) | Docker, CI/CD, infrastructure, and operations guidance |
| [Security](docs/security.md) | Webhook verification, authentication, secrets, and safeguards |
| [Troubleshooting](docs/troubleshooting.md) | Common setup, webhook, voice, and deployment issues |
| [Configuration Guide](CONFIG_README.md) | YAML configuration and configuration access patterns |
| [Environment Variables](ENV_VARIABLES.md) | Required and optional environment settings |
| [Tailscale Integration](TAILSCALE.md) | Container networking and Tailscale setup |

---

## Contributing

1. Create a feature branch from `main`
2. Follow the existing NestJS module and CQRS patterns
3. Add or update configuration through `config.yaml` and its validation schema when needed
4. Keep credentials and other sensitive values out of version control
5. Run `npm run lint` and the relevant tests before committing
6. Refer to [docs/architecture.md](docs/architecture.md) for module and flow guidance

---

## License

UNLICENSED — Proprietary. All rights reserved by Annam.AI Foundation.
