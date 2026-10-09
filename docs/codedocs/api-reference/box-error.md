---
title: "BoxError"
description: "SDK error type that includes optional HTTP status codes."
---

**Source**: `packages/sdk/src/client.ts`

`BoxError` is thrown for SDK-level failures, HTTP errors, timeout errors, and parsing issues. It extends `Error` and includes an optional `statusCode` when the error originates from an HTTP response.

## When it is thrown
The SDK throws `BoxError` in several situations: missing credentials, non-2xx API responses, timeouts enforced by `AbortController`, and structured-output parsing failures. For example, `Box.create()` throws immediately if no API key is provided, and `agent.run()` throws if `responseSchema` parsing fails. These errors all share the same class so you can handle them consistently.

## Constructor
```ts
new BoxError(message: string, statusCode?: number)
```

## Properties
| Property | Type | Description |
|---------|------|-------------|
| name | `string` | Always `"BoxError"`. |
| message | `string` | Error message. |
| statusCode | `number \| undefined` | HTTP status if available. |

## Example
```ts
import { Box } from "@upstash/box";

try {
  await Box.create();
} catch (err) {
  if (err instanceof Error) {
    console.error(err.name, err.message);
  }
}
```

## Handling patterns
If you want to surface API failures to a user, check `statusCode` and map 401/403 errors to authentication issues, 429 to rate limits, and 5xx to transient failures. For timeouts, the SDK message is usually `"Request timeout"` or `"Run timed out"`. You can retry those selectively without retrying schema parsing errors, which typically indicate a prompt mismatch.

In typed codebases, you can use `err instanceof BoxError` to branch on Box-specific failures. This keeps your error handling narrower and avoids catching unrelated errors thrown by your own code.

When debugging, log both `message` and `statusCode` to differentiate authentication problems from runtime errors. If the status code is missing, the error likely occurred client-side (for example, a timeout or schema parsing failure) rather than from the HTTP response itself.
