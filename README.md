# WhatsApp AI Bot with MongoDB & Redis

Production-ready WhatsApp bot using NestJS, CQRS, MongoDB for persistence, Redis for caching, and OpenAI-compatible LLM API.

## Features

- ✅ **CQRS Architecture** - Clean command/query separation
- ✅ **MongoDB Integration** - Persistent conversation history
- ✅ **Redis Caching** - Fast message retrieval with fallback to DB
- ✅ **LLM Integration** - OpenAI-compatible API support (Ajarsaka, etc.)
- ✅ **WhatsApp Business API** - Meta Graph API integration
- ✅ **Production Ready** - Error handling, logging, health checks
- ✅ **Special Commands** - `/clear`, `/help` built-in commands

## Quick Start

### 1. Environment Setup

Copy and configure environment variables:

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Services

**MongoDB:**
```bash
# Using Docker
docker run -d --name mongodb -p 27017:27017 mongo:latest

# Or use MongoDB Atlas cloud service
```

**Redis (Optional but recommended):**
```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:alpine
```

### 4. Configure WhatsApp Business API

1. Set up Meta Business App
2. Get Phone Number ID and Access Token
3. Configure webhook URL: `https://yourdomain.com/whatsapp/webhook`
4. Set webhook verify token in `.env`

### 5. Configure LLM Service

**For Ajarsaka or local LLM:**
```env
LLM_BASE_URL=http://localhost:4123/v1
LLM_API_KEY=dummy-key
LLM_MODEL=default
```

**For OpenAI:**
```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-api-key
LLM_MODEL=gpt-3.5-turbo
```

### 6. Run the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Endpoints

- `GET /whatsapp/webhook` - WhatsApp webhook verification
- `POST /whatsapp/webhook` - Receive WhatsApp messages  
- `GET /whatsapp/health` - Health check endpoint

## Built-in Commands

Users can send these commands via WhatsApp:

- **Any message** - Chat with AI
- **/clear** - Clear conversation history
- **/help** - Show help message

## Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   WhatsApp      │───▶│  Controller  │───▶│  Command    │
│   Webhook       │    │              │    │  Handler    │
└─────────────────┘    └──────────────┘    └─────────────┘
                                                   │
                       ┌─────────────┐    ┌─────────────┐
                       │    Redis    │◀──▶│  LLM Service│
                       │   (Cache)   │    │             │
                       └─────────────┘    └─────────────┘
                                                   │
                       ┌─────────────┐    ┌─────────────┐
                       │  MongoDB    │◀──▶│ WhatsApp    │
                       │(Persistence)│    │ Outbound    │
                       └─────────────┘    └─────────────┘
```

## Flow

1. **Message Received** → Controller validates and dispatches command
2. **Cache Check** → Try to get conversation history from Redis
3. **Database Fallback** → If cache miss, fetch from MongoDB and update cache
4. **LLM Processing** → Send context + new message to AI API
5. **Response Handling** → Save to cache + database, send via WhatsApp API

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MONGO_URI` | MongoDB connection string | Yes | `mongodb://localhost:27017/whatsapp-bot` |
| `REDIS_HOST` | Redis host | No | `localhost` |
| `META_ACCESS_TOKEN` | WhatsApp Business API token | Yes | - |
| `PHONE_NUMBER_ID` | WhatsApp Phone Number ID | Yes | - |
| `WEBHOOK_VERIFY_TOKEN` | Webhook verification token | Yes | - |
| `LLM_BASE_URL` | LLM API base URL | Yes | `http://localhost:8000/v1` |
| `LLM_API_KEY` | LLM API key | No | `dummy-key` |
| `SYSTEM_PROMPT` | AI system prompt | No | Default assistant prompt |

## Production Deployment

1. **Set environment to production:**
   ```env
   NODE_ENV=production
   ```

2. **Use production databases:**
   - MongoDB Atlas or managed MongoDB
   - Redis Cloud or managed Redis

3. **Configure proper logging:**
   ```env
   LOG_LEVEL=warn
   ```

4. **Use process manager:**
   ```bash
   # PM2
   pm2 start dist/main.js --name whatsapp-bot

   # Or Docker
   docker build -t whatsapp-bot .
   docker run -d --env-file .env -p 3000:3000 whatsapp-bot
   ```

5. **Set up reverse proxy (nginx/traefik) for HTTPS**

## Monitoring

- Health check: `GET /whatsapp/health`
- Logs include processing times and error details
- Monitor Redis/MongoDB connections

## Troubleshooting

**Common Issues:**

1. **Webhook not verified:** Check `WEBHOOK_VERIFY_TOKEN` matches Meta setup
2. **Messages not processed:** Check logs for LLM/database connection errors  
3. **Cache not working:** Verify Redis connection, app will fallback to DB-only mode
4. **WhatsApp send failures:** Verify `META_ACCESS_TOKEN` and `PHONE_NUMBER_ID`

**Debug Mode:**
```bash
LOG_LEVEL=debug npm run start:dev
```