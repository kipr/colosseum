FROM node:20-bookworm

# postgresql-client: pg_isready / psql against the sibling Compose Postgres service
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/colosseum

RUN npx playwright install-deps

RUN npm i -g @openai/codex

# Use the non-root node user for dev
USER node

RUN wget -qO- https://astral.sh/uv/install.sh | sh \
  && /home/node/.local/bin/uv tool install -p 3.13 serena-agent@latest --prerelease=allow

RUN npx playwright install
