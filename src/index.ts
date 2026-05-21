#!/usr/bin/env node
/**
 * GOAT Network MCP Server
 *
 * Exposes the GOAT Network Bitcoin L2 (EVM-compatible) JSON-RPC as MCP tools:
 * chain info, blocks, transactions, balances, contract reads, logs, fee history.
 *
 * Environment:
 *   GOAT_NETWORK   mainnet (default) | testnet3
 *   GOAT_RPC_URL   override RPC endpoint (e.g. a private node)
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveNetwork } from "./networks.js";
import { RpcClient } from "./rpc.js";
import { registerChainTools } from "./tools/chain.js";
import { registerAccountTools } from "./tools/account.js";
import { registerTransactionTools } from "./tools/transaction.js";
import { registerContractTools } from "./tools/contract.js";
import { registerExplorerTools } from "./tools/explorer.js";

const network = resolveNetwork();
const rpc = new RpcClient(network);

const server = new McpServer({
  name: "goat-network-mcp",
  version: "0.1.0",
});

let toolCount = 0;

function register(
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) {
  server.tool(name, description, shape, async (args) => {
    try {
      const text = await handler(args);
      return { content: [{ type: "text" as const, text }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
  toolCount++;
}

registerChainTools(register, rpc);
registerAccountTools(register, rpc);
registerTransactionTools(register, rpc);
registerContractTools(register, rpc);
registerExplorerTools(register, rpc);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `goat-network-mcp running — ${toolCount} tools — ${network.name} (chainId ${network.chainId}) via ${network.rpcUrl}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
