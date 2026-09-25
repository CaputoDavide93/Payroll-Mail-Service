# ---- Build stage: compile native deps (better-sqlite3) from the lockfile ----
FROM node:22-trixie-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: no compilers, non-root ----
FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates qpdf \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

# Persist the SQLite DB and uploaded attachments here. Owned by the unprivileged
# `node` user (uid 1000); an existing root-owned volume needs a one-off chown.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node

CMD ["node", "server.js"]
