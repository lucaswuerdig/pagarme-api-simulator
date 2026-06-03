# syntax=docker/dockerfile:1
#
# Multi-stage image for the fake Pagar.me API — LOCAL DEVELOPMENT ONLY.
#
# This image exists for local parity (run the fake plus a local Redis via
# docker-compose) so developers can exercise the KV-backed lifecycle without
# Vercel. It is NOT the deployment path: production ships to Vercel serverless
# functions via the GitHub Actions pipeline (ADR-006, ADR-007). Nothing in the
# Vercel deploy pipeline (`vercel.json`, `.github/workflows/ci.yml`) references
# this Dockerfile.
#
# Stage 1 (build):   install all deps and compile TypeScript -> dist/.
# Stage 2 (runtime): install production deps only and run `node dist/server.js`.

# ---- build stage ----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install the full dependency set (incl. TypeScript) against the lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# Compile src/ -> dist/ (tsc, per tsconfig.json: rootDir src, outDir dist).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage --------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The default listen port (Task 01's `resolvePort`; overridable via PORT).
ENV PORT=8088

# Production dependencies only (express + @vercel/kv); no build/test tooling.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The compiled application. The entrypoint is `dist/server.js` from the build
# stage (Task 01); the store backend is chosen at boot from STORE_BACKEND via
# the Task 07 factory.
COPY --from=build /app/dist ./dist

EXPOSE 8088

# Dependency-free liveness probe: hit /health on the resolved PORT.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8088)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
