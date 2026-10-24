# hermes-box

## 0.1.0

- First release: the `upstash_box` terminal backend for Hermes Agent. Commands, `execute_code` and the file tools run in an Upstash Box through live exec sessions, with stdin streaming, timeouts and interrupts that kill the remote process tree, and Hermes file sync (skills, cache, credential files).
- Persistent mode resumes one Box per task by name and pauses it on exit; non-persistent mode gives each session its own Box and deletes it on exit.
- Settings: `terminal.upstash_box_size`, `upstash_box_runtime`, `upstash_box_keep_alive`, `upstash_box_labels`, `upstash_box_name_prefix`.
