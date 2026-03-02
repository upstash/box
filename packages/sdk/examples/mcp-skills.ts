import { Box, Runtime, ClaudeCode } from "@upstash/box";

// Create a box with MCP servers and Context7 skills.

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: Runtime.Node,
  agent: {
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY!,
  },
  // Context7 skills — give the agent domain expertise
  skills: ["anthropics/skills/frontend-design"],
  // MCP servers — give the agent external tool access
  mcpServers: [
    {
      name: "web-search",
      package: "@anthropic/mcp-web-search",
    },
    {
      name: "file-system",
      url: "https://mcp.context7.com/mcp",
      headers: { Authorization: `Bearer ${process.env.CONTEXT7_KEY!}` },
    }
  ],
});

console.log(`Box: ${box.id}\n`);

for await (const chunk of box.agent.stream({
  prompt: `Create a landing page at landing/index.html for a developer tool
called "ShipFast". It should have:
- A hero section with a headline and CTA button
- A features grid (3 features)
- A pricing section (free / pro / enterprise)
- A footer

Use modern CSS, no frameworks. Make it look professional.`,
})) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
}

// Download the generated landing page
await box.files.download({ path: "landing" });
console.log("\nDownloaded landing/");

await box.delete();
