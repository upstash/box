import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Box } from "../../index.js";

// Exercises the actual SDK HTTP transport against a local API fixture.
// Does not load .env or create remote boxes.
const requests: Record<string, unknown>[] = [];
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET") {
    res.end(JSON.stringify({ id: "local-box", status: "idle", browser: true }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  if (body.instruction?.includes("unsupported")) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Unsupported Jev browser operation" }));
    return;
  }
  res.end(
    JSON.stringify({
      success: true,
      message: "done",
      actions: [
        { selector: "#email", method: "fill", description: "Email", arguments: ["%email%"] },
      ],
      input_tokens: body.action ? 0 : 100,
      output_tokens: body.action ? 0 : 5,
    }),
  );
});
let box: Box;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  box = await Box.get("local-box", {
    apiKey: "local-test-key",
    baseUrl: `http://127.0.0.1:${port}`,
  });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("sends model and variables over HTTP, then replays without a model", async () => {
  const tab = box.browser.getTab("tab-1");
  const result = await tab.act("Fill Email with %email%", {
    model: "vercel/typesafe-ai/jev",
    variables: { email: "test@example.com" },
    scope: "form",
    timeout: 10000,
    confidenceThreshold: 0.7,
  });
  expect(result.success).toBe(true);
  expect(result.inputTokens).toBe(100);
  await tab.act(result.actions[0], { variables: { email: "other@example.com" } });
  expect(requests[0]).toMatchObject({
    model: "vercel/typesafe-ai/jev",
    scope: "form",
    timeout: 10000,
    confidence_threshold: 0.7,
  });
  expect(requests[1]).toMatchObject({
    action: { arguments: ["%email%"] },
    variables: { email: "other@example.com" },
  });
  expect(requests[1]).not.toHaveProperty("model");
});

it("surfaces an unsupported-operation response without retrying", async () => {
  const before = requests.length;
  await expect(
    box.browser.getTab("tab-1").act("unsupported operation", { model: "vercel/typesafe-ai/jev" }),
  ).rejects.toThrow("Unsupported Jev");
  expect(requests).toHaveLength(before + 1);
});
