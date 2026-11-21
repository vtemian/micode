FROM oven/bun:1-debian

# curl+unzip for the opencode installer, ca-certificates for HTTPS. No browser
# here: unlike octto, micode opens no UI, so the image needs no Xvfb/Chromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# The installer's layout varies by version, so locate the binary rather than
# assume a path, and fail loudly if it is missing.
ARG OPENCODE_INSTALL_URL=https://opencode.ai/install
RUN curl -fsSL "${OPENCODE_INSTALL_URL}" | bash \
    && OPENCODE_BIN="$(find / -type f -name opencode -perm -u+x 2>/dev/null | head -1)" \
    && test -n "${OPENCODE_BIN}" \
    && ln -sf "${OPENCODE_BIN}" /usr/local/bin/opencode \
    && opencode --version

WORKDIR /work

# Dependencies first so source edits do not bust the layer cache.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

ENV STUB_PORT=8787

ARG E2E_SPECS=e2e/specs
ENV E2E_SPECS=${E2E_SPECS}
CMD ["sh", "-c", "bun test ${E2E_SPECS} --timeout 300000"]
