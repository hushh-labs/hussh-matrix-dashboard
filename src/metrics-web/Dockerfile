FROM node:22-slim AS build
WORKDIR /workspace/src/metrics-web
COPY src/metrics-web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY src/metrics-web/app ./app
COPY src/metrics-web/lib ./lib
COPY src/metrics-web/scripts ./scripts
COPY src/metrics-web/next.config.ts src/metrics-web/next-env.d.ts src/metrics-web/tsconfig.json ./
COPY src/server/reports /workspace/src/server/reports
COPY src/lib/report-refresh.ts /workspace/src/lib/report-refresh.ts
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /workspace/src/metrics-web/.next/standalone ./
USER node
WORKDIR /app/src/metrics-web
EXPOSE 8080
CMD ["node", "server.js"]
