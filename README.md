# WhatsApp AI Bot with MongoDB & Redis

A production-ready WhatsApp bot built using NestJS and CQRS architecture. It features persistent conversation history with MongoDB, high-performance caching via Redis, direct Meta Graph API integration, and an advanced conversational experience powered by various Language Models.

## ✨ Features

- ✅ **CQRS Architecture** - Clean command/query separation for maintainable logic.
- ✅ **MongoDB Integration** - Persistent conversations and user state tracking.
- ✅ **Redis Caching** - Fast message retrieval with robust DB fallbacks.
- ✅ **LLM Integration** - Multi-provider support (OpenAI-compatible APIs, Anthropic, Gemini, Vertex AI, Ajarsaka).
- ✅ **WhatsApp Business API** - Fully integrated with Meta's Graph API, including enhanced webhook signature verification and raw body handling.
- ✅ **Production Ready** - Comprehensive error handling, logging, health checks, and Dockerized deployments.
- ✅ **Interactive Commands** - Support for `/clear`, `/help` directly within the WhatsApp interface.

## 🚧 Work in Progress & Missing Features

The platform is actively evolving. The following features are considered "Missing" or "Under Active Development":

- 🟡 **Real-Time VoIP Voice Calling (Gemini Live)**
  - *Current Status:* An advanced WebRTC pipeline using `werift` and `@discordjs/opus` has been introduced to intercept WhatsApp SDP offers and bridge VoIP calls directly to Gemini Live multimodal websockets.
  - *Missing Elements:* Handling call failures, edge-cases in signaling/ice-gathering delays, dynamic network degradation adjustments, packet-loss concealment, and graceful connection teardown. The feature is functional but experimental.
- 🟡 **Model Context Protocol (MCP) Tools**
  - Tool calling within the voice and text pipelines to fetch dynamic data (e.g., executing backend actions dynamically during a live Gemini conversation). The foundational `mcp-tools.service.ts` is staged but requires broader integration.
- 🟡 **Rich Media Broadcasting & Analytics**
  - Advanced analytics dashboard to monitor token usage, track interaction paths, and measure webhook latency.
- 🟡 **Comprehensive Automated Testing**
  - e2e tests covering the complex asynchronous WebSocket and WebRTC lifecycle events.

## 🚀 Quick Start

### 1. Environment Setup

Copy and configure environment variables based on your setup:

```bash
cp .env.example .env
# Edit .env with your specific credentials
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Services (Docker)

Spin up MongoDB and Redis using Docker (or point to cloud instances like MongoDB Atlas / Redis Cloud):

```bash
# Start MongoDB & Redis via docker-compose or isolated docker run
npm run docker:dev
# Alternatively manually:
# docker run -d --name mongodb -p 27017:27017 mongo:latest
# docker run -d --name redis -p 6379:6379 redis:alpine
```

### 4. Configure WhatsApp Business API

1. Set up the **Meta Business App**.
2. Retrieve the **Phone Number ID** and **Access Token**.
3. Configure the webhook URL in Meta: `https://yourdomain.com/whatsapp/webhook`
4. Make sure you set the expected verify token in `.env`.

### 5. Configure LLM Services

The system supports multiple backends. Sample configuration:

```env
# Database
MONGO_URI=mongodb://localhost:27017/whatsapp-bot
REDIS_HOST=localhost

# WhatsApp
META_ACCESS_TOKEN=your-access-token
PHONE_NUMBER_ID=your-phone-id
WEBHOOK_VERIFY_TOKEN=your-verify-token

# LLM Examples
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-api-key
LLM_MODEL=gpt-3.5-turbo
GEMINI_API_KEY=your-gemini-key
```

### 6. Run the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 🔌 API Endpoints

- `GET /whatsapp/webhook` - WhatsApp webhook payload verification.
- `POST /whatsapp/webhook` - Core endpoint processing incoming messages and calls.
- `GET /whatsapp/health` - Standard health check validation.

## 🧩 Architecture Flow

```text
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   WhatsApp      │───▶│  Controller  │───▶│  Command    │
│ Webhook / Calls │    │              │    │  Handler    │
└─────────────────┘    └──────────────┘    └─────────────┘
                                                   │
                       ┌─────────────┐    ┌─────────────┐
                       │    Redis    │◀──▶│  LLM / AI   │
                       │   (Cache)   │    │   Services  │
                       └─────────────┘    └─────────────┘
                                                   │
                       ┌─────────────┐    ┌─────────────┐
                       │  MongoDB    │◀──▶│ WhatsApp    │
                       │(Persistence)│    │ Outbound    │
                       └─────────────┘    └─────────────┘
```

1. **Inbound Processing** → Webhook verification succeeds, parsing text or SDP (for calls).
2. **State Management** → Identify ongoing sessions or check Redis Cache (fallback to MongoDB).
3. **Execution** → Messages sent to unified LLM pipeline; calls routed to WebRTC logic bridging Opus audio to Gemini Live.
4. **Outbound Responses** → Generated text sent via WhatsApp Graph API; audio streams paced and dispatched as RTP packets via the active transceiver.

## 📈 Production Deployment

1. Ensure `NODE_ENV=production` is initialized.
2. Establish robust external Managed Databases (Atlas / ElastiCache).
3. Configure logging verbosity: `LOG_LEVEL=warn`.
4. Run through a process manager or direct container deployment:
   ```bash
   # PM2 Setup
   pm2 start dist/main.js --name wa-bot

   # Docker (Using included configuration)
   docker build -t wa-bot .
   docker run -d --env-file .env -p 3000:3000 wa-bot
   ```

## 🛠 Troubleshooting

1. **Webhook failures:** Double-check your `WEBHOOK_VERIFY_TOKEN` matches the Meta dashboard exactly. Verify that signature validations are passing.
2. **Messages aren't working:** Check outbound logic/logs for LLM ratelimits or database connection snags. 
3. **Audio / Call Dropouts:** Voice calling relies on UDP WebRTC traffic. Make sure your server doesn't block UDP ICE candidates, and that node process latency stays minimal.
4. **Debug Logging:** Run the application with `LOG_LEVEL=debug npm run start:dev` to expose detailed process tracks.