# ─── Stage 1: Build frontend ────────────────────────────────
FROM node:20-slim AS client-build

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ─── Stage 2: Build backend deps ────────────────────────────
FROM node:20-slim AS server-build

# better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ─── Stage 3: Production image ──────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy node_modules from server-build
COPY --from=server-build /build/server/node_modules ./server/node_modules

# Copy server source
COPY server/ ./server/

# Copy built frontend
COPY --from=client-build /build/client/dist ./client/dist

# Create data directory for SQLite
RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=5001

EXPOSE 5001

WORKDIR /app/server
CMD ["node", "index.js"]
