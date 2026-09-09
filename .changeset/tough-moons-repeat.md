---
"@upstash/box": patch
---

Stop retrying a run that was aborted, and always clear its timeout.

`maxRetries` previously retried on any failure, including the abort raised by cancelling a run
or by hitting its `timeout`. A cancelled run therefore started a second run that kept working and
kept billing, invisible to the caller that had just cancelled. An abort now propagates immediately;
ordinary transient failures still retry.

The run timeout handle is also cleared once the request settles, and is unref'd while it waits, so
a completed run no longer holds the process open for the remainder of a long timeout.
