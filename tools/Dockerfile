# Pinned web-ext toolchain for TabTerrier.
#
# Everything npm-related happens in here, never on the host. Two deliberate
# supply-chain choices:
#   - base image pinned by digest, deps pinned by tools/package-lock.json
#   - --ignore-scripts, so no dependency's install hook ever executes
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

WORKDIR /opt/web-ext
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

ENV PATH="/opt/web-ext/node_modules/.bin:${PATH}"

# The extension source gets mounted here at run time.
WORKDIR /ext
ENTRYPOINT ["web-ext"]
