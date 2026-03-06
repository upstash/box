# @upstash/box-cli

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
