/**
 * agentkit-wrap — register every WalletProvider-based action from
 * @goatnetwork/agentkit as an MCP tool.
 *
 * Strategy: our MCP never holds keys, so the WalletProvider we hand to each
 * action implements reads against our RpcClient and converts every write
 * (writeContract, transferErc20, deployContract, etc.) into a thrown
 * `UnsignedTxEmission` carrying a fully-populated EIP-1559 unsigned tx.
 * The wrapper catches that, and the MCP tool returns the tx as JSON.
 *
 * Result: an agent can call e.g. `wgbtcWrapAction` and get back the unsigned
 * tx to sign in its wallet, even though the action thinks it's calling
 * `walletProvider.writeContract(...)`.
 */

import { z } from "zod";
import {
  encodeFunctionData,
  decodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  type Abi,
} from "viem";
import type { RpcClient } from "./rpc.js";
import { toHex } from "./rpc.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

class UnsignedTxEmission extends Error {
  constructor(public unsignedTx: Record<string, unknown>) {
    super("UNSIGNED_TX_EMISSION");
  }
}

function agentkitNetwork(rpc: RpcClient): string {
  return rpc.config.chainId === 2345 ? "goat-mainnet" : "goat-testnet";
}

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
        : 1_000_000_000n;
    return {
      maxFeePerGas: "0x" + (baseFee * 2n + tip).toString(16),
      maxPriorityFeePerGas: "0x" + tip.toString(16),
    };
  } catch {
    const gp = await rpc.call<string>("eth_gasPrice", []);
    return { maxFeePerGas: gp, maxPriorityFeePerGas: gp };
  }
}

class BuildOnlyEvmProvider {
  // The default sender used when an action doesn't supply one explicitly.
  // Can be overridden per-invocation via the agent's input.
  constructor(
    private rpc: RpcClient,
    public defaultFrom: string = "0x0000000000000000000000000000000000000000",
  ) {}

  setFrom(addr: string) {
    this.defaultFrom = addr;
  }

  async getAddress(): Promise<string> {
    return this.defaultFrom;
  }

  async getNetwork(): Promise<string> {
    return agentkitNetwork(this.rpc);
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address ?? this.defaultFrom;
    const hex = await this.rpc.call<string>("eth_getBalance", [addr, "latest"]);
    return BigInt(hex).toString();
  }

  async getErc20Balance(token: string, owner?: string): Promise<string> {
    const who = owner ?? this.defaultFrom;
    const data = encodeFunctionData({
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [who as `0x${string}`],
    });
    const result = await this.rpc.call<string>("eth_call", [{ to: token, data }, "latest"]);
    return BigInt(result).toString();
  }

  async callContract(
    contractAddress: string,
    abi: string[],
    functionName: string,
    args: unknown[],
  ): Promise<unknown> {
    const parsed = parseAbi(abi) as Abi;
    const data = encodeFunctionData({ abi: parsed, functionName, args: args as any });
    const result = await this.rpc.call<string>("eth_call", [
      { to: contractAddress, data },
      "latest",
    ]);
    const fn = parsed.find((x: any) => x.type === "function" && x.name === functionName) as any;
    if (!fn?.outputs?.length) return result;
    try {
      const decoded = decodeAbiParameters(fn.outputs, result as `0x${string}`);
      return decoded.length === 1 ? decoded[0] : decoded;
    } catch {
      return result;
    }
  }

  private async buildUnsigned(
    to: string,
    data: string,
    value: string,
    humanReadable: string,
  ): Promise<never> {
    const call: Record<string, string> = { from: this.defaultFrom, to, data, value };
    const nonceHex = await this.rpc.call<string>("eth_getTransactionCount", [this.defaultFrom, "pending"]);
    let gasHex: string;
    try {
      gasHex = await this.rpc.call<string>("eth_estimateGas", [call]);
    } catch (err: any) {
      throw new Error(`call would revert: ${err.message}`);
    }
    const fees = await suggestFees(this.rpc);
    throw new UnsignedTxEmission({
      type: "0x2",
      chainId: this.rpc.config.chainIdHex,
      nonce: nonceHex,
      to,
      value,
      data,
      gas: gasHex,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      accessList: [],
      humanReadable,
    });
  }

  async transferNative(to: string, amountWei: string): Promise<{ txHash: string }> {
    await this.buildUnsigned(to, "0x", "0x" + BigInt(amountWei).toString(16), `transfer ${amountWei} wei → ${to}`);
    throw new Error("unreachable");
  }

  async transferErc20(token: string, to: string, amount: string): Promise<{ txHash: string }> {
    const data = encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
      functionName: "transfer",
      args: [to as `0x${string}`, BigInt(amount)],
    });
    await this.buildUnsigned(token, data, "0x0", `erc20 transfer(${to}, ${amount}) on ${token}`);
    throw new Error("unreachable");
  }

  async approveErc20(token: string, spender: string, amount: string): Promise<{ txHash: string }> {
    const data = encodeFunctionData({
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [spender as `0x${string}`, BigInt(amount)],
    });
    await this.buildUnsigned(token, data, "0x0", `erc20 approve(${spender}, ${amount}) on ${token}`);
    throw new Error("unreachable");
  }

  async signTypedData(): Promise<string> {
    throw new Error(
      "build-only MCP: signTypedData is not supported. Sign with your wallet externally, then submit the signature via the appropriate broadcast tool.",
    );
  }

  async writeContract(
    contractAddress: string,
    abi: string[],
    functionName: string,
    args: unknown[],
    value?: string,
  ): Promise<{ txHash: string }> {
    const parsed = parseAbi(abi) as Abi;
    const data = encodeFunctionData({ abi: parsed, functionName, args: args as any });
    const v = value ? "0x" + BigInt(value).toString(16) : "0x0";
    await this.buildUnsigned(contractAddress, data, v, `${functionName}(...) on ${contractAddress}`);
    throw new Error("unreachable");
  }

  async deployContract(
    _abi: string[],
    bytecode: string,
    args: unknown[] = [],
    value?: string,
  ): Promise<{ txHash: string; contractAddress: string }> {
    // For deploy, the data is bytecode + constructor args
    let data = bytecode.startsWith("0x") ? bytecode : "0x" + bytecode;
    if (args.length > 0) {
      // We need the constructor abi to encode args. For now, accept hex-encoded args appended.
      // Most callers will pre-encode; if they pass raw args we can't encode without the constructor inputs spec.
      data = data + (args[0] as string).replace(/^0x/, "");
    }
    const v = value ? "0x" + BigInt(value).toString(16) : "0x0";
    const call: Record<string, string> = { from: this.defaultFrom, data, value: v };
    const nonceHex = await this.rpc.call<string>("eth_getTransactionCount", [this.defaultFrom, "pending"]);
    let gasHex: string;
    try {
      gasHex = await this.rpc.call<string>("eth_estimateGas", [call]);
    } catch (err: any) {
      throw new Error(`deploy estimate reverted: ${err.message}`);
    }
    const fees = await suggestFees(this.rpc);
    throw new UnsignedTxEmission({
      type: "0x2",
      chainId: this.rpc.config.chainIdHex,
      nonce: nonceHex,
      to: null,
      value: v,
      data,
      gas: gasHex,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      accessList: [],
      humanReadable: `deployContract (${data.length / 2 - 1} bytes)`,
    });
  }
}

/**
 * Determine which adapter an action factory needs based on its name.
 */
function getAdapterType(exportName: string): "wallet" | "faucet" | "merchant" | "x402payment" {
  const lower = exportName.toLowerCase();
  if (lower.startsWith("faucet")) return "faucet";
  if (lower.startsWith("merchant")) return "merchant";
  // X402 payment actions: cancelPayment, createPayment, paymentStatus, transferPayment, submitSignature
  if (lower.includes("payment") || lower.includes("submitsignature")) return "x402payment";
  return "wallet";
}

/**
 * Register every action from @goatnetwork/agentkit as an MCP tool.
 * Supports wallet-based actions, faucet actions (if GOAT_FAUCET_URL is set),
 * and X402 merchant actions (if GOAT_X402_URL is set).
 * Returns the count and the list of skipped names with reasons.
 */
export async function registerAgentkitWalletActions(
  register: Register,
  rpc: RpcClient,
): Promise<{ registered: number; skipped: Array<{ name: string; reason: string }> }> {
  let agentkit: any;
  try {
    agentkit = await import("@goatnetwork/agentkit");
  } catch (err: any) {
    return {
      registered: 0,
      skipped: [
        {
          name: "*",
          reason: `agentkit import failed (run scripts/fix-agentkit-esm.mjs first): ${err.message}`,
        },
      ],
    };
  }

  const wallet = new BuildOnlyEvmProvider(rpc);
  const skipped: Array<{ name: string; reason: string }> = [];
  let registered = 0;

  // Optional faucet adapter (requires GOAT_FAUCET_URL)
  let faucetAdapter: any = null;
  const faucetUrl = process.env.GOAT_FAUCET_URL;
  if (faucetUrl && agentkit.HttpFaucetAdapter) {
    try {
      faucetAdapter = new agentkit.HttpFaucetAdapter(faucetUrl);
    } catch (err: any) {
      skipped.push({ name: "faucet.*", reason: `faucet adapter init failed: ${err.message}` });
    }
  }

  // Optional X402 merchant client (requires GOAT_X402_URL)
  let merchantClient: any = null;
  const x402Url = process.env.GOAT_X402_URL;
  if (x402Url && agentkit.HttpMerchantPortalClient) {
    try {
      merchantClient = new agentkit.HttpMerchantPortalClient(x402Url, {
        accessToken: process.env.GOAT_X402_TOKEN,
      });
    } catch (err: any) {
      skipped.push({ name: "x402.*", reason: `x402 client init failed: ${err.message}` });
    }
  }

  for (const [exportName, factory] of Object.entries(agentkit)) {
    if (!exportName.endsWith("Action") || typeof factory !== "function") continue;

    const adapterType = getAdapterType(exportName);
    let adapter: any;

    // Select the appropriate adapter
    switch (adapterType) {
      case "faucet":
        if (!faucetAdapter) {
          skipped.push({ name: exportName, reason: "set GOAT_FAUCET_URL to enable faucet tools" });
          continue;
        }
        adapter = faucetAdapter;
        break;
      case "merchant":
        if (!merchantClient) {
          skipped.push({ name: exportName, reason: "set GOAT_X402_URL to enable X402 merchant tools" });
          continue;
        }
        adapter = merchantClient;
        break;
      case "x402payment":
        // X402 payment actions may need both wallet and merchant client
        if (!merchantClient) {
          skipped.push({ name: exportName, reason: "set GOAT_X402_URL to enable X402 payment tools" });
          continue;
        }
        adapter = { wallet, merchant: merchantClient };
        break;
      default:
        adapter = wallet;
    }

    let action: any;
    try {
      action = (factory as Function)(adapter);
    } catch (err: any) {
      skipped.push({ name: exportName, reason: `factory failed: ${err.message.slice(0, 60)}` });
      continue;
    }

    if (!action || typeof action !== "object" || !action.name) {
      skipped.push({ name: exportName, reason: "factory returned non-action" });
      continue;
    }

    // Skip if the network filter excludes us
    if (Array.isArray(action.networks) && action.networks.length > 0) {
      const ours = agentkitNetwork(rpc);
      if (!action.networks.includes(ours)) {
        skipped.push({ name: action.name, reason: `not on ${ours}` });
        continue;
      }
    }

    // Extract the input shape. We support: zodInputSchema (ZodObject) or no schema.
    let shape: Record<string, z.ZodType> = {};
    if (action.zodInputSchema && typeof action.zodInputSchema === "object") {
      const zs = action.zodInputSchema as any;
      if (zs.shape && typeof zs.shape === "object") {
        shape = zs.shape;
      } else if (zs._def?.shape && typeof zs._def.shape === "function") {
        shape = zs._def.shape();
      }
    }

    // Add a per-call 'from' arg for actions that need a sender (writes).
    // The action ignores extra fields; we use it to set the wallet's defaultFrom.
    const augmentedShape: Record<string, z.ZodType> = {
      ...shape,
      from: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional()
        .describe("Sender address (required for write actions; ignored for reads)"),
    };

    const description = `[agentkit] ${action.description ?? action.name} (risk: ${action.riskLevel ?? "unknown"})`;

    register(action.name, description, augmentedShape, async (input: any) => {
      const { from, ...actionInput } = input ?? {};
      if (from) wallet.setFrom(from);

      const ctx = {
        network: agentkitNetwork(rpc),
        traceId: `mcp-${Date.now()}`,
        now: Date.now(),
        signal: new AbortController().signal,
      };

      try {
        const result = await action.execute(ctx, actionInput);
        return typeof result === "string" ? result : JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
      } catch (err: any) {
        if (err instanceof UnsignedTxEmission) {
          return JSON.stringify(err.unsignedTx, null, 2);
        }
        throw err;
      }
    });

    registered++;
  }

  return { registered, skipped };
}
