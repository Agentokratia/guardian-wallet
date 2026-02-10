# Stage 1: Builder
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/package.json
COPY packages/schemes/package.json packages/schemes/package.json
COPY packages/chains/package.json packages/chains/package.json
COPY packages/server/package.json packages/server/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY biome.json ./

# Build server and its dependencies only (core, schemes, chains)
RUN pnpm --filter @agentokratia/guardian-server... build

# Stage 2: Runner
FROM node:20-alpine AS runner

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy built packages
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/schemes/dist packages/schemes/dist
COPY --from=builder /app/packages/schemes/package.json packages/schemes/package.json
COPY --from=builder /app/packages/chains/dist packages/chains/dist
COPY --from=builder /app/packages/chains/package.json packages/chains/package.json
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/package.json packages/server/package.json

# Install production deps only, then remove build tools
RUN pnpm install --prod --frozen-lockfile && apk del python3 make g++

EXPOSE 8080

RUN addgroup -g 1001 appgroup && adduser -D -u 1001 -G appgroup appuser
USER appuser

CMD ["node", "packages/server/dist/main.js"]
