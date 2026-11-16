# OpenTelemetry example (feature 07)

A NooblyJS app that sends traces and metrics over OTLP to an OpenTelemetry
Collector, which forwards traces to Jaeger.

```bash
cd examples/otel
docker compose up --build
# send some requests
curl http://localhost:9000/health/live
# then open http://localhost:16686 and choose the service nooblyjs-app
```

## What you get

- **HTTP spans** named by route, with W3C `traceparent` propagation in and out.
- **Service spans** for async methods of each service (for example `caching.get`).
- **Queue propagation:** an item enqueued inside a traced request carries its
  trace context (`_trace.traceparent`). A consumer that calls
  `registry.telemetry.continueTrace(item, 'name', fn)` runs its work as a child
  span of the request that produced the item. Webhook deliveries do this, so a
  delivery appears under the request that published the event.
- **GenAI attributes** on AI Service calls: `gen_ai.system`,
  `gen_ai.response.model`, `gen_ai.usage.input_tokens` and
  `gen_ai.usage.output_tokens`, when the result reports them.
- **Metrics:** `nooblyjs.service.duration` (histogram, ms) and
  `nooblyjs.service.errors` (counter), both per service and method.
- **Logs** carry `request_id`, `trace_id` and `span_id`.

## Files

- `Dockerfile`: the app image, with the optional OpenTelemetry packages in
  `/opt/otel` and found through `NODE_PATH`.
- `docker-compose.yml`: app, collector and Jaeger.
- `otel-collector.yaml`: OTLP in, Jaeger and debug out.

The collector image is pinned to `otel/opentelemetry-collector-contrib:0.119.0`.
Tag 0.116.0 starts with "no such file or directory" for `/otelcol-contrib`
on the machine this was checked on, so it is not used here.

## Not included yet

- Metrics for queue depth and worker lag (only service calls are measured).
- A GenAI span per streamed token (the span covers the whole call).
