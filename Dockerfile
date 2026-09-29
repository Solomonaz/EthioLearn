# ── Abugida production image ────────────────────────────────────────────────
# One image runs the custom server (Next.js + Socket.io, server.ts).
#
# The whole app directory is kept, dev dependencies included, on purpose:
#   • server.ts runs through `tsx` (a dev dependency) and imports src/lib;
#   • the Prisma CLI is needed for `prisma db push` on the server.
# That costs image size, not correctness, and keeps one image for everything.

FROM node:20-bookworm-slim AS build
WORKDIR /app

# Native build tools for `canvas` (used by pdf-img-convert for scanned-textbook
# OCR), in case its prebuilt binary cannot be downloaded for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
      ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so
# they come in as build arguments (docker-compose passes them from .env).
ARG NEXT_PUBLIC_GOOGLE_ENABLED=false
ARG NEXT_PUBLIC_FACEBOOK_ENABLED=false
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
ARG NEXT_PUBLIC_TELEGRAM_BOT_ID=
ENV NEXT_PUBLIC_GOOGLE_ENABLED=$NEXT_PUBLIC_GOOGLE_ENABLED \
    NEXT_PUBLIC_FACEBOOK_ENABLED=$NEXT_PUBLIC_FACEBOOK_ENABLED \
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME \
    NEXT_PUBLIC_TELEGRAM_BOT_ID=$NEXT_PUBLIC_TELEGRAM_BOT_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build


FROM node:20-bookworm-slim AS run
WORKDIR /app

# Runtime libraries for canvas, plus openssl for Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
      ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    UPLOAD_ROOT=/data/uploads \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data

USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server.ts"]
