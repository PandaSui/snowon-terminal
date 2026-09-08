import WebSocket from "../apps/chat/node_modules/ws/wrapper.mjs";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9335;
const child = execFile(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, "about:blank"], () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

async function getWsUrl() {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      const j = await r.json();
      return j.webSocketDebuggerUrl;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("no CDP");
}

const ws = new WebSocket(await getWsUrl());
let id = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") {
    logs.push("EXC " + (m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || JSON.stringify(m.params).slice(0, 500)));
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params?.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ");
    logs.push(`${m.params?.type} ${args}`.slice(0, 500));
  }
});
await new Promise((r) => ws.on("open", r));
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Page.navigate", { url: "http://127.0.0.1:3000/" });
await sleep(8000);
const title = await send("Runtime.evaluate", { expression: "document.title + ' | ' + document.body.innerText.slice(0, 800)", returnByValue: true });
logs.push("BODY " + JSON.stringify(title?.result?.value ?? title).slice(0, 900));
const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot?.data) {
  writeFileSync("E:/VS开发文件集合/NEW/snowon-terminal/tools/tmp-error.png", Buffer.from(shot.data, "base64"));
  logs.push("SHOT saved");
}
console.log(logs.join("\n"));
ws.close();
child.kill();
process.exit(0);
