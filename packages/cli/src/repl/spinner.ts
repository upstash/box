import { stdout } from "node:process";
import { cyan, dim, eraseLine } from "../utils/ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const MESSAGES = [
  "Thinking",
  "Cooking",
  "Checking",
  "Working",
  "Processing",
  "Crunching",
  "Computing",
  "Brewing",
  "Wiring",
  "Loading",
];

function randomMessage(): string {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)]!;
}

/**
 * Start a terminal spinner. Returns a stop() function.
 */
export function startSpinner(): () => void {
  const message = randomMessage();
  let frame = 0;
  let stopped = false;

  const timer = setInterval(() => {
    const f = FRAMES[frame % FRAMES.length]!;
    stdout.write(`\r${eraseLine}${cyan(f)} ${dim(message)}...`);
    frame++;
  }, 80);

  return function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stdout.write(`\r${eraseLine}`);
  };
}
