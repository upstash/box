import { Box } from "@buggyhunter/box";

const boxes = await Box.list({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
});

const active = boxes.filter((b) => b.status !== "closed");
console.log(`Found ${active.length} active box(es)`);

for (const box of active) {
  console.log(`Deleting ${box.id} (status: ${box.status})`);
  const response = await fetch(
    `${(process.env.UPSTASH_BOX_BASE_URL ?? "https://api.upstash.com").replace(/\/$/, "")}/v2/box/${box.id}`,
    {
      method: "DELETE",
      headers: { "X-Box-Api-Key": process.env.UPSTASH_BOX_API_KEY! },
    },
  );
  if (!response.ok) {
    console.error(`  Failed to delete ${box.id}: ${response.status}`);
  } else {
    console.log(`  Deleted ${box.id}`);
  }
}

console.log("Done");
