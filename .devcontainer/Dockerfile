# Node 24 matches package.json "engines", CI, and the production Dockerfile.
FROM node:24-trixie

ARG USERNAME=code
ARG USER_UID=1000
ARG USER_GID=1000
# Same home path as the host so absolute paths inside ~/.claude keep resolving.
ARG USER_HOME=/home/code
# Keep in sync with @playwright/test in package-lock.json
ARG PLAYWRIGHT_VERSION=1.58.2

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Chicago \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

# fd-find: Debian ships the binary as fdfind (symlinked to fd below)
# postgresql-client: pg_isready / psql against the sibling Compose Postgres service
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fd-find \
    fish \
    fzf \
    git \
    openssh-client \
    postgresql-client \
    ripgrep \
    sudo \
  && ln -s "$(command -v fdfind)" /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# Chromium (the only Playwright project) plus its OS libraries, baked into the
# image so rebuilds don't re-download browsers.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
  && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH" \
  && rm -rf /var/lib/apt/lists/* /root/.npm

# CLIs: Claude Code and Codex. `--version` fails the build if either is broken.
RUN npm install -g @anthropic-ai/claude-code @openai/codex \
  && claude --version \
  && codex --version \
  && npm cache clean --force

# Replace the image's built-in `node` user (UID/GID 1000) with the host-matching user.
RUN userdel -r node \
  && groupadd --gid "$USER_GID" "$USERNAME" \
  && useradd --uid "$USER_UID" --gid "$USER_GID" -d "$USER_HOME" -m -s /usr/bin/fish "$USERNAME" \
  && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$USERNAME" \
  && chmod 0440 "/etc/sudoers.d/$USERNAME"

# Writable by the dev user so `npx playwright install chromium` can fetch a newer
# build after a Playwright upgrade.
RUN chown -R "$USER_UID:$USER_GID" "$PLAYWRIGHT_BROWSERS_PATH"

USER $USERNAME

CMD ["sleep", "infinity"]
