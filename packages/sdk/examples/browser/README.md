# Browser examples

Runnable examples for the Box browser, grouped by use case. Every file is
self-contained: paste it, run it, read the output.

```bash
export UPSTASH_BOX_API_KEY=...   # or use: node --env-file=.env <file>
node agents/01-search-with-fallback.ts
```

## Prerequisites

- All examples need `UPSTASH_BOX_API_KEY`.
- Examples marked **AI** below use metered browser AI (`run`, `act`,
  `extract`) and need a model provider key configured on the box or account.
- Everything else runs with the Box key alone.

## agents/ — goal-driven browsing with `tab.run()`

| File | AI | What it shows |
| --- | --- | --- |
| `01-search-with-fallback.ts` | yes | Constrained search with a fallback category; the agent evaluates, rejects with reasons, and switches on its own |
| `02-playwright-vs-act-vs-run.ts` | yes | The same task via Playwright, `act`+`extract`, and `run` — pick your autonomy level by token cost |
| `03-observe-record-audit.ts` | yes | The search again with live view, session recording, decision log, and token accounting |
| `04-multisite-feed.ts` | yes | One prompt + one schema across three differently structured sites |

## automation/ — forms, files, and durable sessions

| File | AI | What it shows |
| --- | --- | --- |
| `01-checkout-with-one-ai-step.ts` | one `act` | Script the deterministic steps, delegate the judgment call, assert the result |
| `02-download-and-process.ts` | no | A download lands on the box filesystem and is processed in place |
| `03-upload-from-box.ts` | no | Upload a box-generated file through a real form via CDP |
| `04a-login-once-keep-alive.ts` + `04b-reuse-session.ts` | no | Log in once into a keep-alive box; any later script reuses the session. **04a leaves a box running** (id in `.box-workspace`) — delete it when done |

## retrieval/ — structured data out of rendered pages

| File | AI | What it shows |
| --- | --- | --- |
| `01-catalog-extraction.ts` | yes | One `extract` call, schema-validated typed output, screenshot provenance |
| `02-ai-compiled-scraper.ts` | first run only | AI compiles selectors once; every later run scrapes deterministically. Run twice. **Leaves a box** holding the recipe (`.box-compiled-scraper`) |
| `03-crawl-to-dataset.ts` | no | Crawl a client-rendered docs section into chunked JSONL via `tab.content()` |
| `04-evidence-pack.ts` | no | Full-page captures + hashed manifest, assembled in the box, downloaded as one archive |

## testing/ — the box as a test environment

| File | AI | What it shows |
| --- | --- | --- |
| `01-playwright-migration.ts` | no | An existing Playwright test where only the launch line changes |
| `02-test-your-own-app.ts` | no | The box hosts the app under test and browses it on its own localhost |
| `03-ai-smoke-tests.ts` | yes | Agent-driven smoke flow, cross-checked by deterministic DOM assertions, recorded on video |
| `04-visual-regression.ts` | no | Pixelmatch diffs against baselines stored on the box. Run twice. **Leaves a box** holding baselines (`.box-visual-regression`) |

## Cleanup

Three examples intentionally keep a box between runs. Remove them when done:

```bash
for f in .box-workspace .box-compiled-scraper .box-visual-regression; do
  [ -f "$f" ] && node --input-type=module -e "
import { Box } from '@upstash/box';
import { readFile, unlink } from 'node:fs/promises';
const id = (await readFile('$f', 'utf8')).trim();
await (await Box.get(id)).delete(); await unlink('$f');
console.log('deleted', id);"
done
```
