import { z } from "zod";
import type { RpcClient } from "../rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "32-byte tx hash");

export function registerTransactionTools(register: Register, rpc: RpcClient) {
  register(
    "get_transaction",
    "Get a transaction by its hash.",
    { hash: txHash },
    async ({ hash }) => {
      const result = await rpc.call("eth_getTransactionByHash", [hash]);
      if (result === null) return `No transaction found for ${hash}`;
      return JSON.stringify(result, null, 2);
    },
  );

  register(
    "get_transaction_receipt",
    "Get the receipt for a mined transaction (status, gas used, logs).",
    { hash: txHash },
    async ({ hash }) => {
      const result = await rpc.call("eth_getTransactionReceipt", [hash]);
      if (result === null) return `No receipt yet for ${hash} (tx may be pending or unknown).`;
      return JSON.stringify(result, null, 2);
    },
  );

  register(
    "send_raw_transaction",
    "Broadcast a signed raw transaction. The MCP does NOT sign — pass a hex-encoded signed tx.",
    {
      signedTx: z
        .string()
        .regex(/^0x[0-9a-fA-F]+$/, "hex-encoded signed transaction"),
    },
    async ({ signedTx }) => {
      const hash = await rpc.call<string>("eth_sendRawTransaction", [signedTx]);
      const explorer = `${rpc.config.explorerUrl}/tx/${hash}`;
      return `Broadcast tx: ${hash}\nExplorer: ${explorer}`;
    },
  );
}
