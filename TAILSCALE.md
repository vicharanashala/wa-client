# Tailscale Integration

This document describes how to configure and use Tailscale for mesh networking in the wa-client container.

## Overview

The wa-client container includes Tailscale for secure, low-latency mesh networking. This allows containers to communicate over Tailscale's encrypted network without exposing services to the public internet.

## Architecture

- **Single Container**: Tailscale runs in userspace networking mode inside the same container
- **Process Management**: s6-overlay manages both tailscaled and the Node.js application
- **Proxy Routing**: Node.js HTTP traffic is routed through Tailscale's local proxy

## Setup

### 1. Generate a Tailscale Auth Key

1. Log in to your [Tailscale admin console](https://login.tailscale.com/admin/settings/keys)
2. Go to **Settings** > **Keys**
3. Click **Generate auth key**
4. For containers that can be recreated freely, enable **Ephemeral** (auto-cleanup)
5. Copy the generated key (format: `tskey-auth-...`)

### 2. Add the Secret to GitHub

Add `TS_AUTHKEY` to your GitHub repository secrets:
1. Go to repository **Settings** > **Secrets and variables** > **Actions**
2. Add a new secret: `TAILSCALE_AUTHKEY` = `tskey-auth-your-key-here`

### 3. Environment Variables

The following environment variables are automatically set by the CI/CD pipeline:

| Variable | Description | Example |
|----------|-------------|---------|
| `TAILSCALE_AUTHKEY` | Tailscale auth key | `tskey-auth-...` |
| `TS_HOSTNAME` | Hostname on tailnet | `wa-client-staging` |
| `HTTP_PROXY` | HTTP proxy URL | `http://localhost:1055` |
| `HTTPS_PROXY` | HTTPS proxy URL | `http://localhost:1055` |
| `GLOBAL_AGENT_HTTP_PROXY` | Node.js proxy | `http://localhost:1055` |

## Local Development

To run the container locally with Tailscale:

```bash
docker build -t wa-client .

docker run -d \
  --name wa-client \
  -e TAILSCALE_AUTHKEY=tskey-auth-YOUR_KEY \
  -e TS_HOSTNAME=wa-client-local \
  -e HTTP_PROXY=http://localhost:1055 \
  -e HTTPS_PROXY=http://localhost:1055 \
  -e GLOBAL_AGENT_HTTP_PROXY=http://localhost:1055 \
  -p 3000:3000 \
  wa-client
```

## How It Works

### 1. Container Startup (s6-overlay)

The container uses s6-overlay to manage multiple processes:

- **tailscaled service**: Starts the Tailscale daemon with userspace networking
- **node service**: Starts the NestJS application after Tailscale is connected

### 2. Tailscale Daemon

The `tailscaled` service:
1. Starts in userspace networking mode (`--tun=userspace-networking`)
2. Exposes a SOCKS5/HTTP proxy on port 1055
3. Authenticates using the auth key
4. Registers with the tailnet

### 3. Node.js Application

The Node.js application uses `global-agent` to route HTTP traffic through the Tailscale proxy:

```typescript
// At the very top of main.ts
require('global-agent/bootstrap');
```

This patches Node.js's global HTTP agents to respect `GLOBAL_AGENT_HTTP_PROXY`.

## Verifying Tailscale Connection

Check the container logs:

```bash
docker logs wa-client
```

Look for:
- Tailscale connection status
- The Tailscale IP address (100.x.x.x range)
- Connected peers

Alternatively, exec into the container:

```bash
docker exec -it wa-client sh
tailscale status
```

## Troubleshooting

### Container fails to start

Check if the auth key is valid and not expired. Generate a new key if needed.

### Tailscale not connecting

Verify:
1. Auth key is correct
2. Container has network access
3. Tailscale console shows the node

### App can't reach services via Tailscale IP

Ensure `GLOBAL_AGENT_HTTP_PROXY` is set correctly and the Node.js app is restarted after setting the env var.

## Security Notes

- Use **ephemeral auth keys** for containers that can be recreated freely
- The auth key is passed as an environment variable, so ensure it's stored as a GitHub secret
- Tailscale encrypts all traffic between nodes
- No ports need to be exposed for inter-container communication

## Cloud Run Limitations

Note: Running Tailscale in Cloud Run containers may have limitations due to Cloud Run's sandboxed environment. For production Kubernetes or VM deployments, consider:
- Running Tailscale as a sidecar container
- Using Tailscale's `netfilter` module on VMs
- Tailscale SSH for secure access