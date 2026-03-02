import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../../.env") });

export const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;
