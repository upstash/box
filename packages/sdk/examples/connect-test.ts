import { Box } from "../src/index.js";
const box = await Box.create({ runtime: "node", browser: true });
console.log("box:", box.id);
try {
  const conn = await box.browser.connect();
  console.log("host:", conn.host);
  const authHeader = "Basic " + Buffer.from("cdp:" + conn.token).toString("base64");
  // Playwright's first call: GET {host}/json/version
  const res = await fetch(conn.host + "/json/version", { headers: { Authorization: authHeader } });
  console.log("GET /json/version ->", res.status);
  const info: any = await res.json();
  console.log("Browser:", info.Browser);
  console.log("wsDebuggerUrl:", info.webSocketDebuggerUrl);
  // /json/list (the tabs)
  const res2 = await fetch(conn.host + "/json/list", { headers: { Authorization: authHeader } });
  const tabs: any = await res2.json();
  console.log("tabs:", tabs.length, tabs[0]?.type);
} catch (e: any) {
  console.error("FAILED:", e.statusCode ?? "", e.message);
} finally {
  await box.delete();
}
