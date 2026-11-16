# Example image for the OpenTelemetry compose stack (feature 07).
# The OpenTelemetry packages are optional peer dependencies, so they are installed
# in their own directory and found through NODE_PATH. The app itself is unchanged.
FROM node:24-alpine

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

RUN mkdir -p /opt/otel && cd /opt/otel \
 && echo '{"name":"otel-deps","version":"1.0.0","private":true}' > package.json \
 && npm install --no-audit --no-fund \
      @opentelemetry/api@1.9.0 \
      @opentelemetry/sdk-trace-node@2 \
      @opentelemetry/sdk-trace-base@2 \
      @opentelemetry/resources@2 \
      @opentelemetry/exporter-trace-otlp-http@0.200.0 \
      @opentelemetry/sdk-metrics@2 \
      @opentelemetry/exporter-metrics-otlp-http@0.200.0

COPY . .
ENV NODE_ENV=production \
    NODE_PATH=/opt/otel/node_modules
EXPOSE 9000
CMD ["node", "app.js"]
