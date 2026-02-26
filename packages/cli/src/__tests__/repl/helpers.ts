import type { BoxREPLEvent } from "../../repl/types.js";

export async function collectEvents(gen: AsyncGenerator<BoxREPLEvent>): Promise<BoxREPLEvent[]> {
  const events: BoxREPLEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}
