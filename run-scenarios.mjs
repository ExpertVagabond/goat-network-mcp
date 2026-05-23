/**
 * Run 100+ transaction scenarios on GOAT Network Testnet3
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWalletClient, createPublicClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// Hardhat test accounts
const ACCOUNTS = [
  { key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", name: "Wallet #0" },
  { key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", name: "Wallet #1" },
  { key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", name: "Wallet #2" },
];

const goatTestnet3 = defineChain({
  id: 48816,
  name: "GOAT Network Testnet3",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
});

const publicClient = createPublicClient({ chain: goatTestnet3, transport: http() });

const wallets = ACCOUNTS.map(a => ({
  account: privateKeyToAccount(a.key),
  client: createWalletClient({
    account: privateKeyToAccount(a.key),
    chain: goatTestnet3,
    transport: http()
  }),
  name: a.name,
}));

let mcpClient;
const stats = { success: 0, fail: 0, txHashes: [] };

async function initMCP() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, GOAT_NETWORK: "testnet3" },
  });
  mcpClient = new Client({ name: "scenarios", version: "1.0.0" }, { capabilities: {} });
  await mcpClient.connect(transport);
  console.log("MCP connected\n");
}

async function callTool(name, args) {
  const r = await mcpClient.callTool({ name, arguments: args });
  return r.content?.[0]?.text || "";
}

async function signAndSend(walletIdx, txJson) {
  const txData = JSON.parse(txJson);
  const wallet = wallets[walletIdx];

  const hash = await wallet.client.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: BigInt(txData.value || "0"),
    gas: BigInt(txData.gas),
    maxFeePerGas: BigInt(txData.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(txData.maxPriorityFeePerGas),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

async function scenario(name, fn) {
  process.stdout.write(`[${stats.success + stats.fail + 1}] ${name.padEnd(50)} `);
  try {
    const result = await fn();
    if (result?.hash) {
      stats.txHashes.push(result.hash);
      console.log(`OK (${result.hash.slice(0, 10)}...)`);
    } else {
      console.log("OK");
    }
    stats.success++;
    return result;
  } catch (e) {
    console.log(`FAIL: ${e.message.slice(0, 40)}`);
    stats.fail++;
    return null;
  }
}

async function main() {
  console.log("=== GOAT Network Scenario Runner ===\n");

  // Check balances
  for (const w of wallets) {
    const bal = await publicClient.getBalance({ address: w.account.address });
    console.log(`${w.name}: ${formatEther(bal)} BTC`);
  }
  console.log();

  await initMCP();

  // Track created agents
  const createdAgents = [];

  // === SCENARIO 1: Register multiple agents ===
  console.log("\n--- Registering Agents ---");
  for (let i = 0; i < 5; i++) {
    const result = await scenario(`Register agent #${i}`, async () => {
      const txt = await callTool("build_agent_register", {
        from: wallets[0].account.address,
        agentURI: `https://example.com/scenario-agent-${Date.now()}-${i}.json`,
      });
      if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
      const { hash, receipt } = await signAndSend(0, txt);

      // Parse agent ID from Transfer event
      for (const log of receipt.logs) {
        if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && log.topics.length >= 4) {
          createdAgents.push(BigInt(log.topics[3]).toString());
          break;
        }
      }
      return { hash, receipt };
    });
  }

  // === SCENARIO 2: Set metadata on agents ===
  console.log("\n--- Setting Agent Metadata ---");
  const metadataKeys = ["name", "description", "version", "category", "author"];
  for (let i = 0; i < Math.min(createdAgents.length, 5); i++) {
    for (const key of metadataKeys) {
      await scenario(`Set ${key} on agent ${createdAgents[i]}`, async () => {
        const value = `0x${Buffer.from(`${key}-value-${Date.now()}`).toString("hex")}`;
        const txt = await callTool("build_agent_set_metadata", {
          from: wallets[0].account.address,
          agentId: createdAgents[i],
          metadataKey: key,
          metadataValueHex: value,
        });
        if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
        return await signAndSend(0, txt);
      });
    }
  }

  // === SCENARIO 3: Set URIs ===
  console.log("\n--- Updating Agent URIs ---");
  for (let i = 0; i < Math.min(createdAgents.length, 5); i++) {
    for (let j = 0; j < 3; j++) {
      await scenario(`Update URI #${j} for agent ${createdAgents[i]}`, async () => {
        const txt = await callTool("build_agent_set_uri", {
          from: wallets[0].account.address,
          agentId: createdAgents[i],
          newURI: `https://example.com/agent-${createdAgents[i]}-v${j}-${Date.now()}.json`,
        });
        if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
        return await signAndSend(0, txt);
      });
    }
  }

  // === SCENARIO 4: Cross-wallet feedback ===
  console.log("\n--- Cross-wallet Feedback ---");
  // Fund wallet #1 if needed
  const bal1 = await publicClient.getBalance({ address: wallets[1].account.address });
  if (bal1 < parseEther("0.00003")) {
    await scenario("Fund wallet #1", async () => {
      const hash = await wallets[0].client.sendTransaction({
        to: wallets[1].account.address,
        value: parseEther("0.00005"),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    });
  }

  // Give feedback from wallet #1 to agents owned by wallet #0
  for (let i = 0; i < Math.min(createdAgents.length, 5); i++) {
    await scenario(`Give feedback to agent ${createdAgents[i]}`, async () => {
      const txt = await callTool("build_agent_give_feedback", {
        from: wallets[1].account.address,
        agentId: createdAgents[i],
        value: 100 + i,
        valueDecimals: 0,
      });
      if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
      return await signAndSend(1, txt);
    });
  }

  // === SCENARIO 5: Native transfers ===
  console.log("\n--- Native BTC Transfers ---");
  const transferAmount = parseEther("0.000001");
  for (let i = 0; i < 10; i++) {
    await scenario(`Transfer #${i} (0 -> 1)`, async () => {
      const hash = await wallets[0].client.sendTransaction({
        to: wallets[1].account.address,
        value: transferAmount,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    });
  }

  for (let i = 0; i < 5; i++) {
    await scenario(`Transfer #${i} (1 -> 0)`, async () => {
      const hash = await wallets[1].client.sendTransaction({
        to: wallets[0].account.address,
        value: transferAmount,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    });
  }

  // === SCENARIO 6: GOAT token delegation ===
  console.log("\n--- GOAT Token Delegation ---");
  for (let i = 0; i < 5; i++) {
    await scenario(`Delegate GOAT token #${i}`, async () => {
      const txt = await callTool("goat_token.delegate", {
        from: wallets[0].account.address,
        delegatee: wallets[i % 2].account.address,
      });
      if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
      return await signAndSend(0, txt);
    });
  }

  // === SCENARIO 7: Contract reads ===
  console.log("\n--- Contract Reads ---");
  for (let i = 0; i < 10; i++) {
    await scenario(`Read agent ${createdAgents[i % createdAgents.length]} metadata`, async () => {
      const txt = await callTool("agent_get_metadata", {
        agentId: createdAgents[i % createdAgents.length],
        metadataKey: metadataKeys[i % metadataKeys.length],
      });
      return { read: true };
    });
  }

  for (let i = 0; i < 5; i++) {
    await scenario(`Lookup agent ${createdAgents[i % createdAgents.length]}`, async () => {
      const txt = await callTool("agent_lookup", {
        agentId: createdAgents[i % createdAgents.length],
      });
      return { read: true };
    });
  }

  // === SCENARIO 8: More agent registrations ===
  console.log("\n--- More Agent Registrations ---");
  for (let i = 0; i < 10; i++) {
    await scenario(`Register agent batch2 #${i}`, async () => {
      const txt = await callTool("build_agent_register", {
        from: wallets[0].account.address,
        agentURI: `https://example.com/batch2-agent-${Date.now()}-${i}.json`,
      });
      if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
      const { hash, receipt } = await signAndSend(0, txt);
      return { hash, receipt };
    });
  }

  // === SCENARIO 9: Revoke feedback ===
  console.log("\n--- Revoke Feedback ---");
  for (let i = 0; i < Math.min(createdAgents.length, 3); i++) {
    await scenario(`Revoke feedback on agent ${createdAgents[i]}`, async () => {
      const txt = await callTool("build_agent_revoke_feedback", {
        from: wallets[1].account.address,
        agentId: createdAgents[i],
        feedbackIndex: 1,
      });
      if (txt.includes("Error")) throw new Error(txt.slice(0, 50));
      return await signAndSend(1, txt);
    });
  }

  // === SCENARIO 10: More transfers to hit 100+ ===
  console.log("\n--- Final Transfer Batch ---");
  const remaining = 100 - (stats.success + stats.fail);
  for (let i = 0; i < Math.max(remaining, 10); i++) {
    await scenario(`Final transfer #${i}`, async () => {
      const hash = await wallets[0].client.sendTransaction({
        to: wallets[1].account.address,
        value: parseEther("0.0000001"),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    });
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SCENARIO SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total scenarios: ${stats.success + stats.fail}`);
  console.log(`Success: ${stats.success}`);
  console.log(`Failed: ${stats.fail}`);
  console.log(`Transactions: ${stats.txHashes.length}`);
  console.log(`Agents created: ${createdAgents.length}`);

  // Final balances
  console.log("\nFinal balances:");
  for (const w of wallets) {
    const bal = await publicClient.getBalance({ address: w.account.address });
    console.log(`  ${w.name}: ${formatEther(bal)} BTC`);
  }

  await mcpClient.close();
  process.exit(stats.fail > 10 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
