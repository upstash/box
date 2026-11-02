# hermes-box

## 0.1.0

- First release: the `upstash_box` terminal backend for Hermes Agent. Commands, `execute_code` and the file tools run in an Upstash Box through live exec sessions, with stdin streaming, timeouts and interrupts that kill the remote process tree, and Hermes file sync (skills, cache, credential files).
- Persistent mode resumes one Box per task by name and pauses it on exit; non-persistent mode gives each session its own Box and deletes it when the session ends.
- Output streams into Hermes's output limits as it arrives and is never dropped; stdin failures are reported. Interrupts and timeouts never wait on the network.
- A Box deleted outside Hermes is replaced on the next command, and a Box paused outside Hermes is resumed; failed cleanup is retried and the Box is kept for a later attempt. After cleanup the environment refuses further commands instead of creating a Box nothing would release.
- If two Hermes processes create the same persistent Box at once, the second attaches it; reaching the plan's Box limit gives a message saying what to delete.
- Hermes file sync uploads each batch as one tar archive, so a typical skills folder reaches a new Box in a few seconds.
- Hermes's prompt-time backend probe does not get a Box of its own; the system prompt describes the backend instead.
- The API endpoint is always passed explicitly (scoped `UPSTASH_BOX_BASE_URL` or the SDK default), and the SDK's telemetry headers are turned off.
- Requires Hermes Agent 0.22.3 or later.
- Settings: `terminal.upstash_box_size`, `upstash_box_runtime`, `upstash_box_keep_alive`, `upstash_box_labels`, `upstash_box_name_prefix`.
