FROM node:20-bookworm

# Minimal build+run deps for native node modules (e.g., sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/colosseum

# Use the non-root node user for dev
USER node
