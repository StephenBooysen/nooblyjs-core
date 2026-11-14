# Queues

## Retries and dead letters

Reliable jobs retry with exponential backoff. After the last attempt a job moves to the dead-letter queue, where it can be retried by hand.
