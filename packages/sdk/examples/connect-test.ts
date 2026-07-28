import { Box } from "../src/index.js";
const box = await Box.create({ runtime: "node", browser: true });
console.log("box:", box.id);
try {
  const cdpUrl = await box.browser.cdpUrl();
  console.log("cdp url:", cdpUrl);
} catch (e: any) {
  console.error("FAILED:", e.statusCode ?? "", e.message);
} finally {
  await box.delete();
}
