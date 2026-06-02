# Setup & Installation Guide

> Complete guide for setting up the AjraSakha WhatsApp AI Assistant for local development and testing.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Configuration File (config.yaml)](#configuration-file-configyaml)
- [Infrastructure Setup](#infrastructure-setup)
- [WhatsApp Business API Setup](#whatsapp-business-api-setup)
- [Running the Application](#running-the-application)
- [Running Tests](#running-tests)
- [NPM Scripts Reference](#npm-scripts-reference)

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| **Node.js** | ≥ 20.x | Runtime environment |
| **npm** | ≥ 9.x | Package management |
| **MongoDB** | ≥ 7.x | Primary database |
| **Redis** | ≥ 7.x | Cache (optional — not actively used) |
| **Docker** | ≥ 24.x | Local infrastructure & production deployment |
| **Docker Compose** | ≥ 2.x | Multi-service orchestration |

### External Service Accounts Required

| Service | Purpose | Required |
|---|---|---|
| **Meta Business Platform** | WhatsApp Cloud API | ✅ Required |
| **LangGraph/Aegra Server** | AI agent orchestration | ✅ Required |
| **Sarvam AI** | Indian-language STT/TTS | ✅ Required for voice |
| **Google Gemini** | Real-time voice calls (Gemini Live) | ✅ Required for VoIP |
| **Anthropic** | Expert answer localization (Claude) | ⬜ Optional |

---

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd wa-client

# Install dependencies
npm install

# Copy configuration templates
cp .env.example .env
cp config.example.yaml config.yaml
```

> **Note**: The project uses native C++ modules (`@discordjs/opus`, `werift`) that require build tools. On Linux, ensure `python3`, `make`, and `g++` are installed. On macOS, install Xcode Command Line Tools.

---

## Environment Variables

The `.env` file contains **secrets only**. All non-secret configuration lives in `config.yaml`.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/whatsapp-bot` |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Business API access token | `EAA...` |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID | `1234567890` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook subscription verification token | `my-verify-token` |
| `WHATSAPP_META_APP_SECRET` | Meta app secret for HMAC signature verification | `abc123...` |
| `LLM_API_KEY` | API key for the primary LLM provider | `sk-...` |
| `SARVAM_API_KEY` | Sarvam AI API subscription key | `sarvam-...` |
| `GEMINI_API_KEY` | Google Gemini API key for voice calls | `AIza...` |
| `AEGRA_ASSISTANT_ID` | LangGraph assistant UUID on Aegra server | `9c6b5487-...` |

### Optional Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment (`development`, `production`, `test`) |
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `debug` | Logging level (`error`, `warn`, `info`, `debug`) |
| `IS_PRODUCTION` | `false` | Access control mode (`true` = blacklist, `false` = whitelist) |
| `LLM_BASE_URL` | `http://34.180.40.201:8081/v1` | LLM API base URL |
| `LLM_MODEL` | `Qwen/Qwen3-30B-A3B` | LLM model name |
| `MAX_TOKENS` | `1024` | Maximum tokens for LLM responses |
| `TEMPERATURE` | `0.7` | LLM temperature setting |
| `WHATSAPP_API_VERSION` | `v18.0` | Meta Graph API version |
| `REVIEWER_API_BASE_URL` | `http://100.100.108.44:9007/api` | Reviewer system API URL |
| `REVIEWER_POLL_INTERVAL_MS` | `7200000` | Reviewer polling interval (ms) |
| `REVIEWER_CRON_EXPRESSION` | `0 */2 * * *` | Cron expression for polling schedule |
| `REVIEWER_INTERNAL_API_KEY` | — | API key for internal endpoints |
| `ANTHROPIC_REVIEW_ANSWER_MODEL` | `claude-sonnet-4-5-20250929` | Anthropic model for localization |
| `AEGRA_SUMMARY_ASSISTANT_ID` | `summary_agent` | LangGraph summary assistant ID |
| `AEGRA_APPEND_AS_NODE` | — | Graph node name for `updateState` patches |
| `MCP_GOVT_SCHEMES_URL` | `http://100.100.108.44:9009/mcp` | Government schemes MCP override |

---

## Configuration File (config.yaml)

The `config.yaml` file contains all non-secret configuration. It is validated against a strict schema at startup.

### Structure Overview

```yaml
version: 1.0.0

app:                    # Application settings (port, environment, log level)
whatsapp:               # WhatsApp API version, message templates
llm:                    # LLM model settings, system prompt
mcp:                    # MCP server URLs and feature toggles
audio:                  # Opus codec and Gemini audio parameters
sarvam:                 # Sarvam AI STT/TTS configuration
gemini:                 # Gemini Live WebSocket settings
reviewer:               # Reviewer polling intervals and API endpoints
conversation:           # Message history limits, context memory settings
database:               # MongoDB and Redis connection options
features:               # Feature flags (voice calls, text chat, MCP, etc.)
rateLimit:              # Rate limiting configuration
logging:                # Logging format and per-module levels
```

### Key Configuration Sections

#### Feature Flags (`features`)

```yaml
features:
  enableVoiceCalls: true        # WebRTC VoIP call handling
  enableTextChat: true          # Text message processing
  enableReviewerPolling: true   # Cron-based reviewer system polling
  enableLocationServices: true  # Location requirement before chat
  enableMcpTools: true          # MCP tool integration for voice
  enableCaching: false          # Redis caching (not implemented)
```

#### MCP Servers (`mcp.servers`)

Separate server lists for text (used by LangGraph agent) and voice (used by Gemini Live):

```yaml
mcp:
  servers:
    text:
      reviewer:
        url: 'http://100.100.108.44:9007/mcp'
        enabled: true
      golden:
        url: 'http://100.100.108.44:9005/mcp'
        enabled: true
      # ... more servers
    voice:
      golden:
        url: 'http://100.100.108.44:9005/mcp'
        enabled: true
      # ... more servers
```

#### System Prompt (`llm.systemPrompt`)

The system prompt defines the AI agent's personality and behavior. It instructs the agent to:
1. Act as "AjraSakha" — an agricultural expert for Indian farmers
2. Follow a mandatory 10-step workflow (translate → upload to reviewer → get location → fetch data → respond)
3. Reply in the farmer's local language
4. Always include a disclaimer

### Configuration Validation

At startup, the configuration is:
1. Loaded from `config.yaml` via `js-yaml`
2. Merged with environment variable overrides
3. Validated against `ConfigSchema` using `class-validator` and `class-transformer`
4. MCP servers are validated individually for URL and enabled flag

If validation fails, the application throws a detailed error and refuses to start.

---

## Infrastructure Setup

### Option A: Docker Compose (Recommended for Development)

```bash
# Start MongoDB + Redis only (app runs locally with hot-reload)
npm run docker:dev

# Start everything including the app
npm run docker:up

# Optional admin tools (Mongo Express + Redis Commander)
docker-compose --profile tools up -d
```

**Admin UIs**:
- Mongo Express: http://localhost:8081 (admin/admin123)
- Redis Commander: http://localhost:8082 (admin/admin123)

### Option B: Cloud-Managed Services

Point to managed instances:

```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/whatsapp-bot?retryWrites=true&w=majority
```

### Option C: Manual Docker

```bash
docker run -d --name mongodb -p 27017:27017 mongo:7-jammy
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

---

## WhatsApp Business API Setup

### 1. Create Meta App

1. Go to [Meta Developer Dashboard](https://developers.facebook.com/)
2. Create a new app → Select "Business" type
3. Add the "WhatsApp" product

### 2. Configure Webhook

1. Navigate to WhatsApp → Configuration
2. Set **Callback URL**: `https://yourdomain.com/whatsapp/webhook`
3. Set **Verify Token**: Must match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`
4. Subscribe to webhook fields: **`messages`**, **`calls`** (for VoIP)

### 3. Retrieve Credentials

From the Meta Dashboard, obtain:
- **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **Temporary/Permanent Access Token** → `WHATSAPP_ACCESS_TOKEN`
- **App Secret** (Settings → Basic) → `WHATSAPP_META_APP_SECRET`

### 4. Expose Local Server (for Development)

Use ngrok, Cloudflare Tunnel, or similar to expose your local port:

```bash
ngrok http 3000
# Use the HTTPS URL as your webhook callback URL
```

---

## Running the Application

### Development

```bash
# Start with hot-reload and .env loaded
npm run start:dev

# Start with debug mode (Node inspector)
npm run start:debug
```

### Production

```bash
# Build TypeScript
npm run build

# Start production server
npm run start:prod
```

### Docker

```bash
# Build and run
docker build -t wa-bot .
docker run -d --env-file .env -p 3000:3000 wa-bot
```

### Startup Verification

On successful startup, you should see:

```
🚀 Application is running on: http://localhost:3000
📱 WhatsApp webhook: http://localhost:3000/whatsapp/webhook
🏥 Health check: http://localhost:3000/whatsapp/health
🌍 Environment: development
🧠 LLM Base URL: http://...
🗄️  MongoDB: ✅ Configured
📞 WhatsApp: ✅ Configured
🔐 Access Control initialized | mode=DEVELOPMENT | whitelist=N | blacklist=N
🕐 Reviewer polling cron job ACTIVE — schedule: "0 */2 * * *"
```

---

## Running Tests

```bash
# Unit tests
npm run test

# Unit tests with watch mode
npm run test:watch

# Unit tests with coverage
npm run test:cov

# E2E tests
npm run test:e2e

# Debug tests (with Node inspector)
npm run test:debug
```

> **Note**: Comprehensive automated tests are under active development. The existing e2e test scaffold is in `test/app.e2e-spec.ts`.

---

## NPM Scripts Reference

| Script | Command | Description |
|---|---|---|
| `start` | `nest start` | Start without hot-reload |
| `start:dev` | `dotenv -e .env -- nest start --watch` | Development with hot-reload |
| `start:debug` | `dotenv -e .env -- nest start --debug --watch` | Debug with inspector |
| `start:prod` | `node dist/main` | Production mode |
| `build` | `nest build && npm run copy:config` | Build TypeScript + copy config.yaml |
| `docker:dev` | `docker-compose up -d mongodb redis && npm run start:dev` | Infrastructure + dev server |
| `docker:up` | `docker-compose up -d` | Full stack via Docker |
| `docker:down` | `docker-compose down` | Stop Docker services |
| `docker:logs` | `docker-compose logs -f` | Follow Docker logs |
| `lint` | `eslint "{src,apps,libs,test}/**/*.ts" --fix` | Lint and auto-fix |
| `format` | `prettier --write "src/**/*.ts" "test/**/*.ts"` | Format code with Prettier |
| `test` | `jest` | Run unit tests |
| `test:watch` | `jest --watch` | Tests in watch mode |
| `test:cov` | `jest --coverage` | Tests with coverage report |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | End-to-end tests |
