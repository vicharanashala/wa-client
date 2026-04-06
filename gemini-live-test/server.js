const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();

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

// Tool name -> server URL mapping
const toolToServer = {};
// Session IDs per server URL
const serverSessions = {};
// All discovered tools for Gemini
let allTools = [];

// ====== Parse SSE response text into JSON-RPC result ======
function parseSSEResponse(text) {
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6).trim();
            if (jsonStr) {
                return JSON.parse(jsonStr);
            }
        }
    }
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

    if (serverSessions[serverUrl]) {
        headers['Mcp-Session-Id'] = serverSessions[serverUrl];
    }

    const res = await fetch(serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) {
        serverSessions[serverUrl] = sessionId;
    }

    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`MCP HTTP ${res.status} from ${serverUrl}: ${errorText.substring(0, 200)}`);
    }

    if (isNotification) {
        return null;
    }

    const contentType = res.headers.get('content-type') || '';
    const responseText = await res.text();

    if (contentType.includes('text/event-stream') || responseText.startsWith('event:')) {
        return parseSSEResponse(responseText);
    } else {
        return JSON.parse(responseText);
    }
}

// ====== Discover tools from all MCP servers ======
async function discoverAllTools() {
    console.log("\n🔍 Discovering tools from all MCP servers...\n");
    const geminiToolDeclarations = [];

    for (const [name, url] of Object.entries(MCP_SERVERS)) {
        try {
            console.log(`🔄 [${name}] Initializing...`);
            const initResult = await mcpRequest(url, 'initialize', {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "gemini-live-client", version: "1.0.0" }
            });
            console.log(`   [${name}] Init response:`, JSON.stringify(initResult).substring(0, 200));

            try {
                await mcpRequest(url, 'notifications/initialized', {}, true);
            } catch (notifErr) {
                console.log(`   [${name}] Notification sent (or skipped): ${notifErr.message}`);
            }

            const result = await mcpRequest(url, 'tools/list');
            const tools = result.result?.tools || result.tools || [];

            console.log(`✅ [${name}] → ${tools.length} tools found: ${tools.map(t => t.name).join(', ')}`);

            for (const tool of tools) {
                toolToServer[tool.name] = url;

                const declaration = {
                    name: tool.name,
                    description: tool.description || `Tool from ${name} server`,
                };

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

// ====== Express + WebSocket Server ======
const app = express();
const server = http.createServer(app);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        tools: allTools.length,
        uptime: process.uptime()
    });
});

// WebSocket server on the same HTTP server
const wss = new WebSocket.Server({ server });

wss.on('connection', (clientWs, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`\n🌐 New browser client connected from: ${clientIp}`);

    let geminiWs = null;
    let isSetupComplete = false;

    // Connect to Gemini Live API
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    geminiWs = new WebSocket(GEMINI_URL);

    geminiWs.on('open', () => {
        console.log("🔌 Connected to Gemini for this client");

        const setupPayload = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                systemInstruction: {
                    parts: [{ text: "You are a helpful assistant for Indian farmers. You have access to multiple tools for crop prices, weather, FAQs, and more. Use the appropriate tool when the user asks relevant questions. Keep answers short and crisp. Respond in the same language the user speaks." }]
                },
                generationConfig: { responseModalities: ["AUDIO"] }
            }
        };

        if (allTools.length > 0) {
            setupPayload.setup.tools = [{ functionDeclarations: allTools }];
        }

        geminiWs.send(JSON.stringify(setupPayload));
    });

    geminiWs.on('message', (data) => {
        const response = JSON.parse(data.toString());

        // Setup Complete → tell browser
        if (response.setupComplete) {
            isSetupComplete = true;
            console.log("✅ Gemini setup complete for this client");
            clientWs.send(JSON.stringify({ type: 'setup_complete' }));
        }

        // Audio/text response → forward to browser
        if (response.serverContent?.modelTurn) {
            const parts = response.serverContent.modelTurn.parts || [];
            for (const part of parts) {
                if (part.text) {
                    console.log("🤖 Gemini:", part.text);
                    clientWs.send(JSON.stringify({ type: 'text', text: part.text }));
                }
                if (part.inlineData) {
                    clientWs.send(JSON.stringify({
                        type: 'audio',
                        mimeType: part.inlineData.mimeType,
                        data: part.inlineData.data
                    }));
                }
            }
        }

        // Turn complete
        if (response.serverContent?.turnComplete) {
            clientWs.send(JSON.stringify({ type: 'turn_complete' }));
        }

        // Tool Call → Route to MCP server
        if (response.toolCall) {
            const functionCall = response.toolCall.functionCalls[0];
            console.log(`\n⚙️  TOOL TRIGGERED: ${functionCall.name}`);
            console.log("Arguments:", functionCall.args);

            clientWs.send(JSON.stringify({
                type: 'tool_call',
                name: functionCall.name,
                args: functionCall.args
            }));

            (async () => {
                try {
                    const actualData = await callMCPTool(functionCall.name, functionCall.args);
                    console.log("📦 MCP Response:", JSON.stringify(actualData).substring(0, 500));

                    geminiWs.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{
                                id: functionCall.id,
                                name: functionCall.name,
                                response: { result: actualData }
                            }]
                        }
                    }));

                    console.log("✅ Tool response sent to Gemini!\n");
                    clientWs.send(JSON.stringify({
                        type: 'tool_result',
                        name: functionCall.name,
                        success: true
                    }));
                } catch (error) {
                    console.error("❌ MCP tool call failed:", error.message);

                    geminiWs.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{
                                id: functionCall.id,
                                name: functionCall.name,
                                response: { error: "Failed to fetch data from MCP server. Error: " + error.message }
                            }]
                        }
                    }));

                    clientWs.send(JSON.stringify({
                        type: 'tool_result',
                        name: functionCall.name,
                        success: false,
                        error: error.message
                    }));
                }
            })();
        }
    });

    geminiWs.on('error', (err) => {
        console.error("❌ Gemini WS Error:", err.message);
        clientWs.send(JSON.stringify({ type: 'error', message: 'Gemini connection error' }));
    });

    geminiWs.on('close', (code) => {
        console.log(`🔌 Gemini connection closed for client. Code: ${code}`);
        clientWs.send(JSON.stringify({ type: 'disconnected' }));
    });

    // Receive audio from browser client
    clientWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'audio' && isSetupComplete && geminiWs?.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{
                            mimeType: "audio/pcm;rate=16000",
                            data: msg.data
                        }]
                    }
                }));
            }
        } catch (e) {
            // ignore parse errors
        }
    });

    clientWs.on('close', () => {
        console.log("🌐 Browser client disconnected");
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});

// ====== Start Server ======
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Discover MCP tools first
    const toolDeclarations = await discoverAllTools();

    if (toolDeclarations.length === 0) {
        console.log("⚠️  No tools discovered! Gemini will run without tools.\n");
    }

    // Start listening on all interfaces (important for Tailscale!)
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server is running!`);
        console.log(`   Local:     http://localhost:${PORT}`);
        console.log(`   Network:   http://0.0.0.0:${PORT}`);
        console.log(`   Tailscale: Open http://<your-tailscale-ip>:${PORT} in browser\n`);
    });
}

startServer().catch(err => {
    console.error("💀 Fatal error:", err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log("\n👋 Shutting down server...");
    wss.clients.forEach(client => client.close());
    server.close();
    process.exit(0);
});
