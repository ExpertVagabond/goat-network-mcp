import { z } from "zod";
import type { RpcClient } from "../rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

export function registerExplorerTools(register: Register, rpc: RpcClient) {
  register(
    "explorer_link",
    "Build a GOAT Network block-explorer URL for a tx hash, address, or block number.",
    {
      kind: z.enum(["tx", "address", "block"]),
      value: z.string().min(1),
    },
    async ({ kind, value }) => {
      const base = rpc.config.explorerUrl;
      const path = kind === "tx" ? "tx" : kind === "address" ? "address" : "block";
      return `${base}/${path}/${value}`;
    },
  );
}
