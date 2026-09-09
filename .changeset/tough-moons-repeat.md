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

Cancelling a run no longer reports itself as a timeout. Both the run and the stream paths now
track whether their own timeout fired, so `Run.cancel()` rejects with the underlying abort while a
real timeout still rejects with "Run timed out" / "Stream timed out". The stream path also clears
its timeout when the stream settles, which it previously never did.

A rejection that is not an `Error` (browsers abort with a `DOMException`, which is not an `Error`
there) is wrapped in an `Error` that keeps the original `name` and `message`, so callers can always
read a `stack`. `agent.stream()` now does this too, both when setup fails and when the stream
aborts mid-flight, matching `agent.run()`.

Ending a stream early no longer emits an unhandled promise rejection. The internal
`reader.cancel()` rejects rather than throws once the stream has errored, and that rejection was
not being observed.
