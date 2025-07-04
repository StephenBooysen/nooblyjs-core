# noobly-core

This project provides a collection of core functionalities for building Node.js applications. It includes modules for caching, data management, file operations, logging, metrics, notifications, queueing, scheduling, search, and workflows.

## Functionality

The project is divided into the following modules:

*   **Caching:** Provides a caching service with support for in-memory, Redis, and Memcached.
*   **Dataserve:** A data management service that allows you to store and retrieve data from various sources, including in-memory, file-based, and AWS SimpleDB.
*   **Filing:** An abstraction layer for file operations, with support for local file systems, FTP, and AWS S3.
*   **Logging:** A logging service that can log to the console or to a file.
*   **Measuring:** A service for capturing and aggregating metrics.
*   **Notifying:** A topic-based publish/subscribe system for sending and receiving notifications.
*   **Queueing:** An in-memory queueing service for managing tasks.
*   **Scheduling:** A service for scheduling tasks to run at a specific time or interval.
*   **Searching:** A search service for indexing and searching data.
*   **Workflow:** A service for defining and executing sequential workflows.
*   **Working:** A service for running background tasks.

## APIs

The project exposes the following APIs:

### Caching

*   `GET /api/caching/status`: Gets the status of the caching service.
*   `POST /api/caching/put/:key`: Adds a record to the cache.
*   `GET /api/caching/get/:key`: Retrieves a record from the cache.
*   `DELETE /api/caching/delete/:key`: Deletes a record from the cache.

### Dataserve

*   `GET /api/dataserve/status`: Gets the status of the dataserve service.
*   `POST /api/dataserve/put/:key`: Adds a record to the data store.
*   `GET /api/dataserve/get/:key`: Retrieves a record from the data store.
*   `DELETE /api/dataserve/delete/:key`: Deletes a record from the data store.

### Filing

*   `GET /api/filing/status`: Gets the status of the filing service.
*   `POST /api/filing/upload/:filename`: Uploads a file.
*   `GET /api/filing/download/:filename`: Downloads a file.
*   `DELETE /api/filing/remove/:filename`: Removes a file.

### Logging

*   `GET /api/logging/status`: Gets the status of the logging service.
*   `POST /api/logging/log`: Logs a message.

### Measuring

*   `GET /api/measuring/status`: Gets the status of the measuring service.
*   `POST /api/measuring/measure`: Records a measurement.

### Notifying

*   `GET /api/notifying/status`: Gets the status of the notifying service.
*   `POST /api/notifying/send`: Sends a notification.

### Queueing

*   `GET /api/queueing/status`: Gets the status of the queueing service.
*   `POST /api/queueing/enqueue`: Adds a task to the queue.
*   `GET /api/queueing/dequeue`: Removes a task from the queue.
*   `GET /api/queueing/size`: Gets the size of the queue.

### Scheduling

*   `GET /api/scheduling/status`: Gets the status of the scheduling service.
*   `POST /api/scheduling/schedule`: Schedules a task.
*   `DELETE /api/scheduling/cancel/:taskId`: Cancels a scheduled task.

### Searching

*   `GET /api/searching/status`: Gets the status of the searching service.
*   `POST /api/searching/add`: Adds a document to the search index.
*   `GET /api/searching/search/:query`: Searches the index.

### Workflow

*   `GET /api/workflow/status`: Gets the status of the workflow service.
*   `POST /api/workflow/defineworkflow`: Defines a new workflow.
*   `POST /api/workflow/start`: Starts a workflow.

### Working

*   `GET /api/working/status`: Gets the status of the working service.
*   `POST /api/working/run`: Runs a background task.
