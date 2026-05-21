import { z } from "zod";
import type { RpcClient } from "../rpc.js";
import { formatNative, toHex } from "../rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "20-byte hex address");

const blockTag = z
  .union([
    z.string().regex(/^0x[0-9a-fA-F]+$/),
    z.number().int().nonnegative(),
    z.enum(["latest", "earliest", "pending", "safe", "finalized"]),
  ])
  .default("latest");

function normalizeTag(v: string | number) {
  if (typeof v === "string" && !v.startsWith("0x")) return v;
  return toHex(v);
}

export function registerAccountTools(register: Register, rpc: RpcClient) {
  register(
    "get_balance",
    "Get the native BTC balance of an address on GOAT Network. Returns both wei and decimal BTC.",
    { address, block: blockTag },
    async ({ address, block }) => {
      const balance = await rpc.call<string>("eth_getBalance", [
        address,
        normalizeTag(block),
      ]);
      const cfg = rpc.config;
      return formatNative(balance, cfg.nativeDecimals, cfg.nativeSymbol);
    },
  );

  register(
    "get_transaction_count",
    "Get the nonce (number of transactions sent) for an address.",
    { address, block: blockTag },
    async ({ address, block }) => {
      const nonce = await rpc.call<string>("eth_getTransactionCount", [
        address,
        normalizeTag(block),
      ]);
      return `${BigInt(nonce).toString()} (${nonce})`;
    },
  );

  register(
    "get_code",
    "Get the deployed contract bytecode at an address. Returns '0x' for EOAs.",
    { address, block: blockTag },
    async ({ address, block }) => {
      const code = await rpc.call<string>("eth_getCode", [address, normalizeTag(block)]);
      return code === "0x"
        ? "0x (no code — address is an EOA or undeployed)"
        : `${code.length - 2} hex chars (${(code.length - 2) / 2} bytes)\n${code}`;
    },
  );

  register(
    "get_storage_at",
    "Read a single 32-byte storage slot from a contract.",
    {
      address,
      slot: z
        .union([
          z.string().regex(/^0x[0-9a-fA-F]+$/),
          z.number().int().nonnegative(),
        ])
        .describe("Storage slot index (decimal or hex)"),
      block: blockTag,
    },
    async ({ address, slot, block }) => {
      const value = await rpc.call<string>("eth_getStorageAt", [
        address,
        toHex(slot),
        normalizeTag(block),
      ]);
      return value;
    },
  );
}
