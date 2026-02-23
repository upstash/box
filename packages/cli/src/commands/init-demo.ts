import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import readline from "node:readline";
import { resolveToken } from "../auth.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;

interface InitDemoFlags {
  token?: string;
  agentModel?: string;
  agentApiKey?: string;
  runtime?: string;
  gitToken?: string;
  directory?: string;
}

function generateEnvFile(flags: InitDemoFlags, token: string): string {
  const lines = [
    `UPSTASH_BOX_API_KEY=${token}`,
    `AGENT_MODEL=${flags.agentModel ?? ""}`,
    `AGENT_API_KEY=${flags.agentApiKey ?? ""}`,
    `RUNTIME=${flags.runtime ?? "node"}`,
    `GIT_TOKEN=${flags.gitToken ?? ""}`,
  ];
  return lines.join("\n") + "\n";
}

function generateMainTs(dir: string): string {
  return `import "dotenv/config";
import { Box } from "@upstash/box";

async function main() {
  const config: Parameters<typeof Box.create>[0] = {
    apiKey: process.env.UPSTASH_BOX_API_KEY!,
  };

  if (process.env.RUNTIME) {
    config.runtime = process.env.RUNTIME;
  }

  if (process.env.AGENT_MODEL && process.env.AGENT_API_KEY) {
    config.agent = {
      model: process.env.AGENT_MODEL,
      apiKey: process.env.AGENT_API_KEY,
    };
  }

  if (process.env.GIT_TOKEN) {
    config.git = { token: process.env.GIT_TOKEN };
  }

  console.log("Creating box...");
  const box = await Box.create(config);
  console.log(\`Box created: \${box.id}\`);

  try {
    // Write a file
    console.log("\\nWriting hello.txt...");
    await box.files.write({ path: "hello.txt", content: "Hello from Upstash Box!" });
    console.log("File written.");

    // Read it back
    console.log("\\nReading hello.txt...");
    const content = await box.files.read("hello.txt");
    console.log(\`Content: \${content}\`);

    // Execute a command
    console.log("\\nRunning: ls -la");
    const run = await box.exec("ls -la");
    const output = await run.result();
    console.log(output);

    // List files
    console.log("Listing files...");
    const files = await box.files.list(".");
    console.log(files.map((f: { name: string }) => f.name).join("  "));

    // Agent demo (if configured)
    if (process.env.AGENT_MODEL && process.env.AGENT_API_KEY) {
      console.log("\\nRunning agent prompt...");
      const stream = box.agent.stream({
        prompt: "Create a file called demo.js that prints 'Hello World'",
      });
      for await (const chunk of stream) {
        process.stdout.write(chunk);
      }
      console.log();
    }

    // Git demo (if configured)
    if (process.env.GIT_TOKEN) {
      console.log("\\nGit status:");
      const gitRun = await box.exec("git status");
      const gitOutput = await gitRun.result();
      console.log(gitOutput);
    }
  } finally {
    // Pause so you can check logs on the Upstash console
    console.log("\\nPausing box...");
    await box.pause();
    console.log(\`Box \${box.id} paused. You can check your logs on the Upstash console.\`);
    console.log(\`\\n\\x1b[2mTo reconnect to this box:\\x1b[22m\\n\\n  \\x1b[36mcd ${dir} && npx @upstash/box-cli connect \${box.id}\\x1b[39m\\n\`);
  }
}

main().catch(console.error);
`;
}

function generateReadme(dir: string): string {
  return `# Box Demo

A standalone demo project for the [@upstash/box](https://www.npmjs.com/package/@upstash/box) SDK.

## Environment Variables

Configure these in the \`.env\` file:

| Variable               | Description                                      | Required |
| ---------------------- | ------------------------------------------------ | -------- |
| \`UPSTASH_BOX_API_KEY\`  | Your Upstash Box API token                       | Yes      |
| \`AGENT_MODEL\`          | Agent model identifier (e.g. \`claude/sonnet_4_5\`)  | No       |
| \`AGENT_API_KEY\`        | API key for the agent model                      | No       |
| \`RUNTIME\`              | Runtime environment (default: \`node\`)             | No       |
| \`GIT_TOKEN\`            | GitHub personal access token                     | No       |

## What the demo does

1. Creates a new box
2. Writes a file and reads it back
3. Executes a shell command (\`ls -la\`)
4. Lists files in the box
5. (If agent configured) Runs an agent prompt with streaming
6. (If git configured) Shows git status
7. Pauses the box so you can check logs on the Upstash console

## Running

\`\`\`bash
cd ${dir}
npx tsx main.ts
\`\`\`
`;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function initDemoCommand(flags: InitDemoFlags): Promise<void> {
  const token = resolveToken(flags.token);

  if (flags.agentModel && !flags.agentApiKey) {
    console.error(
      red("Error: --agent-api-key is required if --agent-model is set"),
    );
    process.exit(1);
  }

  const dir = flags.directory ?? "box-demo";
  const absDir = path.resolve(dir);

  if (fs.existsSync(absDir)) {
    console.error(red(`Error: Directory "${dir}" already exists.`));
    process.exit(1);
  }

  // Confirmation prompt
  console.log(`\nThis command will:\n`);
  console.log(`  ${cyan("1.")} Create a directory ${bold(cyan(dir))}`);
  console.log(`  ${cyan("2.")} Install ${bold("@upstash/box")} and dependencies`);
  console.log(`  ${cyan("3.")} Prepare an example script to showcase Upstash Box\n`);
  const confirm = await askQuestion(`Proceed? ${dim("(Y/n)")} `);
  if (confirm !== "" && confirm !== "y" && confirm !== "yes") {
    console.log(dim("Aborted."));
    return;
  }

  fs.mkdirSync(absDir, { recursive: true });

  console.log(`\nInitializing demo project in ${cyan(dir)}/...`);

  execSync('npm init -y && npm pkg set type="module"', {
    cwd: absDir,
    stdio: "ignore",
  });
  console.log(`Installing dependencies...`);
  execSync("npm install @upstash/box dotenv", { cwd: absDir, stdio: "ignore" });
  execSync("npm install --save-dev @types/node", {
    cwd: absDir,
    stdio: "ignore",
  });

  fs.writeFileSync(path.join(absDir, ".env"), generateEnvFile(flags, token));
  fs.writeFileSync(path.join(absDir, "main.ts"), generateMainTs(dir));
  fs.writeFileSync(path.join(absDir, "README.md"), generateReadme(dir));

  console.log(`\n${green("Demo project created in")} ${bold(cyan(dir))}/`);
  console.log(`  ${cyan(".env")}       ${dim("—")} environment variables`);
  console.log(`  ${cyan("main.ts")}    ${dim("—")} demo script`);
  console.log(`  ${cyan("README.md")}  ${dim("—")} documentation\n`);
  console.log(
    `See ${cyan("README.md")} for details on configuration and usage.\n`,
  );

  const answer = await askQuestion(
    `Run the demo now? ${dim("(Y/n)")} `,
  );

  if (answer === "" || answer === "y" || answer === "yes") {
    console.log(yellow("\nRunning demo...\n"));
    execSync("npx tsx main.ts", { cwd: absDir, stdio: "inherit" });
  } else {
    console.log(
      `\nTo run later:\n  ${cyan(`cd ${dir} && npx tsx main.ts`)}`,
    );
  }
}

export { generateEnvFile, generateMainTs, generateReadme };
export type { InitDemoFlags };
