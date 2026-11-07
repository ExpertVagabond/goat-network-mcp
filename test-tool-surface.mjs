import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, GOAT_NETWORK: "testnet3" },
  stderr: "pipe",
});

const client = new Client(
  { name: "tool-surface-test", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  const uniqueNames = new Set(names);

  assert.ok(
    tools.length >= 91,
    `expected at least 91 registered tools, received ${tools.length}`,
  );
  assert.equal(uniqueNames.size, tools.length, "tool names must be unique");

  for (const required of [
    "get_chain_info",
    "get_balance",
    "build_transaction",
    "build_contract_write",
    "agent_identity_addresses",
    "wallet.get_details",
    "goat.bitvm2.bridge.status",
  ]) {
    assert.ok(uniqueNames.has(required), `missing required tool: ${required}`);
  }

  for (const tool of tools) {
    assert.ok(tool.description?.trim(), `${tool.name} must have a description`);
    assert.equal(
      tool.inputSchema?.type,
      "object",
      `${tool.name} must expose an object input schema`,
    );
  }

  console.log(`Verified ${tools.length} unique MCP tools and their schemas.`);
} finally {
  await client.close();
}
