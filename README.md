# nooblyjs-core

## Overview

**nooblyjs-core** is a modular Node.js backend framework providing a suite of core services for building scalable, event-driven applications. It abstracts common backend concerns such as caching, data storage, file management, logging, measuring, notifications, queueing, scheduling, searching, workflow orchestration, and background task execution. Each service is pluggable and can be backed by different providers (e.g., in-memory, Redis, S3, file system).

The project is designed for extensibility and rapid prototyping, making it suitable for microservices, serverless functions, and traditional server applications.

## Exposed APIs

The following RESTful APIs are exposed via the various service modules:

### Caching
- `POST   /api/caching/put/:key` — Store a value in the cache.
- `GET    /api/caching/get/:key` — Retrieve a value from the cache.
- `DELETE /api/caching/delete/:key` — Remove a value from the cache.
- `GET    /api/caching/status` — Get cache service status.

### Data Serving
- `POST   /api/dataserve/put/:key` — Store a value in the data store.
- `GET    /api/dataserve/get/:key` — Retrieve a value from the data store.
- `DELETE /api/dataserve/delete/:key` — Remove a value from the data store.
- `GET    /api/dataserve/status` — Get data service status.

### Filing (File Management)
- `POST   /api/filing/upload/:key` — Upload a file.
- `GET    /api/filing/download/:key` — Download a file.
- `DELETE /api/filing/remove/:key` — Remove a file.
- `GET    /api/filing/status` — Get filing service status.

### Logging
- `POST   /api/logging/log` — Log a message.
- `GET    /api/logging/status` — Get logging service status.

### Measuring
- `POST   /api/measuring/measure` — Record a measurement.
- `GET    /api/measuring/status` — Get measuring service status.

### Notifying
- `POST   /api/notifying/send` — Send a notification.
- `GET    /api/notifying/status` — Get notification service status.

### Queueing
- `POST   /api/queueing/enqueue` — Add an item to the queue.
- `GET    /api/queueing/dequeue` — Remove and return the next item from the queue.
- `GET    /api/queueing/size` — Get the current queue size.
- `GET    /api/queueing/status` — Get queue service status.

### Scheduling
- `POST   /api/scheduling/schedule` — Schedule a new task.
- `DELETE /api/scheduling/cancel/:taskId` — Cancel a scheduled task.
- `GET    /api/scheduling/status` — Get scheduler status.

### Searching
- `POST   /api/searching/add/` — Add a searchable object.
- `DELETE /api/searching/delete/:key` — Remove a searchable object.
- `GET    /api/searching/search/:term` — Search for objects.
- `GET    /api/searching/status` — Get search service status.

### Workflow
- `POST   /api/workflow/defineworkflow` — Define a new workflow.
- `POST   /api/workflow/start` — Start a workflow.
- `GET    /api/workflow/status` — Get workflow service status.

### Working (Background Tasks)
- `POST   /api/working/run` — Run a background task.
- `GET    /api/working/stop` — Stop the running task.
- `GET    /api/working/status` — Get worker status.

---

Each API is designed to be stateless and can be integrated independently. For more details on request/response formats and provider configuration, see the documentation in the `docs/` folder.

## Installation

To install **nooblyjs-core**, you can use npm:

```bash
npm install nooblyjs-core
npm run dev
```
## Publishing Changes

When publishing changes to the npm package, ensure you have built the project first. This will copy the necessary files to the `dist/` directory and prepare the package for distribution.

```bash
npm run build
```