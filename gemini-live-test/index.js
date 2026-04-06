const WebSocket = require('ws');
const record = require('node-record-lpcm16');
const Speaker = require('speaker');
require('dotenv').config();

// Suppress annoying native audio warnings (CoreAudio buffer underflow)
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk, encoding, callback) {
    const str = chunk.toString();
    if (str.includes('buffer underflow') || str.includes('Didn\'t have any audio data')) {
        return true; 
    }
    return originalStderrWrite(chunk, encoding, callback);
};

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY not found in .env file!");
    process.exit(1);
}

// ====== MCP Servers Configuration (Streamable HTTP) ======
const MCP_SERVERS = {
    golden:     'http://100.100.108.43:9006/mcp',
    pop:        'http://100.100.108.43:9002/mcp',
    market:     'http://100.100.108.43:9022/mcp',
    weather:    'http://100.100.108.43:9004/mcp',
    'faq-videos': 'http://100.100.108.43:9005/mcp',
    'golden-n': 'http://100.100.108.43:9023/mcp',
};

// Tool name -> { serverUrl, sessionId } mapping
const toolToServer = {};
// Session IDs per server URL
const serverSessions = {};
// All discovered tools for Gemini
let allTools = [];

// ====== Parse SSE response text into JSON-RPC result ======
function parseSSEResponse(text) {
    // SSE format: "event: message\ndata: {...json...}\n\n"
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6).trim();
            if (jsonStr) {
                return JSON.parse(jsonStr);
            }
        }
    }
    // Try parsing as plain JSON (fallback)
    return JSON.parse(text);
}

// ====== MCP Helper: Send JSON-RPC request to a server ======
async function mcpRequest(serverUrl, method, params = {}, isNotification = false) {
    const body = {
        jsonrpc: "2.0",
        method,
    };
    
    if (!isNotification) {
        body.id = Date.now();
    }
    
    if (Object.keys(params).length > 0) {
        body.params = params;
    }

    const headers = { 
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    };
    
    // Add session ID if we have one for this server
    if (serverSessions[serverUrl]) {
        headers['Mcp-Session-Id'] = serverSessions[serverUrl];
    }

    const res = await fetch(serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    // Store session ID from response headers
    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) {
        serverSessions[serverUrl] = sessionId;
    }

    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`MCP HTTP ${res.status} from ${serverUrl}: ${errorText.substring(0, 200)}`);
    }

    // For notifications, no response body expected
    if (isNotification) {
        return null;
    }

    // Check content type to determine how to parse
    const contentType = res.headers.get('content-type') || '';
    const responseText = await res.text();
    
    if (contentType.includes('text/event-stream') || responseText.startsWith('event:')) {
        // Parse SSE response
        return parseSSEResponse(responseText);
    } else {
        // Parse plain JSON
        return JSON.parse(responseText);
    }
}

// ====== Discover tools from all MCP servers ======
async function discoverAllTools() {
    console.log("\n🔍 Discovering tools from all MCP servers...\n");
    const geminiToolDeclarations = [];

    for (const [name, url] of Object.entries(MCP_SERVERS)) {
        try {
            // Step 1: Initialize the server
            console.log(`🔄 [${name}] Initializing...`);
            const initResult = await mcpRequest(url, 'initialize', {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "gemini-live-client", version: "1.0.0" }
            });
            console.log(`   [${name}] Init response:`, JSON.stringify(initResult).substring(0, 200));
            
            // Step 2: Send initialized notification
            try {
                await mcpRequest(url, 'notifications/initialized', {}, true);
            } catch (notifErr) {
                // Notification errors are non-fatal
                console.log(`   [${name}] Notification sent (or skipped): ${notifErr.message}`);
            }

            // Step 3: List tools
            const result = await mcpRequest(url, 'tools/list');
            const tools = result.result?.tools || result.tools || [];
            
            console.log(`✅ [${name}] → ${tools.length} tools found: ${tools.map(t => t.name).join(', ')}`);

            for (const tool of tools) {
                // Map tool name to server URL
                toolToServer[tool.name] = url;

                // Convert MCP tool schema to Gemini format
                const declaration = {
                    name: tool.name,
                    description: tool.description || `Tool from ${name} server`,
                };

                // Convert inputSchema to Gemini parameters format
                if (tool.inputSchema && tool.inputSchema.properties) {
                    declaration.parameters = convertSchemaToGemini(tool.inputSchema);
                }

                geminiToolDeclarations.push(declaration);
            }
        } catch (err) {
            console.error(`❌ [${name}] Failed: ${err.message}`);
        }
    }

    allTools = geminiToolDeclarations;
    console.log(`\n📦 Total tools discovered: ${allTools.length}`);
    if (Object.keys(toolToServer).length > 0) {
        console.log(`🗺️  Tool routing map:`);
        for (const [t, u] of Object.entries(toolToServer)) {
            console.log(`    ${t} → ${u}`);
        }
    }
    console.log('');
    return geminiToolDeclarations;
}

// ====== Convert JSON Schema to Gemini-compatible format ======
function convertSchemaToGemini(schema) {
    const result = {
        type: "OBJECT",
        properties: {},
        required: schema.required || []
    };

    for (const [key, val] of Object.entries(schema.properties || {})) {
        result.properties[key] = {
            type: (val.type || 'string').toUpperCase(),
            description: val.description || ''
        };
        if (val.enum) {
            result.properties[key].enum = val.enum;
        }
    }

    return result;
}

// ====== Call a tool on the correct MCP server ======
async function callMCPTool(toolName, args) {
    const serverUrl = toolToServer[toolName];
    if (!serverUrl) {
        throw new Error(`No MCP server found for tool: ${toolName}`);
    }
    
    console.log(`🔗 Calling tool '${toolName}' on ${serverUrl}`);
    const result = await mcpRequest(serverUrl, 'tools/call', {
        name: toolName,
        arguments: args
    });
    
    return result;
}

// ====== Main App ======
async function main() {
    // Step 1: Discover all tools from MCP servers
    const toolDeclarations = await discoverAllTools();

    if (toolDeclarations.length === 0) {
        console.log("⚠️  No tools discovered! Gemini will run without tools.\n");
    }

    // Step 2: Connect to Gemini Live API
    const URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    const ws = new WebSocket(URL);

    let micStarted = false;
    let speaker = null;
    let speakerTimeout = null;

    // Create speaker on-demand to avoid buffer underflow warnings
    function getOrCreateSpeaker() {
        if (speakerTimeout) {
            clearTimeout(speakerTimeout);
            speakerTimeout = null;
        }
        if (!speaker) {
            speaker = new Speaker({
                channels: 1,
                bitDepth: 16,
                sampleRate: 24000
            });
            speaker.on('error', () => {}); // Suppress speaker errors on close
        }
        return speaker;
    }

    function closeSpeaker() {
        // Delay closing to allow final audio chunks to play
        if (speakerTimeout) clearTimeout(speakerTimeout);
        speakerTimeout = setTimeout(() => {
            if (speaker) {
                try { speaker.end(); } catch(e) {}
                speaker = null;
            }
        }, 500);
    }

    ws.on('open', () => {
        console.log("🔌 Connected to Gemini! Sending setup...");

        const setupPayload = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                systemInstruction: {
                    parts: [{ text: "You are a helpful assistant for Indian farmers. You have access to multiple tools for crop prices, weather, FAQs, and more. Use the appropriate tool when the user asks relevant questions. Keep answers short and crisp. Respond in the same language the user speaks." }]
                },
                generationConfig: { responseModalities: ["AUDIO"] }
            }
        };

        // Add tools if any were discovered
        if (toolDeclarations.length > 0) {
            setupPayload.setup.tools = [{ functionDeclarations: toolDeclarations }];
        }

        ws.send(JSON.stringify(setupPayload));
    });

    ws.on('message', (data) => {
        const response = JSON.parse(data.toString());

        // 1. Setup Complete -> Start Mic
        if (response.setupComplete && !micStarted) {
            micStarted = true;
            console.log("✅ Setup complete!");
            console.log("🎤 Mic On! Speak now, Gemini is listening...\n");

            record.record({
                sampleRate: 16000,
                channels: 1,
                threshold: 0
            }).stream()
            .on('data', (chunk) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        realtimeInput: {
                            mediaChunks: [{
                                mimeType: "audio/pcm;rate=16000",
                                data: chunk.toString("base64")
                            }]
                        }
                    }));
                }
            });
        }

        // 2. Normal Response -> Play Audio & Print Text
        if (response.serverContent?.modelTurn) {
            const parts = response.serverContent.modelTurn.parts || [];
            for (const part of parts) {
                if (part.text) console.log("🤖 Gemini:", part.text);

                if (part.inlineData) {
                    const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                    getOrCreateSpeaker().write(audioBuffer);
                }
            }
        }

        // Turn complete -> close speaker to stop CoreAudio callbacks
        if (response.serverContent?.turnComplete) {
            closeSpeaker();
        }

        // 3. Tool Call -> Route to correct MCP server
        if (response.toolCall) {
            const functionCall = response.toolCall.functionCalls[0];

            console.log(`\n⚙️  TOOL TRIGGERED: ${functionCall.name}`);
            console.log("Arguments:", functionCall.args);

            (async () => {
                try {
                    const actualData = await callMCPTool(functionCall.name, functionCall.args);
                    console.log("📦 MCP Response:", JSON.stringify(actualData).substring(0, 500));

                    ws.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{
                                id: functionCall.id,
                                name: functionCall.name,
                                response: { result: actualData }
                            }]
                        }
                    }));

                    console.log("✅ Tool response sent to Gemini!\n");

                } catch (error) {
                    console.error("❌ MCP tool call failed:", error.message);

                    ws.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{
                                id: functionCall.id,
                                name: functionCall.name,
                                response: { error: "Failed to fetch data from MCP server. Error: " + error.message }
                            }]
                        }
                    }));
                }
            })();
        }
    });

    ws.on('error', (err) => console.error("❌ WS Error:", err.message));
    ws.on('close', (code, reason) => console.log(`🔌 Connection closed! Code: ${code}`));

    // Ctrl+C graceful shutdown
    process.on('SIGINT', () => {
        console.log("\n👋 Shutting down...");
        if (speaker) try { speaker.end(); } catch(e) {}
        ws.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error("💀 Fatal error:", err);
    process.exit(1);
});