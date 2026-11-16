# 07: Data service

**Time:** about 20 minutes · **Example:** [`examples/07-dataservice.js`](examples/07-dataservice.js) · **Run:** `node .claude/learning/examples/07-dataservice.js`

## What you will learn

Store JSON records in named containers, find and change them by uuid, search by text, and choose a database for production.

## Key ideas

- **A container is a named collection of records.** `people`, `orders`, `invoices`. Create it, then add records to it.
- **Every record has a uuid.** The service assigns it when you add the record. Use that uuid to read, update or remove the record.
- **Records are JSON.** Any object you can serialise can be a record.
- **Find is a text search over the record.** `find(container, term)` returns the records that contain the term. For ranking, use the searching service (tutorial 13).
- **The same API for every backend.** `memory` for tests, `file` for a single server, MongoDB, DocumentDB and SimpleDB for production.
- **Outbox.** On MongoDB, `addWithEvent` writes a record and an event in one transaction, and `relayOutbox` sends the events. Use it when a record change must always produce an event.

## Walk-through

### Containers and records

```javascript
const data = registry.dataService('file', { dataDir: path.join(dataDir, 'data-07') });

await data.createContainer('people');
const ada = await data.add('people', { name: 'Ada', team: 'engine' });
await data.add('people', { name: 'Grace', team: 'compilers' });
```

`dataDir` is where the file provider keeps its files. It defaults to `./dataservice_data`.

### Read, update and remove by uuid

```javascript
await data.getByUuid('people', ada.uuid);
await data.update('people', ada.uuid, { name: 'Ada', team: 'analytics' });
await data.remove('people', ada.uuid);
```

### Find and count

```javascript
await data.find('people', 'engine');   // every record that contains "engine"
await data.count('people');
await data.listAll('people');
```

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/dataservice/api/:container` | Add a record; the container is created if needed |
| GET | `/services/dataservice/api/:container/:uuid` | Read one record |
| PUT | `/services/dataservice/api/:container/:uuid` | Update a record |
| DELETE | `/services/dataservice/api/:container/:uuid` | Remove a record |
| GET | `/services/dataservice/api/find/:container?q=term` | Find by text |
| GET | `/services/dataservice/api/count/:container` | Count the records |
| POST | `/services/dataservice/api/jsonFind/:containerName` | Find with a JSON query |
| GET | `/services/dataservice/api/analytics` | Operation counts |

## Providers

| Type | Stores records in | Use it for |
|---|---|---|
| `memory` | The process | Tests and examples |
| `file` | JSON files under `dataDir` | One server, small data |
| `mongodb` | MongoDB (needs `mongodb` installed and a URL) | Production documents, transactional outbox |
| `documentdb` | AWS DocumentDB | AWS-managed MongoDB-compatible storage |
| `simpledb` | AWS SimpleDB (needs the v2 SDK) | Legacy AWS key-value |
| `api` | A remote data service | Sharing data between apps |

## Common mistakes

- **Treating `find` as a ranked search.** It returns matches, not the best ones first. Use the searching service for ranking and synonyms.
- **Keeping the uuid of a record you removed.** Reading it afterwards does not return the record. Handle the missing case instead of assuming the record exists.
- **Storing secrets in records.** Records are not encrypted by this service. Put secrets in settings.
- **Writing to the database and then the queue separately.** If the process stops between the two, the event is lost. On MongoDB, use `addWithEvent`.
- **Using the `file` provider for concurrent writers.** It is designed for one process. Several servers need MongoDB or another shared store.

## Try it

1. Add three records to `people`, then find by team name. Count the records after removing one.
2. Use the REST `POST` route to add a record, then read it back with its uuid.
3. Open the `dataDir` folder and find the JSON file for `people`.
