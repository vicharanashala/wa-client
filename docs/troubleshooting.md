# Troubleshooting Guide

> Common errors, root causes, and resolution steps for the AjraSakha WhatsApp AI Assistant.

---

## Table of Contents

- [Startup Failures](#startup-failures)
- [Webhook Issues](#webhook-issues)
- [Message Processing Issues](#message-processing-issues)
- [Voice / Audio Issues](#voice--audio-issues)
- [VoIP Call Issues](#voip-call-issues)
- [LangGraph / Aegra Issues](#langgraph--aegra-issues)
- [Database Issues](#database-issues)
- [Reviewer System Issues](#reviewer-system-issues)
- [Access Control Issues](#access-control-issues)
- [Docker / Deployment Issues](#docker--deployment-issues)
- [Diagnostic Commands](#diagnostic-commands)

---

## Startup Failures

### Configuration Validation Failed

**Error**:
```
Configuration validation failed:
  app.port: port must not be less than 1024
  llm.maxTokens: maxTokens must not be less than 1
```

**Root Cause**: `config.yaml` contains values that violate the schema constraints defined in `config.schema.ts`.

**Resolution**:
1. Compare your `config.yaml` with `config.example.yaml`
2. Ensure all required sections exist and values are within valid ranges
3. Check that all MCP server entries have valid `url` (string) and `enabled` (boolean) fields

---

### AEGRA_ASSISTANT_ID Not Set

**Error**:
```
AEGRA_ASSISTANT_ID env var is not set. Conversation routing will fail.
```

**Root Cause**: The `AEGRA_ASSISTANT_ID` environment variable is missing from `.env`.

**Resolution**:
1. Add `AEGRA_ASSISTANT_ID=<your-assistant-uuid>` to `.env`
2. Obtain the assistant ID from your LangGraph/Aegra server deployment
3. Restart the application

---

### MongoDB Connection Failed

**Error**:
```
MongoServerError: Authentication failed
```
or
```
MongoNetworkError: connect ECONNREFUSED 127.0.0.1:27017
```

**Root Cause**: MongoDB is not running or credentials are incorrect.

**Resolution**:
1. Verify MongoDB is running: `docker ps` or `mongosh`
2. Check `MONGO_URI` in `.env` — ensure it includes credentials if required
3. For Atlas: Verify IP whitelist and connection string format
4. Run `npm run docker:dev` to start MongoDB via Docker

---

### Native Module Build Failure (@discordjs/opus)

**Error**:
```
Error: Cannot find module '@discordjs/opus'
node-pre-gyp ERR! build error
```

**Root Cause**: Missing build tools for native C++ module compilation.

**Resolution**:
- **macOS**: `xcode-select --install`
- **Ubuntu/Debian**: `sudo apt-get install python3 make g++`
- **Docker**: The Dockerfile already includes these dependencies
- After installing tools: `rm -rf node_modules && npm install`

---

## Webhook Issues

### Webhook Verification Failing

**Symptom**: Meta Dashboard shows "Webhook verification failed" when setting up the webhook URL.

**Root Cause**: Verify token mismatch or application not reachable.

**Resolution**:
1. Ensure `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env` matches the verify token entered in Meta Dashboard
2. Verify the application is running and accessible at the webhook URL
3. Test manually:
   ```bash
   curl "https://yourdomain.com/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
   ```
   Should return `test123`
4. If using ngrok, ensure the tunnel is active

---

### Webhook Signature Verification Failed

**Symptom**: Log message: `Rejected webhook: invalid signature`

**Root Cause**: `WHATSAPP_META_APP_SECRET` doesn't match the Meta app secret.

**Resolution**:
1. Go to Meta Developer Dashboard → App Settings → Basic
2. Copy the "App Secret"
3. Set `WHATSAPP_META_APP_SECRET=<app-secret>` in `.env`
4. Restart the application

**Important**: The app secret is different from the access token. It's found under "Settings → Basic", not "WhatsApp → Configuration".

---

### Webhook Returns 200 but Messages Not Processed

**Symptom**: Meta shows successful webhook delivery, but no response is sent to the user.

**Possible Causes**:

1. **Access control rejection**: Check logs for `🚫 Access denied for <number>`
   - **Fix**: Add the phone number to the `whitelist` collection (dev mode) or remove from `blacklist` (prod mode)

2. **Status update (not a message)**: The webhook payload contains `statuses` instead of `messages`
   - **Fix**: This is expected behavior — status updates are silently ignored

3. **Non-text/non-audio message type**: The user sent an image, document, or sticker
   - **Fix**: Currently, only text, audio (voice notes), location, and reaction messages are processed. Other types are logged and skipped.

---

## Message Processing Issues

### "I could not process your request right now. Please try again."

**Root Cause**: LangGraph/Aegra returned no AI reply, or the thread is corrupted.

**Resolution**:
1. Check logs for `runs.wait failed` or `No AI message found`
2. The system attempts automatic repair (inject synthetic tool responses) and retry
3. If repair fails, it resets the thread (deletes and recreates) — this loses conversation history
4. Check Aegra server health and logs

---

### Location Request Loop

**Symptom**: User keeps getting "share your location" even after sharing it.

**Root Cause**: Location update to LangGraph thread state failed.

**Resolution**:
1. Check logs for `Location command failed` or `updateLocation` errors
2. Verify Aegra server connectivity
3. Check that the assistant graph has a `location` field in its state schema
4. The user can try sharing location again — the handler retries on each location share

---

### Long Response Times

**Root Cause**: LangGraph agent is slow due to multiple MCP tool calls, or LLM inference is slow.

**Resolution**:
1. Check Aegra server logs for slow tool calls
2. Verify MCP server availability — `McpToolsService` logs tool discovery results on startup
3. Consider reducing `maxTokens` in `config.yaml`
4. Monitor LLM API rate limits

---

### Message Splitting / Truncation

**Symptom**: Long AI responses arrive as multiple messages or appear cut off.

**Root Cause**: WhatsApp has a ~4000 character limit per message. The `WhatsappService` automatically splits long messages at paragraph boundaries.

**Expected Behavior**: Messages longer than 4000 characters are split at double newlines, then single newlines, then word boundaries. Each chunk is sent with a 200ms delay to maintain order.

---

## Voice / Audio Issues

### "Sarvam STT failed"

**Root Cause**: Sarvam AI API error — API key invalid, rate limit, or service down.

**Resolution**:
1. Verify `SARVAM_API_KEY` in `.env`
2. Check Sarvam AI service status
3. Test API key: `curl -H "api-subscription-key: YOUR_KEY" https://api.sarvam.ai/speech-to-text`
4. User will receive the acknowledgment but no reply — they can resend the voice note

---

### Voice Note Sent Without Sound

**Root Cause**: TTS synthesis produced empty or invalid audio buffers.

**Resolution**:
1. Check logs for `Sarvam TTS failed` or `TTS returned no audio`
2. Verify the `targetLanguage` code is supported (check `mapToSarvamLanguage()` mapping)
3. The user always receives a text reply as fallback, even if voice fails

---

### Voice Notes Limited to First Part of Answer

**Expected Behavior**: Long answers are capped at `MAX_VOICE_NOTES × TTS_CHARS_PER_VOICE_NOTE` (4 × 2500 = 10,000 characters) for TTS to prevent excessively long voice responses. The full text is always sent as a separate text message.

---

## VoIP Call Issues

### Call Not Connecting

**Symptom**: User calls the WhatsApp number but the call doesn't connect.

**Possible Causes**:

1. **No SDP offer in webhook**: Check logs for `No SDP offer in connect event`
   - **Fix**: Ensure the WhatsApp webhook is subscribed to the `calls` field

2. **ICE gathering timeout**: WebRTC ICE candidates not resolving
   - **Fix**: Ensure the server can reach `stun:stun.l.google.com:19302` (UDP port 19302)
   - **Fix**: Ensure UDP traffic is not blocked by firewall

3. **Gemini API key missing**: Check logs for `GEMINI_API_KEY not configured`
   - **Fix**: Set `GEMINI_API_KEY` in `.env`

---

### Audio Crackling / Distortion

**Root Cause**: RTP packets being sent in bursts instead of paced at 20ms intervals.

**Resolution**: The `CallingService` implements RTP pacing with a 20ms interval timer. If crackling persists:
1. Check server CPU usage — Opus encoding is CPU-intensive
2. Check network jitter between the server and WhatsApp's WebRTC endpoint
3. Check logs for `RTP send failed` errors

---

### Call Drops After a Few Seconds

**Root Cause**: No silence frames being sent during idle periods, causing WebRTC to time out.

**Resolution**:
1. The service sends silence Opus frames every 20ms when Gemini is not speaking
2. Check logs for `Silence frames stopped` — this should only happen when Gemini starts speaking
3. Verify that `@discordjs/opus` is installed correctly (it provides the silence frame encoder)

---

## LangGraph / Aegra Issues

### "Conversation routing will fail"

**Symptom**: Startup warning about missing `AEGRA_ASSISTANT_ID`.

**Resolution**: Set `AEGRA_ASSISTANT_ID` in `.env` to a valid assistant UUID from the Aegra server.

---

### Thread Has No Associated Graph

**Log**: `Bootstrapping thread checkpoint before ...`

**Root Cause**: The thread exists but has no checkpoint (no runs have been executed on it yet). This happens with newly created threads.

**Expected Behavior**: The service automatically bootstraps the thread by running a minimal message through the graph, then retries the original operation.

---

### Orphaned Tool Calls

**Log**: `Orphaned tool_use detected — patching`

**Root Cause**: A previous LangGraph run was interrupted (network error, timeout) while the agent was waiting for a tool response, leaving the thread in an invalid state.

**Expected Behavior**: The service detects orphaned tool calls (AI message with `tool_calls` but no subsequent tool response) and patches the thread with synthetic error responses:

```
"Tool execution was interrupted due to a network error. Please inform the user 
that the service was temporarily unavailable and ask them to retry."
```

If patching fails, the thread is deleted and recreated (loses conversation history).

---

### Thread Reset / History Loss

**Log**: `Resetting thread and retrying`

**Root Cause**: Thread repair failed — the thread is unrecoverably corrupted.

**Impact**: The user's conversation history for the current day is lost. Location and farmer profile data are preserved in the LangGraph store.

**Prevention**: Monitor Aegra server stability — most thread corruption is caused by interrupted runs.

---

## Database Issues

### Duplicate Pending Questions

**Symptom**: Same question appears multiple times in `pending_questions`.

**Root Cause**: The `extractQuestionIdFromToolOutput()` scans the full thread history. Fixed by only scanning messages after the latest human message.

**Resolution**: This was a historical bug. The current implementation restricts `reviewId` extraction to the current run's messages only. If duplicates still appear, check for retry logic that might call `pendingQuestionRepo.create()` multiple times.

---

### WhatsApp Users Not Being Tracked

**Symptom**: `GET /whatsapp/users/count` shows 0 or low count.

**Root Cause**: `recordMessage()` is called only after `langGraph.sendMessage()` succeeds. If LangGraph fails, the user is not tracked.

**Resolution**: This is expected behavior — only successful LangGraph interactions are counted. Users who are access-denied or stuck at the location gate are not tracked.

---

## Reviewer System Issues

### Notifications Not Being Sent

**Symptom**: Expert answers exist in the reviewer system but users are not notified.

**Possible Causes**:

1. **Polling not running**: Check for `🕐 Reviewer polling cron job ACTIVE` in startup logs
2. **Wrong reviewer API URL**: Check `REVIEWER_API_BASE_URL` in `.env`
3. **Batch endpoint failing**: Check logs for `Batch status check failed` — should fall back to individual checks
4. **Localization failure**: If Anthropic API fails, falls back to English notification

**Manual trigger**:
```bash
curl -H "x-internal-api-key: YOUR_KEY" http://localhost:3000/whatsapp/test-poll
```

---

### Expert Answer Not Localized

**Symptom**: Expert answer arrives in English even though the user asked in Hindi/Tamil/etc.

**Possible Causes**:

1. **LLM_API_KEY not set**: Localization requires a valid API key (currently uses Anthropic API)
2. **Question detected as English**: The `isLikelyEnglishQuestion()` heuristic may misclassify transliterated questions (e.g., "mera gehun ka rog kya hai" written in Latin script)
3. **STT language code missing**: For voice questions, the Sarvam STT language code guides localization

---

## Access Control Issues

### All Users Getting Rejection Messages

**Symptom**: Every message triggers "Your number is not currently whitelisted."

**Root Cause**: In development mode (`IS_PRODUCTION=false` or unset), only whitelisted numbers are allowed.

**Resolution**:
1. Add phone numbers to the `whitelist` collection:
   ```javascript
   db.whitelist.insertOne({
     phoneNumber: '919876543210',
     name: 'Test User',
     isActive: true
   });
   ```
2. Or set `IS_PRODUCTION=true` in `.env` to switch to blacklist mode (all allowed by default)

---

## Docker / Deployment Issues

### Infisical Authentication Failed

**Error**: `✗ Infisical authentication failed`

**Root Cause**: Invalid Infisical credentials or network issues.

**Resolution**:
1. Verify `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` GitHub secrets
2. Check that the Infisical project ID is correct
3. Verify the secret path matches: `/annam-ajrasakha/WhatsApp`
4. Ensure the VM can reach Infisical's servers

---

### Container Exits Immediately

**Root Cause**: Application fails to start (config error, missing env vars, DB connection failure).

**Resolution**:
```bash
# Check container logs
docker logs ajrasakha-wa-client

# Run interactively to debug
docker run -it --env-file .env wa-bot /bin/bash
```

---

## Diagnostic Commands

### Check Application Health

```bash
curl http://localhost:3000/whatsapp/health
```

### Verify Webhook Configuration

```bash
curl "http://localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"
```

### Check Pending Questions

```bash
mongosh whatsapp-bot --eval "db.pending_questions.find({status: 'pending'}).pretty()"
```

### Check User Count

```bash
curl -H "x-internal-api-key: YOUR_KEY" http://localhost:3000/whatsapp/users/count
```

### Trigger Manual Poll

```bash
curl -H "x-internal-api-key: YOUR_KEY" http://localhost:3000/whatsapp/test-poll
```

### Check Access Control State

```bash
mongosh whatsapp-bot --eval "db.whitelist.find({isActive: true}).pretty()"
mongosh whatsapp-bot --eval "db.blacklist.find({isActive: true}).pretty()"
```

### View Application Logs (Docker)

```bash
docker logs -f ajrasakha-wa-client --tail 100
```

### Enable Debug Logging

Set `LOG_LEVEL=debug` in `.env` or run:

```bash
LOG_LEVEL=debug npm run start:dev
```

### Check MCP Server Connectivity

Watch for startup logs:
```
[McpToolsService] Discovering tools from MCP servers...
[McpToolsService] [golden] → 3 tools
[McpToolsService] [weather] → 2 tools
[McpToolsService] [agmarknet] Failed: connect ECONNREFUSED
```

Failed MCP servers are logged as warnings — the application continues with available tools.
