# 15: AI service

**Time:** about 25 minutes · **Example:** [`examples/15-aiservice.js`](examples/15-aiservice.js) · **Run:** `node .claude/learning/examples/15-aiservice.js`

## What you will learn

Call a model through one API whatever the provider, read the reply and its usage, ask for structured output, create embeddings, and keep spending under control with budgets.

## Key ideas

- **One API for every model.** `complete`, `stream`, `generateObject` and `embed` work the same way for Anthropic, OpenAI-compatible endpoints, AWS Bedrock, Google Vertex AI, Azure and the mock provider. Changing the provider is a configuration change.
- **The mock provider is for development.** It answers from a script you give it, so you can build and test features with no network and no cost.
- **Budgets are enforced before the call.** `maxTokensPerRequest` limits the size of one request. `maxCostPerDay` stops calls once the day's estimated spend is reached. A request over either limit is refused with `429` before it is sent.
- **Structured output is a request for JSON.** `generateObject` asks the model for JSON that follows your schema, then parses it. A reply that is not JSON is refused with `422`.
- **Embeddings turn text into vectors.** Vectors of similar texts are close together, which is what meaning search and knowledge retrieval use (tutorials 13 and 16).
- **The 1.x names were removed in 2.0.0.** `claude`, `openai`, `ollama` and `gemini` now throw a message that names the replacement: `anthropic`, or `openai-compatible` with a `baseUrl`. `openai-kv` and `tensorflow` keep their own `prompt()` API.

## Walk-through

### Create the service

```javascript
const ai = registry.aiservice('mock', {
  script: [
    { text: 'You have 30 days to return an item.' },
    { text: '{"window_days": 30}' },
  ],
  budgets: { maxTokensPerRequest: 1000, maxCostPerDay: 5 },
});
```

To call a real model, pick a provider and set its credentials in the environment:

| Provider | Environment variables |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai-compatible` (OpenAI) | `OPENAI_API_KEY` |
| `openai-compatible` (xAI, Gemini, DeepSeek, and others) | `XAI_API_KEY` or `GROK_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` |
| `bedrock` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `vertex` | `GOOGLE_APPLICATION_CREDENTIALS` (a service-account file), `VERTEX_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` |
| `azure` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` |

The model names come from the catalogue in `src/aiservice/common/models.js`.

### Complete

```javascript
const reply = await ai.complete({
  system: 'You answer in one short sentence.',
  messages: [{ role: 'user', content: 'What is the returns window?' }],
  maxTokens: 200,
});
console.log(reply.text, reply.usage);
```

`maxTokens` caps the reply. Set it on every call: the default is larger than some budgets allow, and a call above the budget is refused.

### Structured output

```javascript
const object = await ai.generateObject({
  schema: { type: 'object', properties: { window_days: { type: 'number' } } },
  messages: [{ role: 'user', content: 'How many days is the returns window?' }],
  maxTokens: 200,
});
// { window_days: 30 }
```

### Embeddings

```javascript
const { vectors, model } = await ai.embed(['returns policy', 'shipping times']);
```

`vectors` is one array of numbers per input, in the same order. Store them with the document they describe.

### Streaming

`streamToResponse(res, request)` writes the reply to an HTTP response as server-sent events. Use it for chat interfaces, where the user should see text as it is produced. The REST `stream` route does the same.

## Over REST

All routes are under `/services/ai/api`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/ai/api/complete` | A reply with usage |
| POST | `/services/ai/api/stream` | A streamed reply (server-sent events) |
| POST | `/services/ai/api/generate-object` | Structured output |
| POST | `/services/ai/api/embed` | Embeddings |
| GET | `/services/ai/api/models` | Models the provider offers |
| GET | `/services/ai/api/status` | Is the service running |
| GET | `/services/ai/api/analytics` | Calls, tokens and cost |
| GET | `/services/ai/api/health` | Provider health |
| POST | `/services/ai/api/prompt` | Legacy prompt call |

The dashboard is at `/services/ai`.

## Providers

| Type | Kind | Notes |
|---|---|---|
| `anthropic` | v2 | Anthropic Messages API; key from `ANTHROPIC_API_KEY` |
| `openai-compatible` | v2 | Any OpenAI-style endpoint, including OpenAI itself |
| `bedrock` | v2 | AWS Bedrock; AWS credentials |
| `vertex` | v2 | Google Vertex AI; Google credentials |
| `azure` | v2 | Azure OpenAI; endpoint and key |
| `mock` | v2 | Scripted replies, no network |
| `claude`, `openai`, `ollama`, `gemini` | removed in 2.0.0 | Use `anthropic`, or `openai-compatible` with a `baseUrl` |
| `openai-kv` | legacy | Azure OpenAI with keys from Azure Key Vault |
| `tensorflow` | legacy | Experimental; needs `@tensorflow/tfjs-node` |

## Common mistakes

- **Leaving `maxTokens` at the default.** A call above the budget is refused. Set `maxTokens` to what the answer needs.
- **Trusting structured output without checking it.** The model can return JSON that does not match your schema. Validate it in your code.
- **Sending personal data without a decision.** Prompts go to the provider. Decide what may leave your system before you add it to a prompt.
- **Expecting the budget to be exact.** Cost is estimated from usage and the price table. Treat it as a guard, not an invoice.
- **Using the mock in production.** It returns what you scripted. Check the provider name at deployment.

## Try it

1. Script three replies and make three calls. Check the usage each one reports.
2. Lower `maxTokensPerRequest` to 100 and call with `maxTokens: 200`. Read the 429 message.
3. Embed two sentences that mean the same thing and two that do not. Compare the vectors with a dot product (the mock vectors are not meaningful, so try a real provider).
