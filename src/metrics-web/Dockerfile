FROM node:22-slim AS build
WORKDIR /workspace/src/metrics-web
COPY src/metrics-web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY src/metrics-web ./
COPY src/server/reports /workspace/src/server/reports
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
