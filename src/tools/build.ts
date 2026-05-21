import { z } from "zod";
import {
  encodeFunctionData,
  decodeFunctionData,
  decodeEventLog,
  parseAbi,
  parseUnits,
  formatUnits,
  type Abi,
  type AbiFunction,
} from "viem";
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
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

// abi: either a full JSON ABI array or a list of human-readable signatures
// (e.g. ["function transfer(address to, uint256 amount) returns (bool)"]).
const abiInput = z.union([
  z.array(z.any()),
  z.array(z.string()),
  z.string(),
]);

function resolveAbi(input: unknown): Abi {
  if (typeof input === "string") return parseAbi([input]) as Abi;
  if (Array.isArray(input) && input.every((x) => typeof x === "string")) {
    return parseAbi(input as string[]) as Abi;
  }
  return input as Abi;
}

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]) as Abi;

async function suggestFees(rpc: RpcClient): Promise<{
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}> {
  try {
    const hist = await rpc.call<{
      baseFeePerGas: string[];
      reward?: string[][];
    }>("eth_feeHistory", [toHex(20), "latest", [50]]);
    const baseFees = hist.baseFeePerGas.map((h) => BigInt(h));
    const baseFee = baseFees[baseFees.length - 1] ?? 0n;
    const tips = (hist.reward ?? [])
      .map((row) => BigInt(row?.[0] ?? "0x0"))
      .filter((t) => t > 0n);
    const tip =
      tips.length > 0
        ? tips.reduce((a, b) => a + b, 0n) / BigInt(tips.length)
        : 1_000_000_000n; // 1 gwei fallback
    const maxFee = baseFee * 2n + tip;
    return {
      maxFeePerGas: "0x" + maxFee.toString(16),
      maxPriorityFeePerGas: "0x" + tip.toString(16),
    };
  } catch {
    const gp = await rpc.call<string>("eth_gasPrice", []);
    return { maxFeePerGas: gp, maxPriorityFeePerGas: gp };
  }
}

function decodeRevert(data: string | undefined): string | null {
  if (!data || data === "0x") return null;
  // Error(string) selector
  if (data.startsWith("0x08c379a0")) {
    try {
      const offset = BigInt("0x" + data.slice(10, 74));
      const len = Number(BigInt("0x" + data.slice(74, 138)));
      const strHex = data.slice(138, 138 + len * 2);
      return Buffer.from(strHex, "hex").toString("utf8");
    } catch {
      return null;
    }
  }
  // Panic(uint256) selector
  if (data.startsWith("0x4e487b71")) {
    try {
      const code = BigInt("0x" + data.slice(10));
      return `Panic(0x${code.toString(16)})`;
    } catch {
      return null;
    }
  }
  return null;
}

export function registerBuildTools(register: Register, rpc: RpcClient) {
  register(
    "build_transaction",
    "Build an unsigned EIP-1559 transaction with auto-filled nonce, gas, and fees. Returns a JSON object ready to be signed by an external wallet, then broadcast via send_raw_transaction.",
    {
      from: address,
      to: address,
      value: hex.optional(),
      data: hex.optional(),
      gas: hex.optional(),
    },
    async ({ from, to, value, data, gas }) => {
      const call: Record<string, string> = { from, to };
      if (value) call.value = value;
      if (data) call.data = data;

      const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
      const gasHex = gas ?? (await rpc.call<string>("eth_estimateGas", [call]));
      const fees = await suggestFees(rpc);

      const tx = {
        type: "0x2",
        chainId: rpc.config.chainIdHex,
        nonce: nonceHex,
        to,
        value: value ?? "0x0",
        data: data ?? "0x",
        gas: gasHex,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        accessList: [],
      };
      return JSON.stringify(tx, null, 2);
    },
  );

  register(
    "encode_function_data",
    "Encode a contract function call to ABI calldata. Accepts a function signature string (e.g. \"function transfer(address,uint256)\") or a full ABI array.",
    {
      abi: abiInput,
      functionName: z.string(),
      args: z.array(z.any()).optional(),
    },
    async ({ abi, functionName, args }) => {
      const resolved = resolveAbi(abi);
      const data = encodeFunctionData({
        abi: resolved,
        functionName,
        args: args ?? [],
      });
      return data;
    },
  );

  register(
    "decode_function_data",
    "Decode ABI calldata back into a function name + arguments. Useful for inspecting a pending or just-built transaction.",
    {
      abi: abiInput,
      data: hex,
    },
    async ({ abi, data }) => {
      const resolved = resolveAbi(abi);
      const decoded = decodeFunctionData({ abi: resolved, data: data as `0x${string}` });
      return JSON.stringify(
        {
          functionName: decoded.functionName,
          args: decoded.args?.map((a) => (typeof a === "bigint" ? a.toString() : a)),
        },
        null,
        2,
      );
    },
  );

  register(
    "decode_event_log",
    "Decode a raw event log (from get_logs) into the event name and named arguments.",
    {
      abi: abiInput,
      topics: z.array(bytes32),
      data: hex,
    },
    async ({ abi, topics, data }) => {
      const resolved = resolveAbi(abi);
      const decoded = decodeEventLog({
        abi: resolved,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
        data: data as `0x${string}`,
      });
      const args: Record<string, unknown> = {};
      if (decoded.args && typeof decoded.args === "object") {
        for (const [k, v] of Object.entries(decoded.args)) {
          args[k] = typeof v === "bigint" ? v.toString() : v;
        }
      }
      return JSON.stringify({ eventName: decoded.eventName, args }, null, 2);
    },
  );

  register(
    "simulate_transaction",
    "Simulate a transaction without broadcasting it. Calls eth_call against the populated tx. Returns success + return data, or a decoded revert reason on failure.",
    {
      from: address.optional(),
      to: address,
      data: hex.optional(),
      value: hex.optional(),
      gas: hex.optional(),
      block: z
        .union([z.string(), z.number(), z.enum(["latest", "pending", "safe", "finalized"])])
        .default("latest"),
    },
    async ({ from, to, data, value, gas, block }) => {
      const call: Record<string, string> = { to };
      if (from) call.from = from;
      if (data) call.data = data;
      if (value) call.value = value;
      if (gas) call.gas = gas;
      const tag =
        typeof block === "number" ? toHex(block) : (block as string);
      try {
        const result = await rpc.call<string>("eth_call", [call, tag]);
        return JSON.stringify({ success: true, returnData: result }, null, 2);
      } catch (err: any) {
        const revertData = err?.data && typeof err.data === "string" ? err.data : undefined;
        const reason = decodeRevert(revertData);
        return JSON.stringify(
          {
            success: false,
            error: err.message,
            revertReason: reason,
            revertData,
          },
          null,
          2,
        );
      }
    },
  );

  register(
    "build_erc20_transfer",
    "Build an unsigned ERC-20 transfer transaction. Amount is in token units (e.g. \"1.5\") — pass decimals if not the standard 18.",
    {
      token: address,
      from: address,
      to: address,
      amount: z.string(),
      decimals: z.number().int().min(0).max(36).default(18),
    },
    async ({ token, from, to, amount, decimals }) => {
      const amountWei = parseUnits(amount, decimals);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to as `0x${string}`, amountWei],
      });

      const call = { from, to: token, data };
      const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
      const gasHex = await rpc.call<string>("eth_estimateGas", [call]);
      const fees = await suggestFees(rpc);

      const tx = {
        type: "0x2",
        chainId: rpc.config.chainIdHex,
        nonce: nonceHex,
        to: token,
        value: "0x0",
        data,
        gas: gasHex,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        accessList: [],
        humanReadable: `transfer(${to}, ${amount}) on ${token}`,
      };
      return JSON.stringify(tx, null, 2);
    },
  );

  register(
    "build_erc20_approve",
    "Build an unsigned ERC-20 approve transaction. Amount in token units; pass \"max\" for unlimited approval.",
    {
      token: address,
      from: address,
      spender: address,
      amount: z.string(),
      decimals: z.number().int().min(0).max(36).default(18),
    },
    async ({ token, from, spender, amount, decimals }) => {
      const amountWei =
        amount === "max"
          ? (1n << 256n) - 1n
          : parseUnits(amount, decimals);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as `0x${string}`, amountWei],
      });

      const call = { from, to: token, data };
      const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
      const gasHex = await rpc.call<string>("eth_estimateGas", [call]);
      const fees = await suggestFees(rpc);

      const tx = {
        type: "0x2",
        chainId: rpc.config.chainIdHex,
        nonce: nonceHex,
        to: token,
        value: "0x0",
        data,
        gas: gasHex,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        accessList: [],
        humanReadable: `approve(${spender}, ${amount}) on ${token}`,
      };
      return JSON.stringify(tx, null, 2);
    },
  );

  register(
    "build_contract_write",
    "Generic builder: encode any contract function call into an unsigned EIP-1559 transaction.",
    {
      from: address,
      to: address,
      abi: abiInput,
      functionName: z.string(),
      args: z.array(z.any()).optional(),
      value: hex.optional(),
    },
    async ({ from, to, abi, functionName, args, value }) => {
      const resolved = resolveAbi(abi);
      const data = encodeFunctionData({
        abi: resolved,
        functionName,
        args: args ?? [],
      });
      const call: Record<string, string> = { from, to, data };
      if (value) call.value = value;
      const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
      const gasHex = await rpc.call<string>("eth_estimateGas", [call]);
      const fees = await suggestFees(rpc);

      const tx = {
        type: "0x2",
        chainId: rpc.config.chainIdHex,
        nonce: nonceHex,
        to,
        value: value ?? "0x0",
        data,
        gas: gasHex,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        accessList: [],
        humanReadable: `${functionName}(${(args ?? []).join(", ")}) on ${to}`,
      };
      return JSON.stringify(tx, null, 2);
    },
  );
}
