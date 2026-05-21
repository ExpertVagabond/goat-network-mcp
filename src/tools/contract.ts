import { z } from "zod";
import type { RpcClient } from "../rpc.js";
import { toHex } from "../rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);

const callObject = z.object({
  to: address,
  from: address.optional(),
  data: hex.optional(),
  value: hex.optional(),
  gas: hex.optional(),
  gasPrice: hex.optional(),
});

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

export function registerContractTools(register: Register, rpc: RpcClient) {
  register(
    "eth_call",
    "Execute a read-only contract call (no state changes). Pass a call object with `to` and ABI-encoded `data`.",
    {
      call: callObject,
      block: blockTag,
    },
    async ({ call, block }) => {
      const result = await rpc.call<string>("eth_call", [call, normalizeTag(block)]);
      return result;
    },
  );

  register(
    "estimate_gas",
    "Estimate gas required for a transaction without sending it.",
    { call: callObject },
    async ({ call }) => {
      const result = await rpc.call<string>("eth_estimateGas", [call]);
      return `${BigInt(result).toString()} gas (${result})`;
    },
  );

  register(
    "get_logs",
    "Query event logs by filter. Provide fromBlock/toBlock and optionally address and topics.",
    {
      fromBlock: blockTag,
      toBlock: blockTag,
      address: z.union([address, z.array(address)]).optional(),
      topics: z
        .array(
          z.union([
            z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
            z.null(),
          ]),
        )
        .optional(),
    },
    async ({ fromBlock, toBlock, address, topics }) => {
      const filter: Record<string, unknown> = {
        fromBlock: normalizeTag(fromBlock),
        toBlock: normalizeTag(toBlock),
      };
      if (address) filter.address = address;
      if (topics) filter.topics = topics;
      const result = await rpc.call("eth_getLogs", [filter]);
      return JSON.stringify(result, null, 2);
    },
  );
}
