---
type: Learning Guide
title: '16: Knowledge'
description: Answer questions from your own documents, with numbered citations that point at the source, and give the service feedback so it can be checked.
---

# 16: Knowledge

**Time:** about 25 minutes · **Example:** [`examples/16-knowledge.js`](examples/16-knowledge.js) · **Run:** `node .claude/learning/examples/16-knowledge.js`

## What you will learn

Answer questions from your own documents, with numbered citations that point at the source, and give the service feedback so it can be checked.

## Key ideas

- **Knowledge reads from filing.** Documents live in a filing store (tutorial 08). The knowledge service syncs them, splits them into chunks, and indexes the chunks in a vector search (tutorial 13).
- **Sync is incremental.** Each file has a content hash. Only new or changed files are read again.
- **Answers cite their sources.** `ask` returns `{ text, citations, confidence }`. The text refers to sources by number, and each citation names the file and the passage.
- **Access follows the files.** `access(path)` returns the roles a file is open to. The REST routes pass the caller's roles, so a user only gets answers drawn from documents they may read.
- **Quality is measurable.** Feedback (good or bad) is recorded, and `evaluate` scores retrieval and citations against cases written in YAML.
- **It needs an AI provider for real answers.** The `mock` provider returns placeholder text, so the example's citations are empty. Use a real provider (tutorial 15) to see answers and citations.

## Walk-through

### Put documents in a filing store

```javascript
const filing = registry.filing('local', { baseDir });
await filing.create('policies/returns.md', '# Returns\n\nYou can return an item within 30 days with your receipt.');
```

### Create the knowledge service

```javascript
const knowledge = registry.knowledge('default', {
  dependencies: { filing, aiservice },
  persist: false,
});
```

`persist: false` keeps the index in memory. Set it to `true` to save the index and the feedback next to the sources, in `.knowledge-state.json` and `.knowledge-feedback.json`. Use `restore: true` to reload them after a restart and `watch: true` to re-sync when files change.

### Sync and ask

```javascript
await knowledge.sync({ directory: '/' });
const answer = await knowledge.ask('How long do I have to return an item?', { k: 3 });
console.log(answer.text, answer.confidence, answer.citations);
```

`k` is how many chunks to retrieve. `askStream` (and the REST `ask/stream` route) sends the answer as server-sent events, for chat interfaces.

### Give feedback

Feedback is recorded against an answer, so you can see which answers people found wrong. Review the bad ones first; they show where the documents or the retrieval need work.

### Evaluate

`evaluate` runs a set of YAML cases, each with a question and the source you expect to be cited, and reports retrieval and citation scores. Run it after you change documents or settings, so a change that makes answers worse is visible.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/knowledge/api/sync` | Re-index the sources |
| GET | `/services/knowledge/api/sources` | The indexed files |
| GET | `/services/knowledge/api/status` | Index status |
| POST | `/services/knowledge/api/ask` | `{ question }` returns an answer with citations |
| POST | `/services/knowledge/api/ask/stream` | The same, as server-sent events |
| POST | `/services/knowledge/api/retrieve` | The chunks for a question, without an answer |
| POST | `/services/knowledge/api/feedback` | Record good or bad feedback on an answer |
| POST | `/services/knowledge/api/evaluate` | Run the evaluation cases |

## Providers

Knowledge has one provider, `default`. Its parts are chosen by what you pass in: a filing store, an AI service, and a vector search (created for you unless you pass one).

## Common mistakes

- **Judging answers from the mock provider.** It returns placeholders by design. Test with a real model.
- **Not re-syncing after a change.** New or edited documents are not seen until `sync` runs (or `watch` is on).
- **Trusting an answer without its citations.** Check that the citation supports the claim. A confident answer with no source is a warning sign.
- **Putting private documents where every caller can reach them.** Answers respect the roles a file is open to (`access(path)`). Check those roles for any private folder before you sync it.
- **Expecting a large corpus to be cheap.** Every question calls the model, and a large index costs more to build. Keep `k` small and sync only the folders you need.

## Try it

1. Add a third policy file, sync, and ask about it. Check that the new file appears in `sources`.
2. Change the returns policy and ask again without syncing. Then sync and ask again.
3. Write one evaluation case with the expected source and run `evaluate`. Read the score.
