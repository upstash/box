/**
 * GUI / desktop example: create a GUI box, start the desktop with a browser,
 * drive it with primitives + batch actions, then (optionally) AI act.
 *
 * Run:
 *   UPSTASH_BOX_API_KEY=... UPSTASH_BOX_BASE_URL=... tsx examples/desktop.ts
 */
import { Box } from "../src/index.js";
import { writeFileSync } from "node:fs";

async function main() {
  console.log("Creating GUI box...");
  const box = await Box.create({ runtime: "node", desktop: true, debug: false });
  console.log(`Box created: ${box.id}`);

  try {
    // 1. Boot the desktop (no viewer URL yet) and open a page in the browser
    const desktop = await box.desktop.start({ open: "https://example.com" });
    console.log("desktop:", {
      running: desktop.running,
      size: `${desktop.width}x${desktop.height}`,
    });

    // 2. Expose a viewable stream when you want to watch it (this is where auth lives)
    const stream = await box.desktop.stream({ auth: "basic" });
    console.log("watch it live:", {
      url: stream.url,
      username: stream.username,
      password: stream.password,
    });

    // 3. Status + screen info
    console.log("status:", await box.desktop.status());
    // Give XFCE + Chromium a moment to render
    await new Promise((r) => setTimeout(r, 12000));
    const screen = await box.desktop.screen();
    console.log("screen:", screen);

    // 4. Screenshot (raw bytes)
    const png = (await box.desktop.screenshot()) as Uint8Array;
    writeFileSync("/tmp/desktop-example-1.png", png);
    console.log(`screenshot: ${png.length} bytes -> /tmp/desktop-example-1.png`);

    // 5. Primitives
    await box.desktop.moveMouse(Math.floor(screen.width / 2), Math.floor(screen.height / 2));
    await box.desktop.leftClick(Math.floor(screen.width / 2), Math.floor(screen.height / 2));
    await box.desktop.scroll("down", 3);
    await box.desktop.press(["ctrl", "l"]); // focus the address bar
    await box.desktop.type("https://news.ycombinator.com");
    await box.desktop.press("enter");
    console.log("primitives ok");

    // 6. Batch computer-use actions
    await new Promise((r) => setTimeout(r, 6000));
    const results = await box.desktop.actions([
      { type: "mouse_move", coordinate: [200, 200] },
      { type: "cursor_position" },
      { type: "wait", duration: 300 },
      { type: "screenshot" },
    ]);
    console.log(
      "batch results:",
      results.map((r) => ({ ok: r.ok, hasData: Boolean(r.data) })),
    );
    const last = results[results.length - 1];
    if (typeof last.data === "string") {
      writeFileSync("/tmp/desktop-example-2.png", Buffer.from(last.data, "base64"));
      console.log("batch screenshot -> /tmp/desktop-example-2.png");
    }

    // 7. AI act (needs an Anthropic key on the box/account; skip gracefully)
    if (process.env.GUI_ACT === "1") {
      const act = await box.desktop.agent.act("Click on the first story title on the page");
      console.log("act:", {
        actions: act.actions,
        reasoning: act.reasoning,
        tokens: [act.inputTokens, act.outputTokens],
      });
    }

    await box.desktop.stop();
    console.log("GUI stopped");
  } finally {
    await box.delete();
    console.log("Box deleted");
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
