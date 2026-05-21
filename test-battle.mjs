// Battle test: exercise every MCP tool with real on-chain data.
//
// Usage: GOAT_NETWORK=mainnet|testnet3 node test-battle.mjs
//        GOAT_RPC_URL=http://127.0.0.1:8545 node test-battle.mjs  (localnet)
//
// Spins up the MCP over stdio, initializes, lists tools, then runs each
// with bootstrapped real inputs (latest block → first tx → its from-address).

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const label =
  process.env.GOAT_RPC_URL
    ? `localnet (${process.env.GOAT_RPC_URL})`
    : `${process.env.GOAT_NETWORK ?? "mainnet"}`;

const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: here,
  env: { ...process.env },
});

let stderr = "";
child.stderr.on("data", (d) => { stderr += d.toString(); });

let buf = "";
const pending = new Map();
let nextId = 100;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 15000);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function callTool(name, args) {
  const msg = await request("tools/call", { name, arguments: args });
  if (msg.error) return { ok: false, error: msg.error.message };
  if (msg.result?.isError) {
    return { ok: false, error: msg.result.content?.[0]?.text ?? "isError" };
  }
  return { ok: true, text: msg.result?.content?.[0]?.text ?? "" };
}

// --- bootstrap ---
await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "battle", version: "0.0.0" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await sleep(100);

const list = await request("tools/list", {});
const toolNames = list.result.tools.map((t) => t.name);
console.log(`\n=== Battle test: ${label} ===`);
console.log(`Server stderr: ${stderr.trim()}`);
console.log(`Tools registered: ${toolNames.length}`);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`  [${tag.padEnd(4)}] ${name.padEnd(26)} ${detail ?? ""}`);
}

// 1. get_chain_info — also bootstraps chainId / latest block
const chainInfoRes = await callTool("get_chain_info", {});
if (!chainInfoRes.ok) {
  record("get_chain_info", false, chainInfoRes.error);
  console.log("\nFATAL: chain_info failed, cannot bootstrap further tests");
  child.kill();
  process.exit(1);
}
const chainInfo = JSON.parse(chainInfoRes.text);
record("get_chain_info", true,
  `chainId=${chainInfo.chainId} block=${chainInfo.latestBlock} ${chainInfo.nativeSymbol}`);

const latestBlockNum = chainInfo.latestBlock;

// 2. get_block — latest with full txs to bootstrap a tx hash + an address
const blockRes = await callTool("get_block", { block: "latest", fullTransactions: true });
let blockObj = null, sampleTxHash = null, sampleFromAddr = null, sampleBlockHash = null;
if (blockRes.ok) {
  blockObj = JSON.parse(blockRes.text);
  sampleBlockHash = blockObj?.hash ?? null;
  if (Array.isArray(blockObj?.transactions) && blockObj.transactions.length > 0) {
    sampleTxHash = blockObj.transactions[0].hash;
    sampleFromAddr = blockObj.transactions[0].from;
  }
  record("get_block", true,
    `block ${parseInt(blockObj.number, 16)} hash=${blockObj.hash?.slice(0, 10)}… txs=${blockObj.transactions?.length ?? 0}`);
} else {
  record("get_block", false, blockRes.error);
}

// If latest has no txs, scan back up to 50 blocks for one (typical on testnets / empty localnet)
if (!sampleTxHash && latestBlockNum > 0) {
  const scanFrom = latestBlockNum;
  const scanTo = Math.max(0, latestBlockNum - 50);
  for (let n = scanFrom; n >= scanTo; n--) {
    const r = await callTool("get_block", { block: n, fullTransactions: true });
    if (!r.ok) break;
    const b = JSON.parse(r.text);
    if (Array.isArray(b?.transactions) && b.transactions.length > 0) {
      sampleTxHash = b.transactions[0].hash;
      sampleFromAddr = b.transactions[0].from;
      sampleBlockHash = b.hash;
      console.log(`     ↪ bootstrapped tx ${sampleTxHash?.slice(0, 12)}… from block ${n}`);
      break;
    }
  }
}

// Fallback address for tools that need *some* valid address (used if chain has no txs at all).
// vitalik.eth — well-formed checksum address, valid on any EVM chain.
const fallbackAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const addrForTests = sampleFromAddr ?? fallbackAddr;

// 3. get_block_by_hash
if (sampleBlockHash) {
  const r = await callTool("get_block_by_hash", { hash: sampleBlockHash, fullTransactions: false });
  record("get_block_by_hash", r.ok, r.ok ? "ok" : r.error);
} else {
  record("get_block_by_hash", "skip", "no block hash available");
}

// 4. get_gas_price
{
  const r = await callTool("get_gas_price", {});
  record("get_gas_price", r.ok, r.ok ? r.text.split("\n")[0] : r.error);
}

// 5. get_fee_history
{
  const r = await callTool("get_fee_history", { blockCount: 4 });
  record("get_fee_history", r.ok, r.ok ? "ok" : r.error);
}

// 6. get_balance
{
  const r = await callTool("get_balance", { address: addrForTests });
  record("get_balance", r.ok, r.ok ? `${addrForTests.slice(0, 10)}… ${r.text.split(" (")[0]}` : r.error);
}

// 7. get_transaction_count
{
  const r = await callTool("get_transaction_count", { address: addrForTests });
  record("get_transaction_count", r.ok, r.ok ? `nonce ${r.text.split(" ")[0]}` : r.error);
}

// 8. get_code
{
  const r = await callTool("get_code", { address: addrForTests });
  record("get_code", r.ok, r.ok ? r.text.slice(0, 50).replace(/\n/g, " ") : r.error);
}

// 9. get_storage_at
{
  const r = await callTool("get_storage_at", { address: addrForTests, slot: 0 });
  record("get_storage_at", r.ok, r.ok ? r.text : r.error);
}

// 10. get_transaction
if (sampleTxHash) {
  const r = await callTool("get_transaction", { hash: sampleTxHash });
  record("get_transaction", r.ok, r.ok ? `tx ${sampleTxHash.slice(0, 12)}…` : r.error);
} else {
  record("get_transaction", "skip", "no tx found in recent blocks");
}

// 11. get_transaction_receipt
if (sampleTxHash) {
  const r = await callTool("get_transaction_receipt", { hash: sampleTxHash });
  record("get_transaction_receipt", r.ok, r.ok ? "ok" : r.error);
} else {
  record("get_transaction_receipt", "skip", "no tx found in recent blocks");
}

// 12. send_raw_transaction — write side, requires signed tx. Verify it gracefully
//     rejects a bogus payload (server should surface RPC error, not crash).
{
  const r = await callTool("send_raw_transaction", {
    signedTx: "0xdeadbeef",
  });
  // Expected: fail (RPC rejects invalid tx). PASS means error was caught and returned cleanly.
  record("send_raw_transaction", !r.ok,
    !r.ok ? "rejected bogus tx cleanly (expected)" : "UNEXPECTED accept of 0xdeadbeef");
}

// 13. eth_call — call a no-op (empty data) to a known address; result is "0x"
{
  const r = await callTool("eth_call", { call: { to: addrForTests, data: "0x" } });
  record("eth_call", r.ok, r.ok ? `returned ${r.text}` : r.error);
}

// 14. estimate_gas — simple transfer call
{
  const r = await callTool("estimate_gas", {
    call: { to: addrForTests, value: "0x0" },
  });
  // estimate_gas may fail on some chains for synthetic calls — accept either
  // a successful gas number or a clean error message.
  if (r.ok) {
    record("estimate_gas", true, r.text.split("\n")[0]);
  } else {
    record("estimate_gas", "skip", `RPC rejected synthetic call (${r.error.slice(0, 60)})`);
  }
}

// 15. get_logs — small recent window
{
  const from = Math.max(0, latestBlockNum - 5);
  const r = await callTool("get_logs", {
    fromBlock: from,
    toBlock: latestBlockNum,
  });
  if (r.ok) {
    let n;
    try { n = JSON.parse(r.text).length; } catch { n = "?"; }
    record("get_logs", true, `${n} logs in blocks ${from}-${latestBlockNum}`);
  } else {
    record("get_logs", false, r.error);
  }
}

// 16. explorer_link — pure formatting
{
  const r = await callTool("explorer_link", { kind: "address", value: addrForTests });
  const expected = `${chainInfo.explorerUrl}/address/${addrForTests}`;
  record("explorer_link", r.ok && r.text === expected, r.ok ? r.text : r.error);
}

// ---- Build/write tools (v0.2.0) ----

// 17. encode_function_data — encode ERC-20 transfer
{
  const r = await callTool("encode_function_data", {
    abi: "function transfer(address to, uint256 amount) returns (bool)",
    functionName: "transfer",
    args: [addrForTests, "1000000"],
  });
  const expectedSelector = "0xa9059cbb";
  const ok = r.ok && typeof r.text === "string" && r.text.startsWith(expectedSelector);
  record("encode_function_data", ok, r.ok ? `${r.text.slice(0, 10)}… len=${r.text.length}` : r.error);
}

// 18. decode_function_data — round-trip the encoding above
{
  const calldata =
    "0xa9059cbb000000000000000000000000" +
    addrForTests.slice(2).toLowerCase() +
    "00000000000000000000000000000000000000000000000000000000000f4240";
  const r = await callTool("decode_function_data", {
    abi: "function transfer(address to, uint256 amount) returns (bool)",
    data: calldata,
  });
  let ok = false;
  if (r.ok) {
    try {
      const d = JSON.parse(r.text);
      ok = d.functionName === "transfer" && d.args?.[1] === "1000000";
    } catch {}
  }
  record("decode_function_data", ok, r.ok ? `${r.text.split("\n")[1]?.trim()}` : r.error);
}

// 19. decode_event_log — ERC-20 Transfer
{
  const topics = [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // keccak("Transfer(address,address,uint256)")
    "0x000000000000000000000000" + addrForTests.slice(2).toLowerCase(),
    "0x000000000000000000000000" + addrForTests.slice(2).toLowerCase(),
  ];
  const data = "0x00000000000000000000000000000000000000000000000000000000000003e8";
  const r = await callTool("decode_event_log", {
    abi: "event Transfer(address indexed from, address indexed to, uint256 value)",
    topics,
    data,
  });
  let ok = false;
  if (r.ok) {
    try {
      const d = JSON.parse(r.text);
      ok = d.eventName === "Transfer" && d.args?.value === "1000";
    } catch {}
  }
  record("decode_event_log", ok, r.ok ? `${r.text.split("\n")[1]?.trim()}` : r.error);
}

// 20. simulate_transaction — read-only call returns success
{
  const r = await callTool("simulate_transaction", {
    to: addrForTests,
    data: "0x",
  });
  let ok = false;
  if (r.ok) {
    try {
      ok = JSON.parse(r.text).success === true;
    } catch {}
  }
  record("simulate_transaction", ok, r.ok ? r.text.split("\n")[1]?.trim() : r.error);
}

// 21. build_transaction — build a self-send tx
{
  const r = await callTool("build_transaction", {
    from: addrForTests,
    to: addrForTests,
    value: "0x0",
  });
  let ok = false, details = r.error;
  if (r.ok) {
    try {
      const tx = JSON.parse(r.text);
      ok = tx.type === "0x2" &&
           tx.chainId === chainInfo.chainIdHex &&
           !!tx.nonce && !!tx.gas && !!tx.maxFeePerGas;
      details = `nonce=${tx.nonce} gas=${tx.gas} maxFee=${tx.maxFeePerGas}`;
    } catch (e) { details = `parse: ${e.message}`; }
  }
  record("build_transaction", ok, details);
}

// 22. build_erc20_transfer — build a transfer tx against a contract address.
// Use addrForTests as both sender and "token" — the RPC will likely revert on
// estimate_gas since it's an EOA, but we still test that the encoding path
// produces the right selector and shape.
{
  const r = await callTool("build_erc20_transfer", {
    token: addrForTests,
    from: addrForTests,
    to: addrForTests,
    amount: "1",
    decimals: 18,
  });
  let ok = false, details = r.error;
  if (r.ok) {
    try {
      const tx = JSON.parse(r.text);
      ok = tx.type === "0x2" && tx.data?.startsWith("0xa9059cbb") && tx.to === addrForTests;
      details = `data=${tx.data?.slice(0, 10)}… ${tx.humanReadable}`;
    } catch (e) { details = `parse: ${e.message}`; }
  } else if (r.error?.includes("revert") || r.error?.includes("estimate")) {
    // estimate_gas legitimately fails against an EOA — that's OK for this synthetic
    record("build_erc20_transfer", "skip", `RPC rejected estimate against EOA (${r.error.slice(0, 50)})`);
  }
  if (results[results.length - 1]?.name !== "build_erc20_transfer") {
    record("build_erc20_transfer", ok, details);
  }
}

// 23. build_erc20_approve — "max" amount path
{
  const r = await callTool("build_erc20_approve", {
    token: addrForTests,
    from: addrForTests,
    spender: addrForTests,
    amount: "max",
  });
  let ok = false, details = r.error;
  if (r.ok) {
    try {
      const tx = JSON.parse(r.text);
      ok = tx.type === "0x2" && tx.data?.startsWith("0x095ea7b3");
      details = `data=${tx.data?.slice(0, 10)}… ${tx.humanReadable}`;
    } catch (e) { details = `parse: ${e.message}`; }
  } else if (r.error?.includes("revert") || r.error?.includes("estimate")) {
    record("build_erc20_approve", "skip", `RPC rejected estimate against EOA (${r.error.slice(0, 50)})`);
  }
  if (results[results.length - 1]?.name !== "build_erc20_approve") {
    record("build_erc20_approve", ok, details);
  }
}

// 24. build_contract_write — same pattern
{
  const r = await callTool("build_contract_write", {
    from: addrForTests,
    to: addrForTests,
    abi: "function approve(address spender, uint256 amount) returns (bool)",
    functionName: "approve",
    args: [addrForTests, "1000000000000000000"],
  });
  let ok = false, details = r.error;
  if (r.ok) {
    try {
      const tx = JSON.parse(r.text);
      ok = tx.type === "0x2" && tx.data?.startsWith("0x095ea7b3");
      details = `data=${tx.data?.slice(0, 10)}… ${tx.humanReadable}`;
    } catch (e) { details = `parse: ${e.message}`; }
  } else if (r.error?.includes("revert") || r.error?.includes("estimate")) {
    record("build_contract_write", "skip", `RPC rejected estimate against EOA (${r.error.slice(0, 50)})`);
  }
  if (results[results.length - 1]?.name !== "build_contract_write") {
    record("build_contract_write", ok, details);
  }
}

// --- summary ---
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
const skip = results.filter((r) => r.ok === "skip").length;
console.log(`\n  ${pass} pass · ${fail} fail · ${skip} skip · ${results.length} total`);

child.kill();
process.exit(fail === 0 ? 0 : 1);
