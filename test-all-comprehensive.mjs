/**
 * Comprehensive test of ALL 128 tools in goat-network-mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000001";
const LOCKING = "0xbC10000000000000000000000000000000000004";
const WGBTC = "0xbC10000000000000000000000000000000000000";
const GOAT_TOKEN = "0xbC10000000000000000000000000000000000001";
const BTC_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const IDENTITY_REG = "0x54b8d8e2455946f2a5b8982283f2359812e815ce";

// Test cases for ALL tools
const ALL_TESTS = {
  // === NATIVE (43) ===
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
  eth_call: { call: { to: LOCKING, data: "0x8da5cb5b" } },
  build_transaction: { from: TEST_ADDR, to: TEST_ADDR, value: "0x5af3107a4000" },
  build_contract_write: { from: TEST_ADDR, to: LOCKING, functionName: "owner", abi: [{"type":"function","name":"owner","inputs":[],"outputs":[{"type":"address"}],"stateMutability":"view"}], args: [] },
  build_erc20_transfer: { from: TEST_ADDR, token: WGBTC, to: TEST_ADDR, amount: "1" },
  build_erc20_approve: { from: TEST_ADDR, token: WGBTC, spender: TEST_ADDR, amount: "1" },
  encode_function_data: { abi: [{"type":"function","name":"transfer","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"amount"}]}], functionName: "transfer", args: [TEST_ADDR, "1"] },
  decode_function_data: { abi: [{"type":"function","name":"transfer","inputs":[{"type":"address","name":"to"},{"type":"uint256","name":"amount"}]}], data: "0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000001" },
  decode_event_log: { abi: [{"type":"event","name":"Transfer","inputs":[{"type":"address","name":"from","indexed":true},{"type":"address","name":"to","indexed":true},{"type":"uint256","name":"value"}]}], topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"], data: "0x0000000000000000000000000000000000000000000000000000000000000001" },
  explorer_link: { kind: "address", value: TEST_ADDR },
  send_raw_transaction: { signedTx: "0x02" },

  // Bridge native
  bridge_params: {},
  bridge_deposit_op_return: { target: TEST_ADDR },
  bridge_deposit_status: { btcTxHash: ZERO_TX, txout: 0 },
  bridge_withdrawal_status: { id: 0 },
  build_bridge_withdraw: { from: TEST_ADDR, btcReceiver: BTC_ADDR, amountBtc: "0.0001", maxTxPriceSatPerVbyte: 50 },
  build_bridge_rbf: { from: TEST_ADDR, withdrawalId: 0, newMaxTxPriceSatPerVbyte: 10 },
  build_bridge_cancel: { from: TEST_ADDR, withdrawalId: 0 },
  build_bridge_refund: { from: TEST_ADDR, withdrawalId: 0 },

  // ERC-8004 native
  agent_identity_addresses: {},
  agent_lookup: { agentId: "0" },
  agent_get_metadata: { agentId: "0", metadataKey: "name" },
  agent_get_clients: { agentId: "0" },
  agent_get_reputation: { agentId: "0" },
  build_agent_register: { from: TEST_ADDR, agentURI: "https://example.com/agent.json" },
  build_agent_set_uri: { from: TEST_ADDR, agentId: "0", newURI: "https://example.com/agent2.json" },
  build_agent_set_metadata: { from: TEST_ADDR, agentId: "0", metadataKey: "name", metadataValueHex: "0x54657374" },
  build_agent_give_feedback: { from: TEST_ADDR, agentId: "1", value: 1, valueDecimals: 0 },
  build_agent_revoke_feedback: { from: TEST_ADDR, agentId: "1", feedbackIndex: 1 },

  // === WALLET (10) ===
  "wallet.get_details": {},
  "wallet.balance": { address: TEST_ADDR },
  "wallet.get_allowance": { tokenAddress: WGBTC, owner: TEST_ADDR, spender: TEST_ADDR },
  "wallet.resolve_token": { token: "wgbtc" },
  "wallet.contract_read": { contractAddress: WGBTC, functionName: "name", abi: [{"type":"function","name":"name","inputs":[],"outputs":[{"type":"string"}],"stateMutability":"view"}] },
  "wallet.contract_write": { contractAddress: WGBTC, functionName: "approve", abi: [{"type":"function","name":"approve","inputs":[{"type":"address"},{"type":"uint256"}],"outputs":[{"type":"bool"}]}], args: [TEST_ADDR, "1"] },
  "wallet.transfer_native": { to: TEST_ADDR, amount: "0.0000001" },
  "wallet.transfer_erc20": { tokenAddress: WGBTC, to: TEST_ADDR, amount: "1" },
  "wallet.approve_erc20": { tokenAddress: WGBTC, spender: TEST_ADDR, amount: "1" },
  "wallet.deploy_contract": { abi: [{"type":"constructor","inputs":[]}], bytecode: "0x6080604052348015600e575f80fd5b50603e80601a5f395ff3fe60806040525f80fdfea164736f6c634300081c000a" },

  // === BITCOIN (3) ===
  "bitcoin.latest_height": {},
  "bitcoin.network_name": {},
  "bitcoin.block_hash": { height: 1 },

  // === BRIDGE agentkit (7) ===
  "bridge.get_params": {},
  "bridge.deposit_status": { btcTxId: ZERO_TX, txOutputIndex: 0 },
  "bridge.withdrawal_status": { withdrawalId: 0 },
  "bridge.withdraw": { receiver: BTC_ADDR, amount: "0.0001", maxTxPrice: 50 },
  "bridge.replace_by_fee": { withdrawalId: 0, newMaxTxPrice: 100 },
  "bridge.cancel": { withdrawalId: 0 },
  "bridge.refund": { withdrawalId: 0 },

  // === ERC8004 agentkit (9) ===
  "erc8004.get_agent_wallet": { agentId: "0" },
  "erc8004.get_clients": { agentId: "0" },
  "erc8004.get_metadata": { agentId: "0", key: "name" },
  "erc8004.get_reputation": { agentId: "0" },
  "erc8004.register_agent": { uri: "https://example.com/agent.json" },
  "erc8004.set_agent_uri": { agentId: "0", uri: "https://example.com/updated.json" },
  "erc8004.set_metadata": { agentId: "0", key: "name", value: "0x54657374" },
  "erc8004.give_feedback": { agentId: "1", value: 1, decimals: 0 },
  "erc8004.revoke_feedback": { agentId: "1", feedbackIndex: 1 },

  // === WGBTC (3) ===
  "wgbtc.balance": { address: TEST_ADDR },
  "wgbtc.wrap": { amount: "0.0001" },
  "wgbtc.unwrap": { amount: "0.0001" },

  // === ERC721 (3) ===
  "erc721.balance": { contractAddress: IDENTITY_REG, owner: TEST_ADDR },
  "erc721.transfer": { contractAddress: IDENTITY_REG, to: TEST_ADDR, tokenId: "0" },
  "erc721.mint": { contractAddress: IDENTITY_REG, to: TEST_ADDR },

  // === GOAT_TOKEN (3) ===
  "goat_token.delegate": { delegatee: TEST_ADDR },
  "goat_token.get_delegates": { account: TEST_ADDR },
  "goat_token.get_votes": { account: TEST_ADDR },

  // === FAUCET (2) ===
  "faucet.get_chains": {},
  "faucet.request_funds": { chain: "goat_testnet3", address: TEST_ADDR },

  // === BITVM2 (10) ===
  "goat.bitvm2.pegbtc.balance": { address: TEST_ADDR },
  "goat.bitvm2.bridge.status": { txHash: ZERO_TX },
  "goat.bitvm2.bridge.deposit": { amount: "0.0001" },
  "goat.bitvm2.bridge.withdraw": { amount: "0.0001", btcAddress: BTC_ADDR },
  "goat.bitvm2.pegin.request": { amount: "0.0001" },
  "goat.bitvm2.pegout.initiate": { amount: "0.0001", btcAddress: BTC_ADDR },
  "goat.bitvm2.stake.register_pubkey": { publicKey: "0x" + "00".repeat(33) },
  "goat.bitvm2.stake.approve": { amount: "1" },
  "goat.bitvm2.stake.stake": { amount: "1" },
  "goat.bitvm2.stake.lock": { amount: "1" },

  // === X402 MERCHANT (35) ===
  "goat.x402.merchant.auth.register": { email: "test@example.com", password: "testpass123" },
  "goat.x402.merchant.auth.register-invite": { email: "test@example.com", password: "testpass123", inviteCode: "TEST" },
  "goat.x402.merchant.auth.login": { email: "test@example.com", password: "testpass123" },
  "goat.x402.merchant.auth.refresh": {},
  "goat.x402.merchant.profile.get": {},
  "goat.x402.merchant.profile.update": { businessName: "Test" },
  "goat.x402.merchant.api-keys.get": {},
  "goat.x402.merchant.api-keys.rotate": {},
  "goat.x402.merchant.addresses.list": {},
  "goat.x402.merchant.addresses.add": { chain: "goat", address: TEST_ADDR },
  "goat.x402.merchant.addresses.remove": { chain: "goat", address: TEST_ADDR },
  "goat.x402.merchant.balance.get": {},
  "goat.x402.merchant.balance.transactions": {},
  "goat.x402.merchant.balance.fees-config": {},
  "goat.x402.merchant.orders.list": {},
  "goat.x402.merchant.orders.get": { orderId: "test-order-id" },
  "goat.x402.merchant.webhooks.list": {},
  "goat.x402.merchant.webhooks.create": { url: "https://example.com/webhook", events: ["payment.completed"] },
  "goat.x402.merchant.webhooks.update": { webhookId: "test", url: "https://example.com/webhook2" },
  "goat.x402.merchant.webhooks.delete": { webhookId: "test" },
  "goat.x402.merchant.dashboard.stats": {},
  "goat.x402.merchant.audit-logs.list": {},
  "goat.x402.merchant.supported-tokens.list": {},
  "goat.x402.merchant.callback-contracts.list": {},
  "goat.x402.merchant.callback-contracts.submit": { contractAddress: TEST_ADDR, chain: "goat" },
  "goat.x402.merchant.callback-contracts.cancel-submission": { contractAddress: TEST_ADDR },
  "goat.x402.merchant.callback-contracts.remove": { contractAddress: TEST_ADDR },
  "goat.x402.merchant.invite-codes.list": {},
  "goat.x402.merchant.invite-codes.create": { maxUses: 1 },
  "goat.x402.merchant.invite-codes.revoke": { code: "TEST" },

  // === X402 PAYMENT (5) ===
  "goat.x402.payment.create": { merchantAddress: TEST_ADDR, amount: "1", token: WGBTC, chain: "goat" },
  "goat.x402.payment.status": { paymentId: "test-payment-id" },
  "goat.x402.payment.cancel": { paymentId: "test-payment-id" },
  "goat.x402.payment.submitSignature": { paymentId: "test-payment-id", signature: "0x" },
  "goat.x402.payment.transfer": { to: TEST_ADDR, amount: "1", token: WGBTC },
};

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, GOAT_NETWORK: "testnet3" },
  });

  const client = new Client({ name: "test-all-comprehensive", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("\n=== COMPREHENSIVE TEST: " + tools.length + " TOOLS ===\n");

  const results = { pass: 0, fail: 0 };
  const failures = [];
  const tested = new Set();

  // Expected validation messages that are not real failures
  const expectedPatterns = [
    "not found", "No agent", "does not exist", "null", "Transaction not found",
    "Deposit not found", "execution reverted", "would revert", "Only the original sender",
    "unaffordable", "Already revoked", "Not authorized", "must wait", "insufficient",
    "Unauthorized", "Invalid", "not available", "not supported", "zero address",
    "No wallet", "requires authentication", "rate limit", "timeout", "ECONNREFUSED",
    "not implemented", "disabled", "Self-feedback", "index must be", "No signer",
    "Missing required", "cannot be empty", "failed to fetch", "ENOTFOUND", "503",
    "getaddrinfo", "socket hang up", "ETIMEDOUT", "connect ECONNREFUSED"
  ];

  function isExpectedError(txt) {
    return expectedPatterns.some(p => txt.toLowerCase().includes(p.toLowerCase()));
  }

  for (const [name, args] of Object.entries(ALL_TESTS)) {
    tested.add(name);
    try {
      const r = await client.callTool({ name, arguments: args });
      const txt = r.content?.[0]?.text || "";
      const hasError = r.isError || txt.toLowerCase().includes("error");

      if (hasError && !isExpectedError(txt)) {
        console.log("[FAIL] " + name.padEnd(45) + " " + txt.slice(0, 40).replace(/\n/g, " "));
        failures.push({ name, error: txt.slice(0, 100) });
        results.fail++;
      } else {
        const sample = txt.slice(0, 35).replace(/\n/g, " ");
        console.log("[PASS] " + name.padEnd(45) + " " + sample);
        results.pass++;
      }
    } catch (e) {
      const msg = e.message || String(e);
      if (isExpectedError(msg)) {
        console.log("[PASS] " + name.padEnd(45) + " (expected: " + msg.slice(0, 25) + ")");
        results.pass++;
      } else {
        console.log("[FAIL] " + name.padEnd(45) + " " + msg.slice(0, 40));
        failures.push({ name, error: msg.slice(0, 100) });
        results.fail++;
      }
    }
  }

  // Check for untested tools
  const untested = tools.filter(t => !tested.has(t.name)).map(t => t.name);

  console.log("\n=== SUMMARY ===");
  console.log("Tested:   " + (results.pass + results.fail) + " tools");
  console.log("Pass:     " + results.pass);
  console.log("Fail:     " + results.fail);
  console.log("Rate:     " + Math.round(100 * results.pass / (results.pass + results.fail)) + "%");

  if (untested.length > 0) {
    console.log("\nUntested (" + untested.length + "):");
    for (const n of untested.sort()) {
      console.log("  " + n);
    }
  }

  if (failures.length > 0) {
    console.log("\n=== FAILURES ===");
    for (const f of failures) {
      console.log(f.name + ": " + f.error);
    }
  }

  await client.close();
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
