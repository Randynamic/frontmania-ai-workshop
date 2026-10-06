# Workshop backend: Hono app from this repo, run with tsx. Build context is the repo root (.dockerignore trims it).
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--import", "tsx", "infra/backend/src/server.ts"]
