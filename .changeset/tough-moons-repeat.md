---
"@upstash/box": patch
---

Stop retrying a run that was aborted, and always clear its timeout.

`maxRetries` previously retried on any failure, including the abort raised by cancelling a run
or by hitting its `timeout`. A cancelled run therefore started a second run that kept working and
kept billing, invisible to the caller that had just cancelled. An abort now propagates immediately;
ordinary transient failures still retry.

A timeout that fires once the response stream is already open is reported as a `BoxError` rather
than the underlying abort, which hid it from the retry check. `BoxError` now carries that abort as
its `cause`, and the check follows the cause chain. `BoxError` takes an optional `cause` for this;
nothing else about it changes.

The run timeout handle is also cleared once the request settles, and is unref'd while it waits, so
a completed run no longer holds the process open for the remainder of a long timeout.
