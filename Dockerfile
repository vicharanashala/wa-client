# ============================================
# Stage 1: Build the NestJS application
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Verify build output exists
RUN ls -la dist/ && test -f dist/main.js || (echo "ERROR: dist/main.js not found after build!" && exit 1)

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install Tailscale and curl (needed for s6-overlay)
RUN apk update && apk add tailscale curl

# Create essential runtime directories for the Tailscale daemon
RUN mkdir -p /var/run/tailscale /var/lib/tailscale /dev/net

# Install s6-overlay for process management
ARG S6_OVERLAY_VERSION=3.2.3.0
RUN curl -sL https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz -o /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    curl -sL https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz -o /tmp/s6-overlay-x86_64.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Create s6 service directories
RUN mkdir -p /etc/services.d/tailscale /etc/services.d/node

# Copy built artifacts from builder FIRST (before any other operations)
# This ensures dist is available for verification
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.yaml ./

# Verify dist was copied correctly
RUN test -f dist/main.js || (echo "ERROR: dist/main.js not found after COPY!" && exit 1)

# Copy package files and install production dependencies
COPY package*.json ./

# Use npm ci with --omit=dev to get production-only dependencies
# Note: We don't copy node_modules from builder to avoid dev dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && rm -rf /root/.npm

# Copy s6 service scripts
COPY s6-scripts/tailscale-run /etc/services.d/tailscale/run
COPY s6-scripts/node-run /etc/services.d/node/run

# Make scripts executable
RUN chmod +x /etc/services.d/tailscale/run /etc/services.d/node/run

# Set environment
ENV NODE_ENV=production

# Expose port (match Cloud Run port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/whatsapp/health || exit 1

# Use s6-overlay init binary as entrypoint
ENTRYPOINT ["/init"]