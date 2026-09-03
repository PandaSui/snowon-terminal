import WebSocket from "../apps/chat/node_modules/ws/wrapper.mjs";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9336;
const TOKEN = "0x4c67b87b83437c698a8a3a3777f20d81c58d8888";
const child = execFile(EDGE, ["--headless", "--disable-gpu", `--remote-debugging-port=${PORT}`, "about:blank"], () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

async function getWsUrl() {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
      const j = await r.json();
      return j.webSocketDebuggerUrl;
    } catch {
      await sleep(800);
    }
  }
  throw new Error("no CDP");
}

const ws = new WebSocket(await getWsUrl());
let id = 0;
const pending = new Map();
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
});
await new Promise((r) => ws.on("open", r));

async function shot(path, { width, height, mobile, url, after } = {}) {
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile,
  });
  await send("Page.navigate", { url });
  await sleep(12000);
  if (after === "holders") {
    const loc = await send("Runtime.evaluate", {
      expression: `(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('持有者'));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: b.textContent };
      })()`,
      returnByValue: true,
    });
    const p = loc?.result?.value;
    console.log("holders tab", p);
    if (p) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    }
    await sleep(4000);
  } else if (after) {
    await send("Runtime.evaluate", { expression: after, returnByValue: true });
    await sleep(4500);
  }
  const cap = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  if (!cap?.data) throw new Error(`shot failed ${path}: ${JSON.stringify(cap).slice(0, 180)}`);
  writeFileSync(path, Buffer.from(cap.data, "base64"));
  console.log("saved", path);
}

await shot("E:/VS开发文件集合/NEW/snowon-terminal/token-page-desktop.png", {
  width: 1600, height: 900,
  url: `http://localhost:3000/token/${TOKEN}`,
});
await shot("E:/VS开发文件集合/NEW/snowon-terminal/token-page-mobile.png", {
  width: 420, height: 880, mobile: true,
  url: `http://localhost:3000/token/${TOKEN}`,
});

ws.close();
child.kill();
process.exit(0);
