# Node 24 matches package.json "engines", .nvmrc and CI.
FROM node:24-trixie AS toolchain

# Build stage
FROM toolchain AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Devcontainer stage: the toolchain plus dev tools. Not part of the production
# image; selected with `--target dev` (see .devcontainer/README.md).
FROM toolchain AS dev

# Keep in sync with @playwright/test in package-lock.json
ARG PLAYWRIGHT_VERSION=1.58.2

ENV TZ=America/Chicago

# fd-find: Debian ships the binary as fdfind (symlinked to fd below)
# bubblewrap: the agent CLIs' command sandbox
# postgresql-client: pg_isready / psql against the Compose postgres service
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bubblewrap \
    ca-certificates \
    curl \
    fd-find \
    fish \
    fzf \
    git \
    jq \
    openssh-client \
    postgresql-client \
    ripgrep \
    sudo \
    wget \
  && ln -s "$(command -v fdfind)" /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# OS libraries for Playwright's Chromium (the only Playwright project); the
# browser itself is installed below as the dev user.
RUN DEBIAN_FRONTEND=noninteractive npx --yes playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

# `--version` fails the build if the install is broken.
RUN npm install -g @openai/codex \
  && codex --version \
  && npm cache clean --force

# node:* ships a `node` user at UID/GID 1000; replace it with the fixed dev user.
# The home path is the same in every devcontainer because the shared agent
# volumes hold absolute paths.
RUN userdel -r node \
  && groupadd --gid 1000 code \
  && useradd --uid 1000 --gid 1000 --create-home --shell /usr/bin/fish code \
  && echo "code ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/code \
  && chmod 0440 /etc/sudoers.d/code

USER code

# Agent state lives in named volumes; a new volume inherits this ownership.
# CLAUDE_CONFIG_DIR also moves ~/.claude.json inside the volume.
ENV CLAUDE_CONFIG_DIR=/home/code/.claude \
    CODEX_HOME=/home/code/.codex \
    PATH=/home/code/.local/bin:$PATH
RUN mkdir -p "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && claude --version

# Baked into the image so rebuilds and new containers don't re-download it.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium \
  && rm -rf /home/code/.npm

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
