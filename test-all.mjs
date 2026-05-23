import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000001";
const LOCKING = "0x0000000000000000000000000000000000001000";
const BTC_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"; // example P2WPKH

// Native tool tests
const NATIVE_TESTS = {
  // Core reads
  get_chain_info: {},
  get_block: { block: "latest" },
  get_block_by_hash: { hash: ZERO_TX },
  get_balance: { address: TEST_ADDR },
  get_transaction_count: { address: TEST_ADDR },
  get_gas_price: {},
  get_fee_history: { block_count: 5 },
  get_code: { address: LOCKING },
  get_storage_at: { address: LOCKING, slot: "0x0" },
  estimate_gas: { call: { to: TEST_ADDR, data: "0x" } },
  simulate_transaction: { from: TEST_ADDR, to: TEST_ADDR, value: "0x0" },
  get_logs: { address: LOCKING, fromBlock: "0x0", toBlock: "0x100" },
  get_transaction: { hash: ZERO_TX },
  get_transaction_receipt: { hash: ZERO_TX },
  system_contracts: {},

  // Contract interaction
  eth_call: { call: { to: LOCKING, data: "0x8da5cb5b" } },

  // Build tools
  build_transaction: { from: TEST_ADDR, to: TEST_ADDR, value: "0x5af3107a4000" },
  build_contract_write: { from: TEST_ADDR, to: LOCKING, functionName: "owner", abi: [{"type":"function","name":"owner","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"}], args: [] },
  build_erc20_transfer: { from: TEST_ADDR, token: TEST_ADDR, to: TEST_ADDR, amount: "1" },
  build_erc20_approve: { from: TEST_ADDR, token: TEST_ADDR, spender: TEST_ADDR, amount: "1" },
  encode_function_data: { abi: [{"type":"function","name":"transfer","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"amount"}]}], functionName: "transfer", args: [TEST_ADDR, "1"] },
  decode_function_data: { abi: [{"type":"function","name":"transfer","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"amount"}]}], data: "0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000001" },

  // Explorer
  explorer_link: { kind: "address", value: TEST_ADDR },

  // Bridge (native) - correct param names
  bridge_params: {},
  bridge_deposit_op_return: { target: TEST_ADDR },
  bridge_deposit_status: { btcTxHash: ZERO_TX, txout: 0 },
  bridge_withdrawal_status: { id: 0 },
  build_bridge_withdraw: { from: TEST_ADDR, btcReceiver: BTC_ADDR, amountBtc: "0.0001" },
  build_bridge_rbf: { from: TEST_ADDR, withdrawalId: 0, newMaxTxPriceSatPerVbyte: 10 },
  build_bridge_cancel: { from: TEST_ADDR, withdrawalId: 0 },

  // ERC-8004 identity (native) - correct param names
  agent_identity_addresses: {},
  agent_lookup: { agentId: "1" },
  agent_get_metadata: { agentId: "1", metadataKey: "name" },
  agent_get_clients: { agentId: "1" },
  build_agent_register: { from: TEST_ADDR, agentURI: "https://example.com/agent.json" },
  build_agent_set_uri: { from: TEST_ADDR, agentId: "1", newURI: "https://example.com/agent2.json" },
  build_agent_set_metadata: { from: TEST_ADDR, agentId: "1", metadataKey: "name", metadataValueHex: "0x54657374" },
  build_agent_give_feedback: { from: TEST_ADDR, agentId: "1", value: 1, valueDecimals: 0 },
  build_agent_revoke_feedback: { from: TEST_ADDR, agentId: "1", feedbackIndex: 0 },
};

// Agentkit wrapped tool tests (sample)
const AGENTKIT_TESTS = {
  // Wallet
  "wallet.get_details": {},
  "wallet.get_allowance": { tokenAddress: TEST_ADDR, owner: TEST_ADDR, spender: TEST_ADDR },

  // Bitcoin
  "bitcoin.latest_height": {},
  "bitcoin.network_name": {},
  "bitcoin.block_hash": { height: 1 },

  // Bridge (agentkit)
  "bridge.get_params": {},
  "bridge.withdrawal_status": { withdrawalId: 0 },

  // ERC-8004 (agentkit)
  "erc8004.get_agent_wallet": { agentId: "1" },
  "erc8004.get_clients": { agentId: "1" },

  // wgBTC
  "wgbtc.balance": { address: TEST_ADDR },

  // ERC-721
  "erc721.balance": { contractAddress: TEST_ADDR, owner: TEST_ADDR },

  // BitVM2
  "goat.bitvm2.pegbtc.balance": { address: TEST_ADDR },
};

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, GOAT_NETWORK: "testnet3" },
  });

  const client = new Client({ name: "test-all", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`\n=== GOAT Network MCP v0.4.0 Full Test ===`);
  console.log(`Total tools: ${tools.length}`);
  console.log(`Network: testnet3\n`);

  let nativePass = 0, nativeFail = 0;
  let agentkitPass = 0, agentkitFail = 0;
  const failures = [];

  console.log("--- NATIVE TOOLS ---");
  for (const [name, args] of Object.entries(NATIVE_TESTS)) {
    try {
      const r = await client.callTool({ name, arguments: args });
      const txt = r.content?.[0]?.text || "";
      // Expected responses that aren't failures
      const isExpectedMiss = txt.includes("not found") || txt.includes("No agent") || txt.includes("does not exist") || txt.includes("null") || txt.includes("Transaction not found") || txt.includes("Deposit not found");
      // Contract reverts on nonexistent data are expected
      const isExpectedRevert = txt.includes("execution reverted") || txt.includes("would revert");
      const isRealError = r.isError || (txt.toLowerCase().includes("error") && !isExpectedMiss && !isExpectedRevert);

      if (isRealError) {
        console.log(`[FAIL] ${name.padEnd(28)} ${txt.slice(0, 50).replace(/\n/g, " ")}`);
        failures.push({ name, error: txt.slice(0, 100) });
        nativeFail++;
      } else {
        const sample = txt.slice(0, 45).replace(/\n/g, " ");
        console.log(`[PASS] ${name.padEnd(28)} ${sample}`);
        nativePass++;
      }
    } catch (e) {
      console.log(`[FAIL] ${name.padEnd(28)} ${e.message.slice(0, 50)}`);
      failures.push({ name, error: e.message.slice(0, 100) });
      nativeFail++;
    }
  }

  console.log("\n--- AGENTKIT WRAPPED TOOLS (sample) ---");
  for (const [name, args] of Object.entries(AGENTKIT_TESTS)) {
    try {
      const r = await client.callTool({ name, arguments: args });
      const txt = r.content?.[0]?.text || "";
      const isExpectedMiss = txt.includes("not found") || txt.includes("No agent") || txt.includes("does not exist") || txt.includes("zero address") || txt.includes("null") || txt.includes("0x000000");
      const isRealError = r.isError || (txt.toLowerCase().includes("error") && !isExpectedMiss);

      if (isRealError) {
        console.log(`[FAIL] ${name.padEnd(40)} ${txt.slice(0, 40).replace(/\n/g, " ")}`);
        failures.push({ name, error: txt.slice(0, 100) });
        agentkitFail++;
      } else {
        const sample = txt.slice(0, 35).replace(/\n/g, " ");
        console.log(`[PASS] ${name.padEnd(40)} ${sample}`);
        agentkitPass++;
      }
    } catch (e) {
      console.log(`[FAIL] ${name.padEnd(40)} ${e.message.slice(0, 40)}`);
      failures.push({ name, error: e.message.slice(0, 100) });
      agentkitFail++;
    }
  }

  const totalTests = Object.keys(NATIVE_TESTS).length + Object.keys(AGENTKIT_TESTS).length;
  const totalPass = nativePass + agentkitPass;

  console.log("\n=== SUMMARY ===");
  console.log(`Native tools:   ${nativePass} pass, ${nativeFail} fail (of ${Object.keys(NATIVE_TESTS).length})`);
  console.log(`Agentkit tools: ${agentkitPass} pass, ${agentkitFail} fail (of ${Object.keys(AGENTKIT_TESTS).length})`);
  console.log(`Total:          ${totalPass}/${totalTests} pass (${Math.round(100*totalPass/totalTests)}%)`);
  console.log(`Total tools:    ${tools.length}`);

  // List tool namespaces
  const namespaces = {};
  for (const t of tools) {
    const ns = t.name.includes(".") ? t.name.split(".")[0] : "native";
    namespaces[ns] = (namespaces[ns] || 0) + 1;
  }
  console.log("\n--- TOOL NAMESPACES ---");
  for (const [ns, count] of Object.entries(namespaces).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ns.padEnd(20)} ${count}`);
  }

  if (failures.length > 0) {
    console.log("\n--- FAILURE DETAILS ---");
    for (const f of failures.slice(0, 5)) {
      console.log(`  ${f.name}: ${f.error}`);
    }
    if (failures.length > 5) console.log(`  ... and ${failures.length - 5} more`);
  }

  await client.close();
  // Pass if > 80% success
  const exitCode = (totalPass / totalTests) < 0.8 ? 1 : 0;
  process.exit(exitCode);
}

main().catch(e => { console.error(e); process.exit(1); });
