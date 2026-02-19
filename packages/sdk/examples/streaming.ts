import { Box, Runtime, ClaudeCode } from "@buggyhunter/box";
import { readdir } from "node:fs/promises";
import { z } from "zod";

// Screen resumes in parallel.
// Each box gets one resume, extracts structured data, scores the candidate.
// All boxes run concurrently — N resumes in the time it takes to process one.

const candidateSchema = z.object({
  name: z.string(),
  email: z.string(),
  yearsOfExperience: z.number(),
  skills: z.array(z.string()),
  score: z.number().min(0).max(100),
  summary: z.string(),
});

const jobDescription = `Senior Backend Engineer — Node.js, PostgreSQL,
distributed systems. 5+ years experience required.`;

const files = await readdir("./resumes");
const resumes = files.filter((f) => f.endsWith(".txt"));
console.log(`Found ${resumes.length} resumes to screen.\n`);

// One box per resume, all in parallel
const results = await Promise.all(
  resumes.map(async (file) => {
    const box = await Box.create({
      apiKey: process.env.UPSTASH_BOX_API_KEY!,
      baseUrl: process.env.UPSTASH_BOX_BASE_URL,
      runtime: Runtime.Node,
      agent: {
        model: ClaudeCode.Sonnet_4_5,
        apiKey: process.env.CLAUDE_KEY!,
      },
    });

    // Upload resume to the box
    await box.files.upload([
      { path: `./resumes/${file}`, destination: file },
    ]);

    // Structured output — schema validates and types the response
    const run = await box.agent.run({
      prompt: `Here is the content of ${file}:\n\n\nExtract the candidate's info and score them 0-100 for this role: ${jobDescription}`,
      responseSchema: candidateSchema,
    });

    // run.result() is typed as { name, email, yearsOfExperience, skills, score, summary }
    const output = await run.result();
    const cost = await run.cost();
    await box.delete();

    return {
      file,
      ...output,
      tokens: cost.tokens,
    };
  }),
);

// Rank by score
const ranked = results.sort((a, b) => b.score - a.score);

console.log("Results:\n");
console.log(JSON.stringify(ranked, null, 2));
