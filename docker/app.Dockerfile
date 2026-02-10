# Stage 1: Builder
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./

# Copy app package.json
COPY packages/app/package.json packages/app/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/app/ packages/app/
COPY biome.json ./

# Build Vite app
RUN pnpm --filter @agentokratia/guardian-app build

# Stage 2: Serve with nginx
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/packages/app/dist /usr/share/nginx/html

# SPA fallback: redirect all routes to index.html
RUN printf 'server {\n\
    listen 3000;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

RUN addgroup -g 1001 appgroup && adduser -D -u 1001 -G appgroup appuser
RUN chown -R appuser:appgroup /var/cache/nginx /var/run /var/log/nginx /run
USER appuser

CMD ["nginx", "-g", "daemon off;"]
