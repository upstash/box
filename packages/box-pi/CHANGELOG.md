# @upstash/box-pi

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
