# CLI Source Architecture

```
src/
├── index.ts              CLI entry point (Commander.js)
├── auth.ts               Token resolution (flag → env var)
├── output.ts             Format utilities (JSON, raw)
├── repl/
│   ├── client.ts         BoxREPLClient — exported library for programmatic use
│   ├── terminal.ts       Terminal REPL wiring (readline, colors, spinner)
│   ├── spinner.ts        Braille spinner with random messages
│   └── commands/         REPL command handlers
│       ├── run.ts        Agent prompt streaming
│       ├── exec.ts       Shell command execution
│       ├── files.ts      File operations (read, write, list, upload, download)
│       ├── git.ts        Git operations (clone, diff, create-pr)
│       ├── snapshot.ts   Snapshot creation
│       ├── pause.ts      Box pause (exits REPL)
│       └── delete.ts     Box deletion (exits REPL)
├── commands/             CLI commands
│   ├── connect.ts        Connect to existing box (interactive selector if TTY)
│   ├── create.ts         Create new box
│   ├── from-snapshot.ts  Create box from snapshot
│   ├── list.ts           List all boxes
│   ├── get.ts            Get box details
│   ├── init-demo.ts      Scaffold demo project
│   └── completion.ts     Shell completion script output
├── utils/
│   ├── ansi.ts           ANSI color/cursor escape helpers
│   ├── fuzzy.ts          Levenshtein distance + fuzzy matching
│   └── interactive-select.ts  Arrow-key selector for TTY
└── __tests__/            Mirrors src/ structure
```

## Key Concepts

- **`repl/client.ts`** is the library export (`@upstash/box-cli`). It exposes `BoxREPLClient` and `REPLHooks` for UI consumers.
- **`repl/terminal.ts`** is CLI-specific — it wires readline, colors, spinner, and tab completion.
- Optional hooks (`onLoadingStart`, `onSuggestion`, `onCommandComplete`, `onCommandNotFound`) enable features by presence. CLI passes all hooks; UI consumers pass only what they need.
