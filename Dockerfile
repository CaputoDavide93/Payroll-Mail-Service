FROM node:20-bookworm-slim

# Build tools so better-sqlite3 compiles if no prebuilt binary is available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates qpdf \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

# Persist the SQLite DB and uploaded attachments here.
VOLUME ["/data"]

CMD ["node", "server.js"]
