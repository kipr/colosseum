# Build stage
FROM node:24-trixie AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install production dependencies separately so npm is not needed at runtime.
FROM node:24-trixie-slim AS production-dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Production stage
FROM debian:trixie-slim AS production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    libatomic1 \
    libstdc++6 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 node \
  && useradd --uid 1000 --gid node --create-home node

WORKDIR /app

# Copy only the Node runtime, production dependencies, and built application.
COPY --from=production-dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/static ./static

USER node

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port (Cloud Run uses 8080 by default)
EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server/server.js"]
