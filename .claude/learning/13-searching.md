---
type: Learning Guide
title: '13: Searching'
description: Index documents, search them with ranked results, get suggestions as someone types, and remove documents from the index.
---

# 13: Searching

**Time:** about 20 minutes · **Example:** [`examples/13-searching.js`](examples/13-searching.js) · **Run:** `node .claude/learning/examples/13-searching.js`

## What you will learn

Index documents, search them with ranked results, get suggestions as someone types, and remove documents from the index. Then choose between word search and meaning search.

## Key ideas

- **An index holds documents by key.** `add(key, document)` stores a document. The key is how you remove or replace it later.
- **Search is by whole word.** `password` matches a document that contains `password`. It does not match `passwords`, because nothing is stemmed. Use the word as people will type it, or add the variants you need.
- **Results are ranked.** Each hit has a `score`, and the best matches come first. The hit also says which terms matched and in which field.
- **Suggestions come from the index.** `suggest` returns matching titles and words for a partial input, for search boxes.
- **Word search or meaning search.** `memory` finds words. `vector` and `semantic` also use embeddings from the AI service, so "send it back" can find a page about returns. Those need an AI provider (tutorial 15).

## Walk-through

### Index documents

```javascript
const search = registry.searching('memory');

await search.add('policy-returns', {
  title: 'Returns policy',
  body: 'You can return an item within 30 days with your receipt.',
});
```

Index the fields people will search. A document can have any shape; the search reads the fields it is configured to read.

### Search

```javascript
const hits = await search.search('return receipt');
// hits[0] => { key: 'policy-returns', score: 2.01, title, body, terms: [...], match: {...} }
```

### Suggestions

```javascript
await search.suggest('ship');   // matching titles and words, for a search box
```

### Remove

```javascript
await search.remove('faq-passwords');
```

A removed document no longer appears in results.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/searching/api/add/` | Add a document (`key` and the fields) |
| POST | `/services/searching/api/add-bulk` | Add many documents |
| POST | `/services/searching/api/replace` | Replace a document |
| DELETE | `/services/searching/api/delete/:key` | Remove a document |
| GET | `/services/searching/api/search/:term` | Search for a term |
| POST | `/services/searching/api/search/:searchContainer` | Search a named index with options |
| GET | `/services/searching/api/suggest/:term` | Suggestions |
| GET | `/services/searching/api/autosuggest/:term` | Autosuggest |
| GET | `/services/searching/api/indexes` | List indexes |
| DELETE | `/services/searching/api/indexes/:searchContainer` | Delete an index |
| GET | `/services/searching/api/semantic` | Meaning search (needs an embedding provider) |
| POST | `/services/searching/api/evaluate` | Measure ranking quality against labelled cases |

## Providers

| Type | Finds | Needs |
|---|---|---|
| `memory` (or `default`) | Words, in process | Nothing |
| `vector` (or `semantic`) | Words and meaning, using embeddings | An AI provider for embeddings |
| `solr` | Words, in an Apache Solr server | A Solr server |
| `api` | A remote searching service | The remote URL |

## Common mistakes

- **Expecting plural and past forms to match.** Matching is by word. Index the forms users type, or use meaning search.
- **Forgetting to remove a document you deleted in your database.** The search keeps finding it until you call `remove`. Keep the index in step with the source.
- **Indexing everything.** Index the fields people search and a title. Large bodies make the index big and slow to save.
- **Trusting the score as a percentage.** Scores compare hits for one query. They are not comparable across queries.
- **Calling meaning search without an embedding provider.** It has nothing to compare, so it cannot rank by meaning.

## Try it

1. Add three documents, then search for a word that appears in two of them. Check the order of the hits.
2. Search for `passwords` and then `password`. Explain the difference, and add a document that matches both forms.
3. Remove a document and check the suggestions no longer include its title.
