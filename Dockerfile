# Stage 1: Build Frontend and Server
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

# Build Vite frontend and bundle server.ts with esbuild
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies for sqlite
RUN apk add --no-cache sqlite-libs

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend dist and server bundle from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/policies ./policies
COPY --from=builder /app/src/server/db/schema.sql ./src/server/db/schema.sql

# Create persistent storage volume mount directory
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.cjs"]
