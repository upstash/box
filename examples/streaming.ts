import { Box, Runtime, ClaudeCode } from "../src/index.js";
import { readdir } from "node:fs/promises";
import { z } from "zod";

// Screen 50 resumes in parallel.
// Each box gets one resume, extracts structured data, scores the candidate.
// All boxes run concurrently — 50 resumes in the time it takes to process one.

const candidateSchema = z.object({
  name: z.string(),
  email: z.string(),
  yearsOfExperience: z.number(),
  skills: z.array(z.string()),
  score: z.number().min(0).max(100),
  summary: z.string(),
});

type Candidate = z.infer<typeof candidateSchema>;

const jobDescription = `Senior Backend Engineer — Node.js, PostgreSQL,
distributed systems. 5+ years experience required.`;

const files = await readdir("./resumes");
const resumes = files.filter((f) => f.endsWith(".pdf"));

// One box per resume, all in parallel
const results = await Promise.all(
  resumes.map(async (file) => {
    const box = await Box.create({
      apiKey: process.env.UPSTASH_BOX_API_KEY!,
      baseUrl: process.env.UPSTASH_BOX_BASE_URL,
      runtime: Runtime.Node,
      agent: {
        model: ClaudeCode.Opus_4_5,
        apiKey: process.env.CLAUDE_KEY!,
      },
    });

    await box.uploadFiles([
      { path: `./resumes/${file}`, mountPath: "/work/resume.pdf" },
    ]);

    const run = await box.run({
      prompt: `Read /work/resume.pdf. Extract the candidate's info and score them
0-100 for this role: ${jobDescription}

Respond with ONLY a JSON object matching this schema:
{ name, email, yearsOfExperience, skills, score, summary }`,
      responseSchema: candidateSchema,
    });

    const candidate = await run.result<Candidate>();
    const cost = await run.cost();
    await box.delete();

    return { file, ...candidate, cost: cost.totalUsd };
  }),
);

// Rank by score
const ranked = results.sort((a, b) => b.score - a.score);

console.log("\nTop candidates:");
for (const c of ranked.slice(0, 10)) {
  console.log(
    `  ${c.score}/100 — ${c.name} (${c.yearsOfExperience}yr) $${c.cost.toFixed(2)}`,
  );
}

const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
console.log(`\nScreened ${results.length} resumes — $${totalCost.toFixed(2)} total`);
