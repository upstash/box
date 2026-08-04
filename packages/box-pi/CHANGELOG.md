# @upstash/box-pi

## 0.1.4

### Patch Changes

- Updated dependencies [7fda346]
  - @upstash/box@0.6.2

## 0.1.3

### Patch Changes

- baea666: adds zod as a direct dependency. `pi install` skips peer dependencies, so @upstash/box's zod peer was never installed and the extension failed to load with "Cannot find module 'zod/v3'".

## 0.1.2

### Patch Changes

- 7987437: widens the pi-coding-agent peer range to >=0.79.0 <1.0.0 (npm install failed with ERESOLVE next to Pi >= 0.80), adds a gallery image to the pi manifest, and simplifies the README
- Updated dependencies [b55d832]
  - @upstash/box@0.6.1

## 0.1.1

### Patch Changes

- Updated dependencies [3890689]
  - @upstash/box@0.6.0

## 0.1.0

### Minor Changes

- fb3b733: Initial release of the Upstash Box extension for the Pi coding agent. The agent
  runs locally while `bash`, file I/O, and search execute inside a remote Box:
  one box per Pi session (idle-paused, reattached on resume, reaped when the
  session is deleted), per-session GitHub branch sync with automatic pushes,
  `/sandbox` `/github` `/compare` `/merge` `/pr` commands, and a `preview_url`
  tool with basic-auth protected preview links. Launch with `pi --box`.
