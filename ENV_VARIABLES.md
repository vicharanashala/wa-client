# Environment Variables Reference

This document provides a complete reference for all environment variables used in the WhatsApp AI Assistant application.

---

## Table of Contents

- [Required Variables](#required-variables)
- [Optional Variables (Configuration Overrides)](#optional-variables-configuration-overrides)
- [Unused/Legacy Variables](#unusedlegacy-variables)
- [Variable Details](#variable-details)

---

## Required Variables

These environment variables **MUST** be set in your `.env` file for the application to function correctly.

| Variable                        | Purpose                                  | Example                                  | Used In                       |
| ------------------------------- | ---------------------------------------- | ---------------------------------------- | ----------------------------- |
| `MONGO_URI`                     | MongoDB connection string                | `mongodb://localhost:27017/whatsapp-bot` | Database connection           |
| `WHATSAPP_ACCESS_TOKEN`         | WhatsApp Business API token              | `EAAxx...`                               | WhatsApp API authentication   |
| `WHATSAPP_PHONE_NUMBER_ID`      | WhatsApp phone number ID                 | `123456789`                              | WhatsApp API requests         |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook verification token               | `my_verify_token_123`                    | Webhook subscription          |
| `WHATSAPP_META_APP_SECRET`      | Meta app secret for signature validation | `abc123...`                              | Webhook security              |
| `LLM_API_KEY`                   | LLM service API key                      | `sk-...`                                 | LLM authentication            |
| `SARVAM_API_KEY`                | Sarvam AI API key                        | `sarvam_...`                             | Speech-to-Text/Text-to-Speech |
| `GEMINI_API_KEY`                | Google Gemini API key                    | `AIza...`                                | Voice call features           |

---

## Optional Variables (Configuration Overrides)

These variables can override settings from `config.yaml`. They are **optional** and have defaults.

### Application Configuration

| Variable    | Default       | Description                                           | Override Location                 |
| ----------- | ------------- | ----------------------------------------------------- | --------------------------------- |
| `NODE_ENV`  | `development` | Application environment (development/production/test) | `config.yaml` → `app.environment` |
| `PORT`      | `3000`        | HTTP server port                                      | `config.yaml` → `app.port`        |
| `LOG_LEVEL` | `debug`       | Logging level (error/warn/info/debug)                 | `config.yaml` → `app.logLevel`    |

### LLM Configuration

| Variable       | Default                        | Description                      | Override Location                  |
| -------------- | ------------------------------ | -------------------------------- | ---------------------------------- |
| `LLM_BASE_URL` | `http://34.180.40.201:8081/v1` | LLM API endpoint URL             | Used directly (not in config.yaml) |
| `LLM_MODEL`    | `Qwen/Qwen3-30B-A3B`           | LLM model name                   | `config.yaml` → `llm.defaultModel` |
| `MAX_TOKENS`   | `1024`                         | Maximum tokens for LLM responses | `config.yaml` → `llm.maxTokens`    |
| `TEMPERATURE`  | `0.7`                          | LLM temperature (0.0-2.0)        | `config.yaml` → `llm.temperature`  |

### WhatsApp Configuration

| Variable               | Default | Description                | Override Location                      |
| ---------------------- | ------- | -------------------------- | -------------------------------------- |
| `WHATSAPP_API_VERSION` | `v18.0` | WhatsApp Graph API version | `config.yaml` → `whatsapp.api.version` |

### Reviewer System Configuration

| Variable                    | Default                          | Description                      | Override Location                             |
| --------------------------- | -------------------------------- | -------------------------------- | --------------------------------------------- |
| `REVIEWER_API_BASE_URL`     | `http://100.100.108.43:9007/api` | Reviewer system API base URL     | `config.yaml` → `reviewer.api.defaultBaseUrl` |
| `REVIEWER_POLL_INTERVAL_MS` | `7200000` (2 hours)              | Polling interval in milliseconds | `config.yaml` → `reviewer.polling.intervalMs` |

---

## Unused/Legacy Variables

These variables are referenced in `.env.example` but are **not currently used** in the code:

| Variable            | Status          | Notes                                                    |
| ------------------- | --------------- | -------------------------------------------------------- |
| `REDIS_HOST`        | Not implemented | Only checked for logging; Redis functionality not active |
| `REDIS_PORT`        | Not implemented | Present in .env.example but not used in code             |
| `REDIS_PASSWORD`    | Not implemented | Present in .env.example but not used in code             |
| `REDIS_DB`          | Not implemented | Present in .env.example but not used in code             |
| `META_ACCESS_TOKEN` | Duplicate       | Alias for `WHATSAPP_ACCESS_TOKEN` (only used in logging) |

**Note**: If you plan to implement Redis caching, you can uncomment and use these variables.

---

## Variable Details

### Database Configuration

#### `MONGO_URI` **(REQUIRED)**

- **Type**: String (Connection URI)
- **Purpose**: MongoDB database connection string
- **Used in**: `src/app.module.ts:22`
- **Example**:
  ```env
  MONGO_URI=mongodb://localhost:27017/whatsapp-bot
  # Or for MongoDB Atlas:
  MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database
  ```
- **Notes**: Must be a valid MongoDB connection string

---

### WhatsApp Meta Business API

#### `WHATSAPP_ACCESS_TOKEN` **(REQUIRED)**

- **Type**: String (Access Token)
- **Purpose**: Authenticate requests to WhatsApp Business API
- **Used in**: `src/whatsapp/whatsapp-api/whatsapp.config.ts:3`
- **Example**: `EAADZBxxx...`
- **How to get**:
  1. Go to Meta for Developers
  2. Create/select your WhatsApp Business App
  3. Generate access token from App Settings

#### `WHATSAPP_PHONE_NUMBER_ID` **(REQUIRED)**

- **Type**: String (Numeric ID)
- **Purpose**: Identifies your WhatsApp Business phone number
- **Used in**: `src/whatsapp/whatsapp-api/whatsapp.config.ts:5`
- **Example**: `123456789012345`
- **How to get**: Found in WhatsApp Business API settings

#### `WHATSAPP_WEBHOOK_VERIFY_TOKEN` **(REQUIRED)**

- **Type**: String (Custom token)
- **Purpose**: Verify webhook subscription with Meta
- **Used in**: `src/whatsapp/whatsapp.controller.ts:162`
- **Example**: `my_custom_verify_token_123`
- **Notes**: You create this token yourself; must match what you configure in Meta webhook settings

#### `WHATSAPP_META_APP_SECRET` **(REQUIRED)**

- **Type**: String (Secret key)
- **Purpose**: Validate webhook signatures using HMAC-SHA256
- **Used in**: `src/whatsapp/whatsapp.controller.ts:180`
- **Example**: `abc123def456...`
- **How to get**: Found in Meta App Settings → Basic → App Secret
- **Security**: Critical for webhook security - validates requests are from Meta

#### `WHATSAPP_API_VERSION` _(Optional)_

- **Type**: String (Version identifier)
- **Purpose**: Specify WhatsApp Graph API version
- **Used in**:
  - `src/config/configuration.ts:80`
  - `src/whatsapp/whatsapp-api/whatsapp.config.ts:6`
- **Default**: `v18.0`
- **Example**: `v18.0`, `v19.0`, `v20.0`
- **Notes**: Can override `config.yaml` setting

---

### LLM (Language Model) Configuration

#### `LLM_API_KEY` **(REQUIRED)**

- **Type**: String (API Key)
- **Purpose**: Authenticate with LLM service
- **Used in**: `src/whatsapp/llm/llm.service.ts:67`
- **Example**: `sk-...` (OpenAI format) or custom format
- **Default**: `dummy-key` (should be replaced)
- **Notes**: Format depends on your LLM provider

#### `LLM_BASE_URL` _(Optional)_

- **Type**: String (URL)
- **Purpose**: LLM API endpoint
- **Used in**: `src/whatsapp/llm/llm.service.ts:60`
- **Default**: `http://34.180.40.201:8081/v1`
- **Example**:
  ```env
  LLM_BASE_URL=http://localhost:4123/v1
  LLM_BASE_URL=https://api.openai.com/v1
  ```
- **Notes**: Must be compatible with OpenAI API format

#### `LLM_MODEL` _(Optional)_

- **Type**: String (Model identifier)
- **Purpose**: Specify which LLM model to use
- **Used in**:
  - `src/config/configuration.ts:43`
  - `src/whatsapp/llm/llm.service.ts:66`
- **Default**: `Qwen/Qwen3-30B-A3B`
- **Example**: `gpt-4`, `gpt-3.5-turbo`, `Qwen/Qwen3-30B-A3B`
- **Notes**: Can override `config.yaml` → `llm.defaultModel`

#### `MAX_TOKENS` _(Optional)_

- **Type**: Number
- **Purpose**: Maximum tokens in LLM responses
- **Used in**: `src/config/configuration.ts:45-46`
- **Default**: `1024`
- **Range**: `1` to `32000`
- **Notes**: Can override `config.yaml` → `llm.maxTokens`

#### `TEMPERATURE` _(Optional)_

- **Type**: Number (Float)
- **Purpose**: Control LLM response randomness/creativity
- **Used in**: `src/config/configuration.ts:51-52`
- **Default**: `0.7`
- **Range**: `0.0` (deterministic) to `2.0` (very random)
- **Notes**: Can override `config.yaml` → `llm.temperature`

---

### External AI Services

#### `SARVAM_API_KEY` **(REQUIRED for voice features)**

- **Type**: String (API Key)
- **Purpose**: Authenticate with Sarvam AI for STT/TTS
- **Used in**: `src/whatsapp/sarvam-api/sarvam.service.ts:12`
- **Example**: `sarvam_...`
- **Features enabled**:
  - Speech-to-Text (voice message transcription)
  - Text-to-Speech (audio response generation)
- **How to get**: Sign up at Sarvam AI

#### `GEMINI_API_KEY` **(REQUIRED for voice calls)**

- **Type**: String (API Key)
- **Purpose**: Authenticate with Google Gemini Live for voice calls
- **Used in**: `src/whatsapp/calling/gemini-live.service.ts:30`
- **Example**: `AIza...`
- **Features enabled**: Live voice call functionality with Gemini
- **How to get**: Google AI Studio
- **Notes**: Application throws error if missing when voice calls are attempted

---

### Reviewer System

#### `REVIEWER_API_BASE_URL` _(Optional)_

- **Type**: String (URL)
- **Purpose**: Base URL for reviewer system API
- **Used in**:
  - `src/config/configuration.ts:71`
  - `src/whatsapp/pending-questions/reviewer-polling.service.ts:33`
- **Default**: `http://100.100.108.43:9007/api`
- **Example**: `http://your-reviewer-api:9007/api`
- **Notes**: Can override `config.yaml` → `reviewer.api.defaultBaseUrl`

#### `REVIEWER_POLL_INTERVAL_MS` _(Optional)_

- **Type**: Number (Milliseconds)
- **Purpose**: How often to poll for pending questions
- **Used in**:
  - `src/config/configuration.ts:62-63`
  - `src/whatsapp/pending-questions/reviewer-polling.service.ts:35`
- **Default**: `7200000` (2 hours)
- **Example**: `3600000` (1 hour), `600000` (10 minutes)
- **Notes**: Can override `config.yaml` → `reviewer.polling.intervalMs`

---

### Application Settings

#### `NODE_ENV` _(Optional)_

- **Type**: String (Enum)
- **Purpose**: Application environment mode
- **Used in**:
  - `src/config/configuration.ts:33`
  - `src/main.ts:11, 22, 37`
- **Default**: `development`
- **Valid values**: `development`, `production`, `test`
- **Effects**:
  - Controls logging verbosity
  - Enables/disables error stack traces
  - Affects middleware behavior

#### `PORT` _(Optional)_

- **Type**: Number
- **Purpose**: HTTP server port
- **Used in**:
  - `src/config/configuration.ts:35`
  - `src/main.ts:29`
- **Default**: `3000`
- **Range**: `1024` to `65535`
- **Example**: `PORT=8080 npm start`

#### `LOG_LEVEL` _(Optional)_

- **Type**: String (Enum)
- **Purpose**: Application logging verbosity
- **Used in**: `src/config/configuration.ts:38`
- **Default**: `info` (or `debug` in development)
- **Valid values**: `error`, `warn`, `info`, `debug`
- **Notes**: More verbose = more logs

---

## Best Practices

### ✅ DO

1. **Always set required variables** in `.env` before running the app
2. **Use strong, unique values** for tokens and secrets
3. **Keep `.env` file out of version control** (already in .gitignore)
4. **Use config.yaml for non-secret settings** instead of environment variables
5. **Document any new environment variables** you add

### ❌ DON'T

1. **Don't commit `.env` to git** - it contains secrets
2. **Don't put API keys in `config.yaml`** - use `.env` instead
3. **Don't share your `.env` file** - treat it as sensitive
4. **Don't use environment variables for non-secret config** - use `config.yaml` instead
5. **Don't use production credentials in development** - use separate values

---

## Environment Variable Priority

When a setting can come from multiple sources, this is the priority order (highest to lowest):

1. **Environment variable** (`.env` or shell export)
2. **config.yaml** setting
3. **Hardcoded default** in code

Example:

```bash
# LLM_MODEL lookup order:
# 1. Check LLM_MODEL environment variable
# 2. Check config.yaml → llm.defaultModel
# 3. Use hardcoded default: 'Qwen/Qwen3-30B-A3B'
```

---

## Testing Configuration

### Verify Environment Variables

```bash
# Check if required variables are set
node -e "require('dotenv').config(); console.log('MONGO_URI:', process.env.MONGO_URI ? '✓ Set' : '✗ Missing')"
```

### Test with Different Values

```bash
# Temporarily override for testing
LLM_MODEL=gpt-4 MAX_TOKENS=2048 npm run start:dev
```

### Validate on Startup

The application automatically validates configuration on startup and will show clear errors if required variables are missing or invalid.

---

## Security Notes

### Secrets Management

- **Development**: Use `.env` file (never commit)
- **Production**: Use environment variables from secure secret management
  - Docker: `docker run --env-file .env.production`
  - Kubernetes: Use Secrets or ConfigMaps
  - Cloud: Use platform secret managers (AWS Secrets Manager, GCP Secret Manager, etc.)

### Rotation

Regularly rotate sensitive credentials:

- WhatsApp access tokens
- API keys
- Webhook secrets
- App secrets

---

## Quick Reference Card

```env
# === REQUIRED (Secrets) ===
MONGO_URI=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_META_APP_SECRET=
LLM_API_KEY=
SARVAM_API_KEY=
GEMINI_API_KEY=

# === OPTIONAL (Overrides) ===
# NODE_ENV=development
# PORT=3000
# LOG_LEVEL=debug
# LLM_BASE_URL=http://localhost:4123/v1
# LLM_MODEL=Qwen/Qwen3-30B-A3B
# MAX_TOKENS=1024
# TEMPERATURE=0.7
# WHATSAPP_API_VERSION=v18.0
# REVIEWER_API_BASE_URL=http://100.100.108.43:9007/api
# REVIEWER_POLL_INTERVAL_MS=7200000
```

---

**Last Updated**: 2026-04-07  
**Version**: 1.0.0
