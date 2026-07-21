# @upstash/box

## 0.5.5

### Patch Changes

- 2402c3f: Fix `exec.command()` and `exec.code()` discarding stdout whenever the process wrote anything to stderr. Previously `run.result` returned stderr instead of stdout even on exit code 0, so a successful command that emitted a single warning (apt, git, bun, and most CLIs routinely do) lost its entire stdout. `run.result` is now stdout on success and stderr (falling back to stdout) on failure, and `Run` exposes new `stdout` and `stderr` getters with the raw streams.

  Behavioral change on the success path: if a command exits 0 and writes only to stderr, `run.result` is now `""` instead of the stderr text — read `run.stderr` for it.

## 0.5.4

### Patch Changes

- 6fd19d5: Add box labels: `labels` on create (`Box.create`, `Box.fromSnapshot`, `EphemeralBox.create`, `EphemeralBox.fromSnapshot`), a `label` filter on `Box.list`, `labels` on `BoxData`, and a `box.labels` namespace (`add`, `remove`, `list`) to manage labels on a running box.
- 65b577e: Add anonymous client telemetry, following the same header convention as the other Upstash SDKs: every API request carries `Upstash-Telemetry-Sdk`, `Upstash-Telemetry-Runtime`, and `Upstash-Telemetry-Platform` headers describing the SDK version, JS runtime, and deployment platform. No user data, request payloads, or identifiers are collected. Disable by setting the `UPSTASH_DISABLE_TELEMETRY` environment variable, or per client with the `enableTelemetry: false` config option (the only way to opt out on runtimes without `process.env`, such as Cloudflare Workers — which are now also detected as platform `cloudflare` via the `caches.default` global).

  The CLI appends its own identity (`@upstash/box-cli@<version>`) to the SDK telemetry chain, and `box --version` now reports the real package version (previously stuck at 0.1.0). Package versions embedded in the code are generated from package.json at build time.

## 0.5.3

### Patch Changes

- 59ce633: introduce gpt-5.6 and sonnet 5

## 0.5.2

### Patch Changes

- b42b94b: add alpine versions of runtimes
- 0ca3415: Add Claude Fable 5 to Claude Code model options.

## 0.5.1

### Patch Changes

- 3809cc7: revert claude-fable addition

## 0.5.0

### Minor Changes

- 4b1ee70: Expose cached input tokens in run usage. `run.cost` now includes `cachedInputTokens` (prompt-cache hits, billed at a discounted rate), the streaming `finish` chunk's `usage` carries `cachedInputTokens`, and `RunMetadata`/`BoxRunData` include the backend's `cached_input_tokens` field.

## 0.4.8

### Patch Changes

- 7c8c287: Add Claude Fable 5 to Claude Code model options.

## 0.4.7

### Patch Changes

- c4df70f: remove unsupported minimax model

## 0.4.6

### Patch Changes

- a277571: update outdated models

## 0.4.5

### Patch Changes

- 984fce8: adds multiple snapshot deletion
- 68895fc: Add Cursor Composer 2.5 model support.

## 0.4.4

### Patch Changes

- 4b975d2: adds opus 4.7 and 4.8 and gpt 5.5

## 0.4.3

### Patch Changes

- 023857c: Add Vercel AI Gateway model types and CLI model options.

## 0.4.2

### Patch Changes

- 078b177: populates totalCost on prompt execution

## 0.4.1

### Patch Changes

- 065290a: Add SDK support for custom Box agent harnesses.

## 0.4.0

### Minor Changes

- 3128242: Add Cursor as a first-class agent harness with Cursor model constants and CLI model selection support.

## 0.3.0

### Minor Changes

- af53beb: add toolCallId and first class tool result event to streaming chunks #122

## 0.2.3

### Patch Changes

- 0d2e01a: fixed gpt-5.4 support

## 0.2.2

### Patch Changes

- 8d98540: replace publicUrl with publicURL

## 0.2.1

### Patch Changes

- fd85b64: adds GPT_5_4_Codex support

## 0.2.0

### Minor Changes

- 985b9bf: Rename preview URL API to public URL, and support `keepAlive`/`initCommand` in `Box.fromSnapshot()`.
  - Added `box.getPublicUrl()`, `box.listPublicUrls()`, `box.deletePublicUrl()` and a new `PublicUrl` type.
  - `box.getPreviewUrl()`, `box.listPreviews()`, `box.deletePreview()`, and the `Preview` type are now `@deprecated` aliases that delegate to the new names and will be removed in a future major. Existing code continues to work unchanged.
  - `Box.fromSnapshot()` now accepts `keepAlive` and `initCommand` (previously threw `"Keep-alive boxes from snapshot are not supported yet"`).
  - Docs: corrected API key prefix from `abx_` to `box_` and added an SSH section.

## 0.1.36

### Patch Changes

- 7b837a4: Add Claude Opus 4.7 model support to the SDK and CLI model lists.

## 0.1.35

### Patch Changes

- ced40d1: adds env variable operations

## 0.1.34

### Patch Changes

- 2d6da63: adds keepAlive and initCommand

## 0.1.33

### Patch Changes

- 29b09cb: deprecate provider, use harness and prefer string for models

## 0.1.32

### Patch Changes

- b7ccab9: add timeout and agent options to schedule API

## 0.1.31

### Patch Changes

- 7442dff: Add type-safe options to RunOptions and StreamOptions for passing SDK-specific options to Claude Code, Codex, and OpenCode agents
- 7442dff: Add configurable box sizes (small, medium, large) to Box.create() and Box.fromSnapshot()
- 7442dff: Add Box.delete() static method for bulk box deletion
- 7442dff: Add multi-modal prompt files support for run and stream (file paths as multipart, base64 as JSON)
- 7442dff: Add box.skills namespace for managing platform skills (add, remove, list)

## 0.1.30

### Patch Changes

- e987ada: Remove fork method
- 4223fe9: add attachHeaders option for secret header injection on outbound requests
- f246fd2: Fix the issue with agent not working after restoring from snapshot

## 0.1.29

### Patch Changes

- 31ecc2b: Add `box.schedule` namespace with `exec`, `agent`, `list`, `get`, and `delete` methods for creating and managing recurring cron-based tasks on a box.
- f6ace16: Add networkPolicy options to boxes
- 9a92f6d: Add name option to box create and fromSnapshot
- 637455e: remove onChunk from agent.stream

## 0.1.28

### Patch Changes

- c213352: add base64 encoding option to files.read
- 206e3cb: add env option to EphemeralBox.create and fromSnapshot

## 0.1.27

### Patch Changes

- 59f7e3d: add git config params and update endpoint
- 0479627: move preview methods to top-level instead of namespace
- e9d0cf5: add fromSnapshot and snapshot methods to EphemeralBox

## 0.1.26

### Patch Changes

- 38e14a5: Add preview APIs to Box SDK
- b78402d: add EphemeralBox class and related tests for lightweight, short-lived boxes

## 0.1.25

### Patch Changes

- 8b75feb: move sending webhook to backend

## 0.1.24

### Patch Changes

- df176e3: Update files.upload and add encoding option to files.write

## 0.1.23

### Patch Changes

- 3ec02ee: Add fork method

## 0.1.22

### Patch Changes

- 1f0d9c2: Rename agent.runner to agent.provider with backwards compatibility

## 0.1.21

### Patch Changes

- 4bd4972: update opencode models

## 0.1.20

### Patch Changes

- 4012522: remove deepseek model

## 0.1.19

### Patch Changes

- 322acc5: Add more models to opencode
- 322acc5: make runner required

## 0.1.18

### Patch Changes

- 0d496b6: rerelease

## 0.1.17

### Patch Changes

- 27db087: send agent instead of runner in API body and set \_isAgentConfigured in configureModel
- f77a087: add /model command with interactive picker and runner support
- f77a087: Add new enums (Agent, OpenRouterModel, OpenCodeModel) and update types with agent

## 0.1.16

### Patch Changes

- bbb71ce: unify Run API with StreamRun, typed chunks, and private internals

## 0.1.15

### Patch Changes

- 2200960: send box.cd with \_request instead of exec.command

## 0.1.14

### Patch Changes

- d46dd09: Remove client-side tilde expansion from cd() and fix \_getFolder() to return absolute paths when cwd is outside /workspace/home
- b337178: add exec.stream and exec.streamCode for real-time streaming output. Use exec.stream in CLI

## 0.1.13

### Patch Changes

- 8f80c1c: Add suggestion getter to BoxREPLClient, fix list files returning null in empty directories, remove /code

## 0.1.12

### Patch Changes

- 3e8c5dc: Add args option to MCP initialization
- 387af1d: stop defaulting agent api key to UpstashKey when omitted
- 35bd038: add git/exec and git/checkout endpoints
- ccbbce8: Add box.cd and /cd
- 21b801d: Arange mcpServers option when creating a box. Split integration tests and enable integration test wf

## 0.1.11

### Patch Changes

- ac53303: make zod peer dependency

## 0.1.10

### Patch Changes

- 5eb899b: use server side json schema for structured output
- 952d208: Allow empty agent api key for Upstash managed key and add BoxApiKey options

## 0.1.9

### Patch Changes

- d0fddcd: Improve BoxData type
- 3b9aa5b: Change box.exec() as box.exec.command() and add box.exec.code() and /code

## 0.1.8

### Patch Changes

- 5654ca2: Dynamically import node:fs/promises and node:path so that the SDK can be used in a browser

## 0.1.7

### Patch Changes

- 9f002cd: Update types and define BoxREPLClient in cli

## 0.1.6

### Patch Changes

- 7f6be04: rm onStream from box.agent.run
- 13bbf2f: make result and cost of run sync
- 9a4ad3e: Improve box.agent.stream response with Chunk type

## 0.1.5

### Patch Changes

- d13c34d: use prod backend

## 0.1.4

### Patch Changes

- 24bdce1: allow BoxConfig.agent.apiKey to be undefined and verify in runtime

## 0.1.3

### Patch Changes

- 5fce98f: Make box status type safe

## 0.1.2

### Patch Changes

- 51b0b98: Rename stop/start to pause/resume
- e7dcd4d: allow initializing boxes without models and update backend url
- 9041916: use error as run result if it's set to fix the issue with nothing being returned when the command fails

## 0.1.1

### Patch Changes

- 310d227: Bump version to trigger release workflow

## 0.1.0

### Minor Changes

- 4dfd200: Initalize SDK and CLI
