# @upstash/box

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
