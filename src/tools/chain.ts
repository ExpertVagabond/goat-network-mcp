import { z } from "zod";
import type { RpcClient } from "../rpc.js";
import { fromHex, toHex } from "../rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const blockTag = z
  .union([
    z.string().regex(/^0x[0-9a-fA-F]+$/, "hex block number"),
    z.number().int().nonnegative(),
    z.enum(["latest", "earliest", "pending", "safe", "finalized"]),
  ])
  .describe("Block number (decimal or 0x-hex) or tag");

export function registerChainTools(register: Register, rpc: RpcClient) {
  register(
    "get_chain_info",
    "Get GOAT Network chain ID, latest block number, current gas price, and network metadata.",
    {},
    async () => {
      const [chainId, blockNumber, gasPrice] = await Promise.all([
        rpc.call<string>("eth_chainId"),
        rpc.call<string>("eth_blockNumber"),
        rpc.call<string>("eth_gasPrice"),
      ]);
      const cfg = rpc.config;
      return JSON.stringify(
        {
          network: cfg.name,
          chainId: Number(fromHex(chainId)),
          chainIdHex: chainId,
          latestBlock: Number(fromHex(blockNumber)),
          gasPriceWei: fromHex(gasPrice).toString(),
          nativeSymbol: cfg.nativeSymbol,
          nativeDecimals: cfg.nativeDecimals,
          rpcUrl: cfg.rpcUrl,
          explorerUrl: cfg.explorerUrl,
        },
        null,
        2,
      );
    },
  );

  register(
    "get_block",
    "Get a block by number or tag. Set fullTransactions=true to include full tx objects (default: hashes only).",
    {
      block: blockTag,
      fullTransactions: z.boolean().optional().default(false),
    },
    async ({ block, fullTransactions }) => {
      const tag =
        typeof block === "string" && !block.startsWith("0x")
          ? block
          : toHex(block as number | string);
      const result = await rpc.call("eth_getBlockByNumber", [tag, fullTransactions]);
      return JSON.stringify(result, null, 2);
    },
  );

  register(
    "get_block_by_hash",
    "Get a block by its hash.",
    {
      hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "32-byte block hash"),
      fullTransactions: z.boolean().optional().default(false),
    },
    async ({ hash, fullTransactions }) => {
      const result = await rpc.call("eth_getBlockByHash", [hash, fullTransactions]);
      return JSON.stringify(result, null, 2);
    },
  );

  register(
    "get_gas_price",
    "Get current gas price in wei.",
    {},
    async () => {
      const price = await rpc.call<string>("eth_gasPrice");
      return `${fromHex(price).toString()} wei (${price})`;
    },
  );

  register(
    "get_fee_history",
    "Get EIP-1559 fee history. Returns base fees and reward percentiles for the last N blocks.",
    {
      blockCount: z.number().int().positive().max(1024).default(10),
      newestBlock: z
        .union([z.enum(["latest", "pending"]), z.number().int().nonnegative()])
        .default("latest"),
      rewardPercentiles: z.array(z.number().min(0).max(100)).default([25, 50, 75]),
    },
    async ({ blockCount, newestBlock, rewardPercentiles }) => {
      const tag = typeof newestBlock === "string" ? newestBlock : toHex(newestBlock);
      const result = await rpc.call("eth_feeHistory", [
        toHex(blockCount),
        tag,
        rewardPercentiles,
      ]);
      return JSON.stringify(result, null, 2);
    },
  );
}
