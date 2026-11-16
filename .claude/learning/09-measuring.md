# 09: Measuring

**Time:** about 15 minutes · **Example:** [`examples/09-measuring.js`](examples/09-measuring.js) · **Run:** `node .claude/learning/examples/09-measuring.js`

## What you will learn

Record numbers as they happen, then ask for totals and averages across all time or across a period. Use the same numbers over REST for the dashboard.

## Key ideas

- **A measure is a number with a time.** `add(metric, value)` records the value now. A metric is a name such as `visits` or `response-ms`.
- **Totals and averages are over a window.** `total` adds the values in the window; `average` takes their mean. `list` returns the measures themselves.
- **Dates are optional and inclusive.** Leave both out to cover all time. A start date alone keeps measures from that point on; an end date alone keeps measures up to it.
- **Bad dates are refused.** Over REST, a date that is not a date gets a `400` with a message. It is not treated as "no measures".
- **Measures are kept in memory.** The `default` provider keeps them in the process, so a restart clears them. Write them to your database or your monitoring system if you need history.

## Walk-through

### Record and aggregate

```javascript
const measuring = registry.measuring('default');

measuring.add('visits', 1);
measuring.add('visits', 1);
measuring.add('visits', 3);
measuring.add('response-ms', 120);
measuring.add('response-ms', 80);

console.log(measuring.total('visits'));           // 5
console.log(measuring.average('response-ms'));    // 100
```

### A period

```javascript
const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
measuring.total('visits', hourAgo, new Date());   // the visits in the last hour
```

### Over REST

```javascript
const from = encodeURIComponent(hourAgo.toISOString());
const to = encodeURIComponent(new Date().toISOString());
await call('GET', `/services/measuring/api/total/visits/${from}/${to}`);
```

The dates go in the path, so they are URL-encoded ISO strings.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/measuring/api/add` | Record `{ metric, value }` |
| GET | `/services/measuring/api/list/:metric/:datestart/:dateend` | The measures in the window |
| GET | `/services/measuring/api/total/:metric/:datestart/:dateend` | The sum |
| GET | `/services/measuring/api/average/:metric/:datestart/:dateend` | The mean |
| GET | `/services/measuring/api/analytics/summary` | Summary for the dashboard |
| GET | `/services/measuring/api/metrics` | Metric names |

## Providers

| Type | Stores measures | Notes |
|---|---|---|
| `default` | In memory, per process | The default |
| `api` | A remote measuring service | Share measures across apps |

## Common mistakes

- **Expecting history to survive a restart.** The `default` provider is in memory. Persist what you need.
- **Recording a metric per request for something you only need daily.** Every measure is kept, so volume grows. Aggregate in your code and record the result.
- **Mixing units in one metric.** Keep `response-ms` in milliseconds everywhere, or name the unit in the metric name.
- **Passing dates in the wrong order.** A window whose start is after its end holds no measures, so the total is zero.
- **Reading a zero as "no traffic".** Zero also means the window is empty or the metric name is wrong. Check the metric name first.

## Try it

1. Record five values, then ask for the total of the last minute, and for the total with no dates. Explain the difference.
2. Call the REST total with `yesterday` as the start date and read the 400 message.
3. Add a second metric and check that `total` for the first one is unchanged.
