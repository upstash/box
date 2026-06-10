# @upstash/box-cli

## 0.2.9

### Patch Changes

- Updated dependencies [4b1ee70]
  - @upstash/box@0.5.0

## 0.2.8

### Patch Changes

- 7c8c287: Add Claude Fable 5 to Claude Code model options.
- Updated dependencies [7c8c287]
  - @upstash/box@0.4.8

## 0.2.7

### Patch Changes

- 327e68d: add minimax m2.7
- Updated dependencies [c4df70f]
  - @upstash/box@0.4.7

## 0.2.6

### Patch Changes

- Updated dependencies [a277571]
  - @upstash/box@0.4.6

## 0.2.5

### Patch Changes

- 68895fc: Add Cursor Composer 2.5 model support.
- Updated dependencies [984fce8]
- Updated dependencies [68895fc]
  - @upstash/box@0.4.5

## 0.2.4

### Patch Changes

- 4b975d2: adds opus 4.7 and 4.8 and gpt 5.5
- Updated dependencies [4b975d2]
  - @upstash/box@0.4.4

## 0.2.3

### Patch Changes

- 023857c: Add Vercel AI Gateway model types and CLI model options.
- Updated dependencies [023857c]
  - @upstash/box@0.4.3

## 0.2.2

### Patch Changes

- Updated dependencies [078b177]
  - @upstash/box@0.4.2

## 0.2.1

### Patch Changes

- Updated dependencies [065290a]
  - @upstash/box@0.4.1

## 0.2.0

### Minor Changes

- 3128242: Add Cursor as a first-class agent harness with Cursor model constants and CLI model selection support.

### Patch Changes

- Updated dependencies [3128242]
  - @upstash/box@0.4.0

## 0.1.45

### Patch Changes

- Updated dependencies [af53beb]
  - @upstash/box@0.3.0

## 0.1.44

### Patch Changes

- 0d2e01a: fixed gpt-5.4 support
- Updated dependencies [0d2e01a]
  - @upstash/box@0.2.3

## 0.1.43

### Patch Changes

- Updated dependencies [8d98540]
  - @upstash/box@0.2.2

## 0.1.42

### Patch Changes

- fd85b64: adds GPT_5_4_Codex support
- Updated dependencies [fd85b64]
  - @upstash/box@0.2.1

## 0.1.41

### Patch Changes

- 04891f8: fix: make CLI self-contained so global install (`pnpm add -g`) works

  Move `@upstash/box` from `peerDependencies` to `dependencies` and add `zod` as a direct dependency. When installed globally via pnpm, peer dep resolution could pick up an older `zod` (e.g. `3.24.2`) from the shared global store, which lacks the `zod/v3` subpath that `zod-to-json-schema@^3.25.1` requires, causing `ERR_PACKAGE_PATH_NOT_EXPORTED` on startup.

- Updated dependencies [985b9bf]
  - @upstash/box@0.2.0

## 0.1.40

### Patch Changes

- 7b837a4: Add Claude Opus 4.7 model support to the SDK and CLI model lists.
- Updated dependencies [7b837a4]
  - @upstash/box@0.1.36

## 0.1.39

### Patch Changes

- ced40d1: adds env variable operations
- Updated dependencies [ced40d1]
  - @upstash/box@0.1.35

## 0.1.38

### Patch Changes

- Updated dependencies [2d6da63]
  - @upstash/box@0.1.34

## 0.1.37

### Patch Changes

- 29b09cb: deprecate provider, use harness and prefer string for models
- Updated dependencies [29b09cb]
  - @upstash/box@0.1.33

## 0.1.36

### Patch Changes

- Updated dependencies [b7ccab9]
  - @upstash/box@0.1.32

## 0.1.35

### Patch Changes

- Updated dependencies [7442dff]
- Updated dependencies [7442dff]
- Updated dependencies [7442dff]
- Updated dependencies [7442dff]
- Updated dependencies [7442dff]
  - @upstash/box@0.1.31

## 0.1.34

### Patch Changes

- Updated dependencies [e987ada]
- Updated dependencies [4223fe9]
- Updated dependencies [f246fd2]
  - @upstash/box@0.1.30

## 0.1.33

### Patch Changes

- Updated dependencies [31ecc2b]
- Updated dependencies [f6ace16]
- Updated dependencies [9a92f6d]
- Updated dependencies [637455e]
  - @upstash/box@0.1.29

## 0.1.32

### Patch Changes

- Updated dependencies [c213352]
- Updated dependencies [206e3cb]
  - @upstash/box@0.1.28

## 0.1.31

### Patch Changes

- 59f7e3d: add git config params and update endpoint
- Updated dependencies [59f7e3d]
- Updated dependencies [0479627]
- Updated dependencies [e9d0cf5]
  - @upstash/box@0.1.27

## 0.1.30

### Patch Changes

- Updated dependencies [38e14a5]
- Updated dependencies [b78402d]
  - @upstash/box@0.1.26

## 0.1.29

### Patch Changes

- Updated dependencies [8b75feb]
  - @upstash/box@0.1.25

## 0.1.28

### Patch Changes

- Updated dependencies [df176e3]
  - @upstash/box@0.1.24

## 0.1.27

### Patch Changes

- Updated dependencies [3ec02ee]
  - @upstash/box@0.1.23

## 0.1.26

### Patch Changes

- 1f0d9c2: Rename agent.runner to agent.provider with backwards compatibility
- Updated dependencies [1f0d9c2]
  - @upstash/box@0.1.22

## 0.1.25

### Patch Changes

- 4bd4972: update opencode models
- Updated dependencies [4bd4972]
  - @upstash/box@0.1.21

## 0.1.24

### Patch Changes

- Updated dependencies [4012522]
  - @upstash/box@0.1.20

## 0.1.23

### Patch Changes

- Updated dependencies [322acc5]
- Updated dependencies [322acc5]
  - @upstash/box@0.1.19

## 0.1.22

### Patch Changes

- Updated dependencies [0d496b6]
  - @upstash/box@0.1.18

## 0.1.21

### Patch Changes

- f77a087: make box peer dependency in cli
- 27db087: send agent instead of runner in API body and set \_isAgentConfigured in configureModel
- f77a087: add /model command with interactive picker and runner support
- Updated dependencies [27db087]
- Updated dependencies [f77a087]
- Updated dependencies [f77a087]
  - @upstash/box@0.1.17

## 0.1.20

### Patch Changes

- bbb71ce: unify Run API with StreamRun, typed chunks, and private internals
- Updated dependencies [bbb71ce]
  - @upstash/box@0.1.16

## 0.1.19

### Patch Changes

- Updated dependencies [2200960]
  - @upstash/box@0.1.15

## 0.1.18

### Patch Changes

- d46dd09: Remove client-side tilde expansion from cd() and fix \_getFolder() to return absolute paths when cwd is outside /workspace/home
- 597b5bf: handle Ctrl+C AbortError in REPL prompt gracefully
- ff4574e: add Tab autocomplete for file/directory names in CLI REPL
- b337178: add exec.stream and exec.streamCode for real-time streaming output. Use exec.stream in CLI
- Updated dependencies [d46dd09]
- Updated dependencies [b337178]
  - @upstash/box@0.1.14

## 0.1.17

### Patch Changes

- 8f80c1c: Add suggestion getter to BoxREPLClient, fix list files returning null in empty directories, remove /code
- Updated dependencies [8f80c1c]
  - @upstash/box@0.1.13

## 0.1.16

### Patch Changes

- 22c5937: remove logs from cd handler

## 0.1.15

### Patch Changes

- 387af1d: stop defaulting agent api key to UpstashKey when omitted
- 35bd038: add git/exec and git/checkout endpoints
- 35bd038: Add git commands status/commit/push
- ccbbce8: Add box.cd and /cd
- 8368191: REPL dual-mode (shell default, agent via /agent)
- Updated dependencies [3e8c5dc]
- Updated dependencies [387af1d]
- Updated dependencies [35bd038]
- Updated dependencies [ccbbce8]
- Updated dependencies [21b801d]
  - @upstash/box@0.1.12

## 0.1.14

### Patch Changes

- Updated dependencies [ac53303]
  - @upstash/box@0.1.11

## 0.1.13

### Patch Changes

- e26cebc: add interactive wizard for `box create`
- 952d208: Allow empty agent api key for Upstash managed key and add BoxApiKey options
- Updated dependencies [5eb899b]
- Updated dependencies [952d208]
  - @upstash/box@0.1.10

## 0.1.12

### Patch Changes

- 3b9aa5b: Change box.exec() as box.exec.command() and add box.exec.code() and /code
- Updated dependencies [d0fddcd]
- Updated dependencies [3b9aa5b]
  - @upstash/box@0.1.9

## 0.1.11

### Patch Changes

- 4503a09: Add /clear, /help commands and hiddenCommands option to REPL
- ea26326: Handle tool-call and todo events in CLI

## 0.1.10

### Patch Changes

- 680d410: Add snapshot command to cli
- Updated dependencies [5654ca2]
  - @upstash/box@0.1.8

## 0.1.9

### Patch Changes

- 2485b2d: set console url correctly in /console
- 9f002cd: Update types and define BoxREPLClient in cli
- Updated dependencies [9f002cd]
  - @upstash/box@0.1.7

## 0.1.8

### Patch Changes

- 117f493: Add /console command
- 13bbf2f: make result and cost of run sync
- 26accf7: Fix the issue with cursor moving to the end of the command previews in some terminals
- 9a4ad3e: Improve box.agent.stream response with Chunk type
- Updated dependencies [7f6be04]
- Updated dependencies [13bbf2f]
- Updated dependencies [9a4ad3e]
  - @upstash/box@0.1.6

## 0.1.7

### Patch Changes

- d13c34d: Change command suggestion colors
- Updated dependencies [d13c34d]
  - @upstash/box@0.1.5

## 0.1.6

### Patch Changes

- f268af0: Remove command suggestions in REPL after user submission

## 0.1.5

### Patch Changes

- 693c260: Improve UX with autocomplete, suggestions, text coloring, spinner when waiting. Restructured the project directory
- c50a151: Add BoxREPLClient to exports
- 554f000: color user input after submission
- Updated dependencies [24bdce1]
  - @upstash/box@0.1.4

## 0.1.4

### Patch Changes

- 42eab67: Add init-demo script
- Updated dependencies [5fce98f]
  - @upstash/box@0.1.3

## 0.1.3

### Patch Changes

- 51b0b98: Rename stop/start to pause/resume
- e7dcd4d: allow initializing boxes without models and update backend url
- Updated dependencies [51b0b98]
- Updated dependencies [e7dcd4d]
- Updated dependencies [9041916]
  - @upstash/box@0.1.2

## 0.1.2

### Patch Changes

- 713690c: use env variable UPSTASH_BOX_API_KEY instead of UPSTASH_BOX_TOKEN

## 0.1.1

### Patch Changes

- 310d227: Add header to list response
- Updated dependencies [310d227]
  - @upstash/box@0.1.1

## 0.1.0

### Minor Changes

- 4dfd200: Initalize SDK and CLI

### Patch Changes

- Updated dependencies [4dfd200]
  - @upstash/box@0.1.0
