---
type: Learning Guide
title: '08: Filing'
description: Create, read, update, list and delete files in a storage root, see how paths are kept inside it, and accept uploads safely over REST.
---

# 08: Filing

**Time:** about 20 minutes · **Example:** [`examples/08-filing.js`](examples/08-filing.js) · **Run:** `node .claude/learning/examples/08-filing.js`

## What you will learn

Create, read, update, list and delete files in a storage root, see how paths are kept inside it, and accept uploads safely over REST.

## Key ideas

- **A storage root.** Every file lives under one folder, the `baseDir`. Paths in the API are relative to it.
- **Paths cannot leave the root.** A path such as `../../etc/passwd` is refused before the disk is touched. The provider emits a `filing:security-error` event, which you can listen for on the shared emitter.
- **Uploads have limits.** A maximum size (10 MB by default) and an allow-list of file types. Active content such as HTML, SVG, XML and JavaScript is not on the default list, because a browser would run it when someone opens the file.
- **Scripts cannot run from the storage root.** A working service refuses an activities folder that overlaps any filing root (tutorial 10). Uploads must never be executable.
- **Providers.** `local` is a folder on this machine. `s3`, `gcp`, `ftp` and `git` store files remotely or in a repository. `sync` keeps two stores in step. `api` proxies to a remote filing service.

## Walk-through

### Create a store

```javascript
const filing = registry.filing('local', { baseDir: path.join(dataDir, 'files-08') });
```

Without `baseDir` the store is `./.application/files` (set `FILING_BASE_DIR` to change it). Pick a folder that is not your source code.

### Write, read and update

```javascript
await filing.create('reports/q1.txt', 'Revenue up 12%');
console.log(await filing.read('reports/q1.txt', 'utf8'));   // Revenue up 12%
await filing.update('reports/q1.txt', 'Revenue up 14% (revised)');
```

`create` makes the folders it needs. `read` without an encoding returns a Buffer, which is the right choice for binary files.

### List and delete

```javascript
const items = await filing.list('reports');   // name, type, size, created, modified
await filing.delete('reports/q1.txt');
```

### The path check

```javascript
await filing.read('../../etc/passwd', 'utf8');
// Error: Path traversal detected: path is outside the base directory
```

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/filing/api/upload/:path` | Upload a multipart form, file in the `file` field |
| POST | `/services/filing/api/upload-stream/:path` | Upload a raw stream, with the size limit enforced while streaming |
| GET | `/services/filing/api/download/:path` | Download a file (attachment for active types) |
| GET | `/services/filing/api/browse/:path` | List a folder |
| DELETE | `/services/filing/api/remove/:key` | Delete a file |
| GET | `/services/filing/api/settings` | Read the limits |
| POST | `/services/filing/api/settings` | Change the runtime limits (`maxFileSize`, `allowedTypes`) |

The upload example:

```javascript
const form = new FormData();
form.append('file', new Blob(['Q2 numbers'], { type: 'text/plain' }), 'q2.txt');
await fetch(`${base}/services/filing/api/upload/reports/q2.txt`, {
  method: 'POST',
  headers: { 'x-api-key': API_KEY },
  body: form,
});
```

The path after `upload/` is the full destination, file name included.

## Providers

| Type | Stores files in | Needs |
|---|---|---|
| `local` | A folder (`baseDir`) | Nothing |
| `s3` | An S3 bucket | The AWS SDK and credentials |
| `gcp` | Google Cloud Storage | The GCP SDK and credentials |
| `ftp` | A remote FTP server | Host and login |
| `git` | A git repository | `git` on the path |
| `sync` | Two providers, kept in step | Both providers |
| `api` | A remote filing service | The remote URL |

## Common mistakes

- **Putting the storage root inside your source tree.** Uploads then sit next to your code, and a misconfiguration can expose it. Use a separate folder.
- **Allowing active types.** Adding `html` or `svg` to `allowedTypes` lets an uploaded page run script in your site. Serve untrusted files as attachments only.
- **Building paths from user input without checking them.** The provider checks, but a clear error is better than a surprise: validate the name first.
- **Uploading big files through the JSON body.** Use the multipart route or the stream route; they enforce the size limit.
- **Forgetting the file name in the upload path.** `upload/reports` stores a file called `reports`. Put the name in the path: `upload/reports/q2.txt`.

## Try it

1. Create a file, list its folder, and read it back as a Buffer (no encoding) and as text.
2. Upload a file over REST with `file` set to a name ending in `.html`. Check whether the upload is accepted and how it downloads.
3. Try `filing.read('/etc/hostname')` with an absolute path. Explain the result.
