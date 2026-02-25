import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Test workspace isolation: /workspace is root-only, /workspace/home is user workspace.
// This example verifies that users can't read/write outside /workspace/home.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
});

console.log(`Box: ${box.id}\n`);

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    if (ok) {
      console.log(`  PASS  ${name}`);
      pass++;
    } else {
      console.log(`  FAIL  ${name}`);
      fail++;
    }
  } catch (e: any) {
    console.log(`  FAIL  ${name} — ${e.message?.slice(0, 120)}`);
    fail++;
  }
}

// === 1. Relative paths should work (resolved to /workspace/home) ===
console.log("=== Allowed operations — relative paths (should succeed) ===\n");

await test("Write file with relative path", async () => {
  await box.files.write({ path: "test.txt", content: "hello world" });
  return true;
});

await test("Read file with relative path", async () => {
  const content = await box.files.read("test.txt");
  return content === "hello world";
});

await test("List files (default = workspace root)", async () => {
  const files = await box.files.list();
  return files.some((f) => f.name === "test.txt");
});

await test("Upload file with relative destination", async () => {
  await box.files.upload([
    { path: "./resumes/sarah-chen.txt", destination: "resume.txt" },
  ]);
  const content = await box.files.read("resume.txt");
  return content.length > 0;
});

await test("Shell: ls (runs in /workspace/home)", async () => {
  const run = await box.exec("ls");
  const output = run.result;
  return (await run.status()) === 0 && output.includes("test.txt");
});

await test("Shell: create subdirectory", async () => {
  const run = await box.exec("mkdir -p subdir && touch subdir/file.txt");
  return (await run.status()) === 0;
});

// === 2. /workspace root should be restricted ===
console.log("\n=== Restricted operations (should fail) ===\n");

await test("Shell: ls /workspace (can't list root)", async () => {
  const run = await box.exec("ls /workspace");
  return (await run.status()) !== 0;
});

await test("Shell: write to /workspace root", async () => {
  const run = await box.exec("touch /workspace/secret.txt");
  return (await run.status()) !== 0;
});

await test("Shell: read /workspace/.box.log", async () => {
  const run = await box.exec("cat /workspace/.box.log");
  return (await run.status()) !== 0;
});

await test("Write file to /workspace root via API", async () => {
  try {
    await box.files.write({ path: "/workspace/hack.txt", content: "should not work" });
    return false;
  } catch (e: any) {
    console.log(`    Blocked: ${e.message?.slice(0, 120)}`);
    return true;
  }
});

await test("Write file to /etc via API", async () => {
  try {
    await box.files.write({ path: "/etc/malicious.conf", content: "bad config" });
    return false;
  } catch (e: any) {
    console.log(`    Blocked: ${e.message?.slice(0, 120)}`);
    return true;
  }
});

await test("Write file to /tmp via API", async () => {
  try {
    await box.files.write({ path: "/tmp/sneaky.txt", content: "hidden file" });
    return false;
  } catch (e: any) {
    console.log(`    Blocked: ${e.message?.slice(0, 120)}`);
    return true;
  }
});

// === 3. System paths should still be readable (tools need them) ===
console.log("\n=== System paths (should remain accessible for tooling) ===\n");

await test("Shell: git --version", async () => {
  const run = await box.exec("git --version");
  const output = run.result;
  return (await run.status()) === 0 && output.includes("git version");
});

await test("Shell: node --version", async () => {
  const run = await box.exec("node --version");
  return (await run.status()) === 0;
});

await test("Shell: read /etc/ssl/certs (TLS works)", async () => {
  const run = await box.exec("ls /etc/ssl/certs | head -3");
  const output = run.result;
  return (await run.status()) === 0 && output.length > 0;
});

await test("Shell: DNS resolution works", async () => {
  const run = await box.exec("cat /etc/resolv.conf");
  const output = run.result;
  return (await run.status()) === 0 && output.includes("nameserver");
});

// === Summary ===
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`);
console.log(`${"=".repeat(40)}\n`);

// await box.delete();
console.log("Box deleted.");

process.exit(fail > 0 ? 1 : 0);
