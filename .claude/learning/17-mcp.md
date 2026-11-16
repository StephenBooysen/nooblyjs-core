# 17: MCP endpoint

**Time:** about 20 minutes · **Example:** [`examples/17-mcp.js`](examples/17-mcp.js) · **Run:** `node .claude/learning/examples/17-mcp.js`

## What you will learn

Let a coding agent (such as Claude Code) read and use a running NooblyJS app through the Model Context Protocol, with the same permissions as the REST API.

## Key ideas

- **MCP exposes the REST API as tools.** Each tool wraps one REST route. An agent lists the tools, then calls them by name with arguments.
- **Permissions are the REST permissions.** A tool is listed only if the caller may use its route. Calling a tool checks the same permission again.
- **Every call needs a caller.** An anonymous message gets `401`. Use an API key, or a personal access token that belongs to an admin.
- **Writes are off by default.** Write tools need `mcp.allowWrite` and the admin wildcard. Read tools work without it.
- **Transport.** `POST /services/mcp` takes JSON-RPC messages (Streamable HTTP). `nooblyjs mcp` is a stdio bridge for agents that start a process.

## Walk-through

### Turn it on

```javascript
registry.initialize(app, eventEmitter, {
  mcp: { enabled: true, allowWrite: false },
  security: { apiKeyAuth: { apiKeys: [process.env.API_KEY], requireApiKey: true } },
});
```

The example sets `allowWrite: true` so you can see write tools. Leave it off in production unless an agent truly needs to change data.

### List the tools

```javascript
const tools = await rpc('tools/list', {}, 1);
// tools.body.result.tools => [{ name: 'queue.stats', description, inputSchema }, ...]
```

### Call a tool

```javascript
await rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'emails' } }, 2);
```

The `arguments` object follows the tool's `inputSchema`. A missing required field is an error, so read the schema first.

### Anonymous calls

```
POST /services/mcp  (no key)  =>  401
```

### The stdio bridge

```bash
NOOBLYJS_URL=http://localhost:9000 NOOBLYJS_API_KEY=... nooblyjs mcp
```

Point your agent's MCP configuration at this command. It forwards each message to the running app, so the agent uses the same key and permissions as you do.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/mcp` | JSON-RPC over Streamable HTTP (`tools/list`, `tools/call`, and the rest of the protocol) |

Only mounted when `mcp.enabled` is set.

## Providers

MCP is one endpoint, not a provider. It reads the routes and permissions of the services you have created, so a service you do not create has no tools.

## Common mistakes

- **Giving the agent an admin key for everything.** Use a personal access token with narrow scopes (tutorial 14) so the agent can only do its job.
- **Turning on writes for convenience.** An agent that can write can also make mistakes at scale. Enable writes only for tools you need.
- **Expecting a tool for a service you did not create.** The endpoint lists only what is mounted.
- **Sending `structuredContent` that is not an object.** The protocol needs an object there. Results that are lists are wrapped as `{ result }`.
- **Forgetting the key in a new agent setup.** The agent gets `401` and it is not obvious why. Check the header first.

## Try it

1. Create two services, then list the tools and find the ones for each. Explain why a third service's tools are missing.
2. Call `queue.stats` with a different queue name and read the result.
3. Turn `allowWrite` off and check that a write tool is no longer listed.
