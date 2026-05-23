/**
 * Test write operations by creating a wallet, registering an agent,
 * and executing the full ERC-8004 + bridge write flow.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// Test wallet - ONLY FOR TESTNET. DO NOT USE ON MAINNET.
// This is a fresh keypair generated for testing.
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat #0
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

const goatTestnet3 = defineChain({
  id: 48816,
  name: "GOAT Network Testnet3",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet3.goat.network" } },
});

const publicClient = createPublicClient({ chain: goatTestnet3, transport: http() });
const walletClient = createWalletClient({ account: TEST_ACCOUNT, chain: goatTestnet3, transport: http() });

console.log("Test wallet:", TEST_ACCOUNT.address);

async function main() {
  // Check balance
  const balance = await publicClient.getBalance({ address: TEST_ACCOUNT.address });
  console.log("Balance:", formatEther(balance), "BTC");

  if (balance < parseEther("0.00001")) {
    console.log("\n⚠️  Wallet needs funds. Please send testnet BTC to:");
    console.log(`   ${TEST_ACCOUNT.address}`);
    console.log("   Use faucet: https://bridge.testnet3.goat.network/faucet");
    process.exit(1);
  }

  // Connect to MCP
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, GOAT_NETWORK: "testnet3" },
  });
  const client = new Client({ name: "test-writes", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const results = { pass: 0, fail: 0 };

  async function testTool(name, args, shouldSign = false) {
    try {
      const r = await client.callTool({ name, arguments: args });
      const txt = r.content?.[0]?.text || "";

      if (r.isError || txt.toLowerCase().includes("error")) {
        console.log(`[FAIL] ${name}: ${txt.slice(0, 60)}`);
        results.fail++;
        return null;
      }

      if (shouldSign) {
        // Parse the unsigned tx and sign/broadcast it
        const txData = JSON.parse(txt);
        console.log(`[BUILD] ${name}: got unsigned tx`);

        const hash = await walletClient.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: BigInt(txData.value || "0"),
          gas: BigInt(txData.gas),
          maxFeePerGas: BigInt(txData.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(txData.maxPriorityFeePerGas),
        });

        console.log(`[SEND] ${name}: tx ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === "success") {
          console.log(`[PASS] ${name}: confirmed in block ${receipt.blockNumber}`);
          results.pass++;
          return receipt;
        } else {
          console.log(`[FAIL] ${name}: tx reverted`);
          results.fail++;
          return null;
        }
      } else {
        console.log(`[PASS] ${name}: ${txt.slice(0, 50)}`);
        results.pass++;
        return txt;
      }
    } catch (e) {
      console.log(`[FAIL] ${name}: ${e.message.slice(0, 60)}`);
      results.fail++;
      return null;
    }
  }

  console.log("\n=== ERC-8004 WRITE TESTS ===\n");

  // 1. Register a new agent
  console.log("--- Registering new agent ---");
  const agentURI = `https://example.com/test-agent-${Date.now()}.json`;
  const registerReceipt = await testTool("build_agent_register", {
    from: TEST_ACCOUNT.address,
    agentURI: agentURI,
  }, true);

  if (!registerReceipt) {
    console.log("Failed to register agent, cannot continue ERC-8004 tests");
  } else {
    // Parse the AgentRegistered event to get agentId
    // Event: AgentRegistered(uint256 indexed agentId, address indexed owner, string uri)
    const agentRegisteredTopic = "0x8b14266b7a7bffd46c2b5a039d5db1f40b25f2e1e8db4c5d8f9a3b5c6d7e8f9a";
    const registrationLog = registerReceipt.logs.find(log =>
      log.topics[0]?.toLowerCase().includes("8b14266b") || log.topics.length >= 2
    );

    // The agentId is typically in topics[1] for indexed params
    let agentId = "1"; // fallback
    if (registrationLog && registrationLog.topics[1]) {
      agentId = BigInt(registrationLog.topics[1]).toString();
    }
    console.log(`Registered agent ID: ${agentId}`);

    // 2. Test set_uri on our agent
    console.log("\n--- Testing agent write operations ---");
    await testTool("build_agent_set_uri", {
      from: TEST_ACCOUNT.address,
      agentId: agentId,
      newURI: `https://example.com/updated-agent-${Date.now()}.json`,
    }, true);

    // 3. Test set_metadata
    await testTool("build_agent_set_metadata", {
      from: TEST_ACCOUNT.address,
      agentId: agentId,
      metadataKey: "name",
      metadataValueHex: "0x54657374416765" + "6e74", // "TestAgent" in hex
    }, true);

    // 4. Test give_feedback (to another agent, ID 1)
    await testTool("build_agent_give_feedback", {
      from: TEST_ACCOUNT.address,
      agentId: "1", // Give feedback to agent 1
      value: 1,
      valueDecimals: 0,
    }, true);

    // 5. Test revoke_feedback
    await testTool("build_agent_revoke_feedback", {
      from: TEST_ACCOUNT.address,
      agentId: "1",
      feedbackIndex: 0,
    }, true);
  }

  console.log("\n=== BRIDGE WRITE TESTS ===\n");

  // Check if we have enough balance for bridge withdrawal
  const currentBalance = await publicClient.getBalance({ address: TEST_ACCOUNT.address });
  const minWithdrawAmount = parseEther("0.0001");

  if (currentBalance < minWithdrawAmount + parseEther("0.0001")) {
    console.log("Insufficient balance for bridge tests (need ~0.0002 BTC)");
  } else {
    // 1. Initiate a withdrawal
    console.log("--- Initiating bridge withdrawal ---");
    const withdrawReceipt = await testTool("build_bridge_withdraw", {
      from: TEST_ACCOUNT.address,
      btcReceiver: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // testnet P2WPKH
      amountBtc: "0.0001",
      maxTxPriceSatPerVbyte: 50,
    }, true);

    if (withdrawReceipt) {
      // Parse Withdraw event to get withdrawalId
      // Event: Withdraw(uint256 indexed id, address indexed sender, ...)
      const withdrawLog = withdrawReceipt.logs.find(log => log.topics.length >= 2);
      let withdrawalId = "0";
      if (withdrawLog && withdrawLog.topics[1]) {
        withdrawalId = BigInt(withdrawLog.topics[1]).toString();
      }
      console.log(`Withdrawal ID: ${withdrawalId}`);

      // 2. Test RBF (replace-by-fee)
      console.log("\n--- Testing RBF ---");
      await testTool("build_bridge_rbf", {
        from: TEST_ACCOUNT.address,
        withdrawalId: parseInt(withdrawalId),
        newMaxTxPriceSatPerVbyte: 100,
      }, true);

      // 3. Test cancel (this will likely fail if RBF succeeded, or vice versa)
      console.log("\n--- Testing cancel ---");
      await testTool("build_bridge_cancel", {
        from: TEST_ACCOUNT.address,
        withdrawalId: parseInt(withdrawalId),
      }, true);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Pass: ${results.pass}, Fail: ${results.fail}`);

  await client.close();
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
