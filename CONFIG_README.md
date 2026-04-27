# Configuration Guide

This project uses a **dual configuration approach**:

1. **YAML file** (`config.yaml`) for non-secret settings (committed to git)
2. **Environment variables** (`.env`) for secrets and credentials (NOT committed)

## Quick Start

### 1. Setup Environment Variables (Secrets)

Copy the example file and fill in your secrets:

```bash
cp .env.example .env
```

Edit `.env` with your actual API keys and credentials:

- Database credentials (MongoDB, Redis)
- WhatsApp API tokens
- LLM API keys
- External service API keys (Sarvam, Gemini)

### 2. Configure Application Settings

The `config.yaml` file contains all non-secret configuration. You can edit it directly:

```bash
nano config.yaml  # or use your preferred editor
```

### 3. Run the Application

```bash
npm run start:dev
```

---

## Configuration Architecture

### Why This Approach?

| Type         | Storage       | Committed to Git? | Examples                          |
| ------------ | ------------- | ----------------- | --------------------------------- |
| **Secrets**  | `.env` file   | ❌ NO             | API keys, tokens, passwords       |
| **Settings** | `config.yaml` | ✅ YES            | URLs, timeouts, message templates |

**Benefits:**

- 🔒 **Security**: Secrets never committed to version control
- 📝 **Transparency**: All settings visible in config.yaml
- 🔄 **Easy Updates**: Change settings without code changes
- 🧪 **Testing**: Override settings via env vars without editing YAML
- 🌍 **Multi-Environment**: Use different config.yaml per environment

---

## Configuration File Structure

### config.yaml

```yaml
version: 1.0.0

app:
  name: 'WhatsApp AI Assistant'
  environment: 'development'
  port: 3000
  logLevel: 'debug'

whatsapp:
  api:
    version: 'v18.0'
  messages:
    locationRequest: 'To give you accurate farming advice...'
    disclaimer: '⚠️ This is a testing version...'

llm:
  defaultModel: 'Qwen/Qwen3-30B-A3B'
  maxTokens: 1024
  temperature: 0.7
  systemPrompt: |
    You are AjraSakha, an AI agricultural expert...

mcp:
  servers:
    text:
      reviewer:
        url: 'http://100.100.108.44:9002/mcp'
        enabled: true
    voice:
      golden:
        url: 'http://100.100.108.43:9006/mcp'
        enabled: true

# ... and many more settings
```

See `config.example.yaml` for the full configuration structure.

---

## Using Configuration in Code

### Type-Safe Configuration Access

The recommended way to access configuration is through the `AppConfigService`:

```typescript
import { Injectable } from '@nestjs/common';
import { AppConfigService } from './config/app-config.service';

@Injectable()
export class MyService {
  constructor(private readonly appConfig: AppConfigService) {}

  doSomething() {
    // Get entire config sections
    const llmConfig = this.appConfig.llm;
    console.log(`Model: ${llmConfig.defaultModel}`);
    console.log(`Max Tokens: ${llmConfig.maxTokens}`);

    // Access nested properties
    const mcpServers = this.appConfig.mcp.servers.text;
    const reviewerUrl = mcpServers.reviewer.url;

    // Check feature flags
    if (this.appConfig.isFeatureEnabled('enableVoiceCalls')) {
      // Handle voice calls
    }

    // Environment checks
    if (this.appConfig.isProduction) {
      // Production-only logic
    }
  }
}
```

### Using ConfigService Directly

For more flexibility, you can use NestJS's `ConfigService`:

```typescript
import { ConfigService } from '@nestjs/config';

constructor(private readonly configService: ConfigService) {}

getValue() {
  // Get specific values
  const port = this.configService.get<number>('app.port');
  const model = this.configService.get<string>('llm.defaultModel');

  // Get with default value
  const timeout = this.configService.get<number>('timeout', 30000);

  // Get environment variables (secrets)
  const apiKey = this.configService.get<string>('LLM_API_KEY');
}
```

---

## Environment Variable Overrides

You can override YAML settings with environment variables for testing or deployment:

```bash
# Override port
PORT=4000 npm run start:dev

# Override LLM settings
LLM_MODEL=gpt-4 MAX_TOKENS=2048 npm run start:dev

# Override log level
LOG_LEVEL=debug npm run start:dev
```

**Available Override Variables:**

- `NODE_ENV` - Application environment
- `PORT` - Server port
- `LOG_LEVEL` - Logging level
- `LLM_MODEL` - LLM model name
- `MAX_TOKENS` - Max tokens for LLM
- `TEMPERATURE` - LLM temperature
- `WHATSAPP_API_VERSION` - WhatsApp API version
- `REVIEWER_API_BASE_URL` - Reviewer system base URL
- `REVIEWER_POLL_INTERVAL_MS` - Polling interval

---

## Configuration Sections

### 1. Application Settings (`app`)

- Basic app info (name, environment, port)
- Logging configuration

### 2. WhatsApp Settings (`whatsapp`)

- API version and base URL
- Message templates (location request, disclaimer, help message, etc.)

### 3. LLM Configuration (`llm`)

- Model selection
- Generation parameters (temperature, max tokens, etc.)
- System prompt

### 4. MCP Servers (`mcp`) - **DYNAMIC**

MCP server configuration is **fully dynamic** - you can add any number of servers with custom names:

```yaml
mcp:
  servers:
    text:
      reviewer:
        url: 'http://100.100.108.44:9002/mcp'
        enabled: true
      # Add your own servers with any name:
      my-custom-server:
        url: 'http://my-server:9010/mcp'
        enabled: true

    voice:
      golden:
        url: 'http://100.100.108.43:9006/mcp'
        enabled: true
      # Add more voice servers:
      another-tool:
        url: 'http://voice-server:9050/mcp'
        enabled: false
```

- **Text servers**: Used for text-based chat interactions
- **Voice servers**: Used for Gemini Live voice call interactions
- **Protocol configuration**: MCP protocol version and client info
- **No code changes needed** when adding/removing servers
- Each server requires: `url` (string) and `enabled` (boolean)

### 5. Audio Settings (`audio`)

- Opus codec settings
- Gemini audio settings

### 6. Sarvam AI (`sarvam`)

- STT (Speech-to-Text) configuration
- TTS (Text-to-Speech) configuration

### 7. Gemini Live (`gemini`)

- WebSocket configuration
- Voice call settings
- System instructions for voice

### 8. Reviewer System (`reviewer`)

- Polling configuration
- API endpoints

### 9. Conversation (`conversation`)

- Message history limits
- Context settings

### 10. Database (`database`)

- MongoDB options
- Redis options

### 11. Feature Flags (`features`)

- Enable/disable features at runtime

### 12. Rate Limiting (`rateLimit`)

- Request rate limiting configuration

### 13. Logging (`logging`)

- Log format and levels per module

---

## Deployment

### Development

```bash
# Use default config.yaml
npm run start:dev
```

### Production

1. Create production config:

```bash
cp config.yaml config.production.yaml
# Edit config.production.yaml with production settings
```

2. Set environment:

```bash
export NODE_ENV=production
```

3. Use production config:

```bash
mv config.production.yaml config.yaml
npm run build
npm run start:prod
```

### Docker

The `config.yaml` file is automatically copied to the Docker image during build (configured in `nest-cli.json`).

```dockerfile
# In your Dockerfile
COPY config.yaml ./
```

Environment variables can be passed at runtime:

```bash
docker run -e MONGO_URI=mongodb://... -e LLM_API_KEY=... my-app
```

---

## Configuration Validation

All configuration is validated on application startup using `class-validator`. If validation fails, the app won't start and will show detailed error messages.

**Example validation error:**

```
Configuration validation failed:
llm.maxTokens: maxTokens must not be greater than 32000
mcp.servers.text.reviewer.url: url must be a URL address
```

---

## Best Practices

### ✅ DO

- ✅ Commit `config.yaml` to version control
- ✅ Keep secrets in `.env` (never commit)
- ✅ Use `config.example.yaml` as documentation
- ✅ Use `AppConfigService` for type-safe access
- ✅ Add validation for new config fields
- ✅ Document new configuration sections

### ❌ DON'T

- ❌ Put API keys in `config.yaml`
- ❌ Commit `.env` file
- ❌ Hard-code URLs in services
- ❌ Skip validation for new fields
- ❌ Use `process.env` directly in services

---

## Troubleshooting

### Configuration file not found

**Error:** `Failed to load configuration from .../config.yaml`

**Solution:** Ensure `config.yaml` exists in the project root:

```bash
cp config.example.yaml config.yaml
```

### Validation errors

**Error:** `Configuration validation failed: ...`

**Solution:** Check the error message and fix the invalid values in `config.yaml`. Common issues:

- Invalid URLs
- Values out of range
- Missing required fields

### Environment variables not working

**Problem:** Env vars not overriding YAML values

**Solution:** Check `src/config/configuration.ts` to see which env vars are supported for overrides. Not all YAML values can be overridden.

### Build fails - config.yaml not copied

**Solution:** Ensure `nest-cli.json` has the assets configuration:

```json
{
  "compilerOptions": {
    "assets": [
      {
        "include": "../config.yaml",
        "outDir": "./dist"
      }
    ]
  }
}
```

---

## Adding New Configuration

### 1. Update config.yaml

Add your new setting:

```yaml
myFeature:
  enabled: true
  timeout: 5000
```

### 2. Create Schema Class

In `src/config/config.schema.ts`:

```typescript
export class MyFeatureConfig {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @Min(1000)
  timeout: number;
}

// Add to root schema
export class ConfigSchema {
  // ...existing fields

  @ValidateNested()
  @Type(() => MyFeatureConfig)
  myFeature: MyFeatureConfig;
}
```

### 3. Add Getter to AppConfigService

In `src/config/app-config.service.ts`:

```typescript
get myFeature(): MyFeatureConfig {
  return this.configService.get<MyFeatureConfig>('myFeature')!;
}
```

### 4. Use in Your Code

```typescript
constructor(private appConfig: AppConfigService) {}

doSomething() {
  if (this.appConfig.myFeature.enabled) {
    const timeout = this.appConfig.myFeature.timeout;
    // ...
  }
}
```

---

## Support

For questions or issues with configuration:

1. Check this README
2. Review `config.example.yaml` for reference
3. Check validation errors on startup
4. Consult the [NestJS Configuration documentation](https://docs.nestjs.com/techniques/configuration)

---

**Configuration Version:** 1.0.0  
**Last Updated:** 2026-04-07
