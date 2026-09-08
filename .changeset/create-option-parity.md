---
"@upstash/box-cli": minor
---

Add the create-time options the CLI was missing.

`--keep-alive`, `--browser`, `--env` and the rest can only be chosen when a box is created, so an option with no flag was unreachable from the CLI for the life of the box. Four of the SDK's create options had none:

- `--skill <owner/repo/skill>` (repeatable), matching `skills`. The box agent wants a three-part Context7 identifier and only warns when it cannot parse one, so a malformed skill is silently not installed.
- `--network-policy <mode>` with `--allow-domain`, `--allow-cidr` and `--deny-cidr`, matching `box config network`. A list without `--network-policy` is an error rather than a box created with unrestricted egress.
- `--attach-header host:Name=value` (repeatable) and `--attach-headers-file <path>`, for headers injected into outbound requests. These values are secrets and a command line is visible in `ps` and shell history, so prefer the file.
- `--mcp name=package` / `--mcp name=https://url` (repeatable) and `--mcp-file <path>` for servers that also need `args` or `headers`.

Nothing existing changes: every flag is new, and `box create` without them sends exactly what it sent before.
