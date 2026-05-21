// Smoke test: spawn the MCP, initialize, call get_chain_info, exit.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: here,
});

let buf = "";
const responses = [];
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  },
});

await sleep(500);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
await sleep(200);

send({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
});
await sleep(500);

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_chain_info", arguments: {} },
});
await sleep(1500);

child.kill();

const init = responses.find((r) => r.id === 1);
const list = responses.find((r) => r.id === 2);
const call = responses.find((r) => r.id === 3);

console.log("=== initialize ===");
console.log(init?.result?.serverInfo);
console.log("=== tools/list count ===");
console.log(list?.result?.tools?.length, "tools");
console.log(list?.result?.tools?.map((t) => t.name).join(", "));
console.log("=== get_chain_info ===");
console.log(call?.result?.content?.[0]?.text);

if (!call?.result || call.result.isError) {
  console.error("FAIL: get_chain_info returned error or nothing");
  process.exit(1);
}
console.log("\nOK");
