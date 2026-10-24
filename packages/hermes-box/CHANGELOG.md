# hermes-box

## 0.1.0

- First release: the `upstash_box` terminal backend for Hermes Agent. Commands, `execute_code` and the file tools run in an Upstash Box through live exec sessions, with stdin streaming, timeouts and interrupts that kill the remote process tree, and Hermes file sync (skills, cache, credential files).
- Persistent mode resumes one Box per task by name and pauses it on exit; non-persistent mode gives each session its own Box and deletes it when the session ends.
- Output streams into Hermes's output limits as it arrives; a command starts only after its session is registered, so an early interrupt never runs it; stdin failures are reported.
- A Box deleted outside Hermes is replaced on the next command; failed cleanup is retried and the Box is kept for a later attempt.
- The API endpoint is always passed explicitly (scoped `UPSTASH_BOX_BASE_URL` or the SDK default), and the SDK's telemetry headers are turned off.
- Requires Hermes Agent 0.22.3 or later.
- Settings: `terminal.upstash_box_size`, `upstash_box_runtime`, `upstash_box_keep_alive`, `upstash_box_labels`, `upstash_box_name_prefix`.
