# Multi-stage build for efficient container size
FROM node:26-alpine AS builder

# Build arguments
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (--ignore-scripts prevents 'prepare' from running before source is copied)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Prune dev dependencies in builder stage
RUN npm prune --omit=dev

# Production stage
FROM node:26-alpine AS production

# Pull latest Alpine package fixes (e.g. OpenSSL) even when the base layer is cached
RUN apk -U upgrade --no-cache

# Create a non-root user for security
RUN addgroup -g 1001 -S dattoedr && \
    adduser -S dattoedr -u 1001 -G dattoedr

# Set working directory
WORKDIR /app

# Copy package files and built application from builder stage
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Create logs directory
RUN mkdir -p /app/logs && chown -R dattoedr:dattoedr /app

# Remove bundled npm/npx from the runtime image (not needed at runtime; CMD runs node directly).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Switch to non-root user
USER dattoedr

# Expose port
EXPOSE 8080

# Health check against the actual HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Bind every interface inside the container. Host publish is loopback in
# docker-compose. 0.0.0.0 is safe here only because startup refuses to listen
# without a real CONDUIT_S2S_SECRET. AUTH_MODE=gateway never falls back to
# image env credentials.
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
ENV AUTH_MODE=gateway

# Define volume for logs
VOLUME ["/app/logs"]

# Start the application (dist/http.js falls back to stdio when MCP_TRANSPORT=stdio)
CMD ["node", "dist/http.js"]

# Build arguments for runtime
ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# Labels for metadata
LABEL io.modelcontextprotocol.server.name="io.github.FouadHELLAL7/datto-edr-mcp"
LABEL version="${VERSION}"
LABEL description="Datto EDR MCP Server - Model Context Protocol server for Datto EDR (formerly Infocyte)"
LABEL org.opencontainers.image.title="datto-edr-mcp"
LABEL org.opencontainers.image.description="Model Context Protocol server for Datto EDR (formerly Infocyte)"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/FouadHELLAL7/datto-edr-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/FouadHELLAL7/datto-edr-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/FouadHELLAL7/datto-edr-mcp/pkgs/container/datto-edr-mcp"
LABEL org.opencontainers.image.licenses="Apache-2.0"
