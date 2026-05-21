/**
 * Bridge tools — GOAT Network BTC L1 ↔ L2 bridge integration.
 *
 * Bridge contract: 0xBC10000000000000000000000000000000000003 (mainnet + testnet3)
 * Source: github.com/GOATNetwork/goat-contracts (contracts/bridge/Bridge.sol)
 *
 * These tools are read-side helpers and unsigned-tx builders. They never hold
 * keys; users sign the returned tx in their own wallet, then broadcast via
 * send_raw_transaction.
 */

import { z } from "zod";
import {
  encodeFunctionData,
  parseAbi,
  type Abi,
} from "viem";
import type { RpcClient } from "../rpc.js";
import { fromHex, toHex } from "../rpc.js";
import { SYSTEM_CONTRACTS } from "../networks.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const BRIDGE_ABI = parseAbi([
  // Reads
  "function isDeposited(bytes32 txHash, uint32 txout) view returns (bool)",
  "function withdrawals(uint256) view returns (address sender, uint16 maxTxPrice, uint8 status, uint256 amount, uint256 tax, uint256 updatedAt)",
  "function depositParam() view returns (bytes4 prefix, uint64 min, uint16 taxRate, uint64 maxTax, uint16 confirmations)",
  "function withdrawParam() view returns (uint64 min, uint16 taxRate, uint64 maxTax)",
  // Writes (user-callable)
  "function withdraw(string receiver, uint16 maxTxPrice) payable",
  "function replaceByFee(uint256 id, uint16 maxTxPrice)",
  "function cancel1(uint256 id)",
  "function refund(uint256 id)",
]) as Abi;

const WITHDRAWAL_STATUS = [
  "Invalid",
  "Pending",
  "Canceling",
  "Canceled",
  "Refunded",
  "Paid",
] as const;

// 1 satoshi = 10 gwei on GOAT L2
const SATOSHI_WEI = 10_000_000_000n;
const DUST_WEI = 1000n * SATOSHI_WEI;
const BASE_TX_SIZE_WEI = 300n * SATOSHI_WEI;

function btcToWei(btc: string): bigint {
  // accept "0.001" style; convert to wei (18 decimals)
  const [whole, frac = ""] = btc.split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(whole || "0") * 10n ** 18n + BigInt(padded || "0");
  // round down to nearest satoshi (every BTC amount on L2 is a multiple of 1e10 wei)
  return (wei / SATOSHI_WEI) * SATOSHI_WEI;
}

function weiToBtc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
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

async function buildUnsignedTx(
  rpc: RpcClient,
  from: string,
  to: string,
  data: string,
  value: bigint,
  humanReadable: string,
): Promise<string> {
  const call: Record<string, string> = {
    from,
    to,
    data,
    value: "0x" + value.toString(16),
  };
  const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
  let gasHex: string;
  try {
    gasHex = await rpc.call<string>("eth_estimateGas", [call]);
  } catch (err: any) {
    // surface the revert reason cleanly — usually a min-amount or dust check failure
    throw new Error(`bridge call would revert: ${err.message}`);
  }
  const fees = await suggestFees(rpc);
  return JSON.stringify(
    {
      type: "0x2",
      chainId: rpc.config.chainIdHex,
      nonce: nonceHex,
      to,
      value: call.value,
      data,
      gas: gasHex,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      accessList: [],
      humanReadable,
    },
    null,
    2,
  );
}

export function registerBridgeTools(register: Register, rpc: RpcClient) {
  const BRIDGE = SYSTEM_CONTRACTS.bridge;

  register(
    "system_contracts",
    "Return all GOAT Network predeployed system contract addresses (bridge, wgBTC, goatToken, etc). These are identical on mainnet and testnet3.",
    {},
    async () => {
      return JSON.stringify(
        {
          ...SYSTEM_CONTRACTS,
          notes: {
            bridge: "BTC L1↔L2 bridge — accepts withdraw(), reads isDeposited()",
            wgbtc: "Wrapped GOAT Bitcoin — ERC-20 representation of native BTC",
            btcBlock: "Bitcoin block header relay (read recent BTC chain state)",
          },
        },
        null,
        2,
      );
    },
  );

  register(
    "bridge_deposit_op_return",
    "Generate the OP_RETURN payload for a Bitcoin L1 deposit. The user must include this 24-byte payload in their BTC transaction (alongside paying the federation multisig) for the bridge relayer to credit their L2 EVM address. Network-aware: uses 'GOAT' prefix on mainnet, 'GT3V' on testnet3.",
    {
      target: address.describe("L2 EVM address that will receive the bridged BTC"),
    },
    async ({ target }) => {
      const prefix = rpc.config.depositPrefix.slice(2).toLowerCase();
      const addr = target.slice(2).toLowerCase();
      const payload = "0x" + prefix + addr;
      return JSON.stringify(
        {
          opReturnHex: payload,
          bytes: payload.length / 2 - 1,
          prefix: rpc.config.depositPrefix,
          prefixAscii: Buffer.from(prefix, "hex").toString("ascii"),
          target,
          network: rpc.config.name,
          instructions:
            "Build a Bitcoin L1 transaction that (1) sends BTC to the GOAT federation deposit address and (2) includes one OP_RETURN output with the data above. Sign in your BTC wallet and broadcast on Bitcoin. The relayer will credit your L2 address after the required confirmations.",
        },
        null,
        2,
      );
    },
  );

  register(
    "bridge_deposit_status",
    "Check whether a Bitcoin L1 deposit has been credited on L2. Calls Bridge.isDeposited(txHash, txout).",
    {
      btcTxHash: txHash.describe("Bitcoin tx hash in little-endian hex (as stored on-chain)"),
      txout: z.number().int().nonnegative().describe("BTC tx output index"),
    },
    async ({ btcTxHash, txout }) => {
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "isDeposited",
        args: [btcTxHash as `0x${string}`, txout],
      });
      const result = await rpc.call<string>("eth_call", [{ to: BRIDGE, data }, "latest"]);
      const credited = BigInt(result) === 1n;
      return JSON.stringify(
        {
          txHash: btcTxHash,
          txout,
          credited,
          status: credited ? "deposit confirmed and credited on L2" : "not yet credited (still waiting for confirmations, or invalid)",
        },
        null,
        2,
      );
    },
  );

  register(
    "bridge_withdrawal_status",
    "Read the state of a withdrawal request by id. Returns sender, amount, tax, status (Invalid|Pending|Canceling|Canceled|Refunded|Paid), and timestamps.",
    {
      id: z.union([z.number().int().nonnegative(), z.string()]).describe("Withdrawal id from the Withdraw event"),
    },
    async ({ id }) => {
      const idNum = typeof id === "string" ? BigInt(id) : BigInt(id);
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "withdrawals",
        args: [idNum],
      });
      const raw = await rpc.call<string>("eth_call", [{ to: BRIDGE, data }, "latest"]);

      // The auto-generated getter returns a tuple of struct fields in declared order:
      // (address sender, uint16 maxTxPrice, uint8 status, uint256 amount, uint256 tax, uint256 updatedAt)
      // Each field is ABI-padded to 32 bytes, so the response is 6*32 = 192 bytes = 384 hex chars + "0x".
      const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
      const word = (n: number) => "0x" + hex.slice(n * 64, (n + 1) * 64);
      const sender = "0x" + hex.slice(64 - 40, 64);
      const maxTxPrice = Number(BigInt(word(1)));
      const statusIdx = Number(BigInt(word(2)));
      const amount = BigInt(word(3));
      const tax = BigInt(word(4));
      const updatedAt = Number(BigInt(word(5)));

      return JSON.stringify(
        {
          id: idNum.toString(),
          sender,
          status: WITHDRAWAL_STATUS[statusIdx] ?? `Unknown(${statusIdx})`,
          statusIndex: statusIdx,
          amountBtc: weiToBtc(amount),
          amountWei: amount.toString(),
          taxBtc: weiToBtc(tax),
          taxWei: tax.toString(),
          maxTxPriceSatPerVbyte: maxTxPrice,
          updatedAt: updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
        },
        null,
        2,
      );
    },
  );

  register(
    "bridge_params",
    "Read the bridge's current deposit and withdrawal parameters (min amounts, tax rates, confirmations required).",
    {},
    async () => {
      const depositData = encodeFunctionData({ abi: BRIDGE_ABI, functionName: "depositParam", args: [] });
      const withdrawData = encodeFunctionData({ abi: BRIDGE_ABI, functionName: "withdrawParam", args: [] });

      const [depositRaw, withdrawRaw] = await Promise.all([
        rpc.call<string>("eth_call", [{ to: BRIDGE, data: depositData }, "latest"]),
        rpc.call<string>("eth_call", [{ to: BRIDGE, data: withdrawData }, "latest"]),
      ]);

      // depositParam returns (bytes4 prefix, uint64 min, uint16 taxRate, uint64 maxTax, uint16 confirmations)
      // withdrawParam returns (uint64 min, uint16 taxRate, uint64 maxTax)
      const dHex = depositRaw.slice(2);
      const wHex = withdrawRaw.slice(2);
      const w = (h: string, n: number) => "0x" + h.slice(n * 64, (n + 1) * 64);

      const depositPrefix = "0x" + dHex.slice(0, 8); // first 4 bytes of the 32-byte slot
      const depositMin = BigInt(w(dHex, 1));
      const depositTaxRate = Number(BigInt(w(dHex, 2)));
      const depositMaxTax = BigInt(w(dHex, 3));
      const depositConfirmations = Number(BigInt(w(dHex, 4)));

      const withdrawMin = BigInt(w(wHex, 0));
      const withdrawTaxRate = Number(BigInt(w(wHex, 1)));
      const withdrawMaxTax = BigInt(w(wHex, 2));

      return JSON.stringify(
        {
          deposit: {
            opReturnPrefixHex: depositPrefix,
            opReturnPrefixAscii: Buffer.from(depositPrefix.slice(2), "hex").toString("ascii"),
            minBtc: weiToBtc(depositMin),
            taxRateBp: depositTaxRate,
            maxTaxBtc: depositMaxTax > 0n ? weiToBtc(depositMaxTax) : "no cap",
            confirmationsRequired: depositConfirmations,
          },
          withdraw: {
            minBtc: weiToBtc(withdrawMin),
            taxRateBp: withdrawTaxRate,
            maxTaxBtc: withdrawMaxTax > 0n ? weiToBtc(withdrawMaxTax) : "no cap",
          },
          constants: {
            satoshiInWei: SATOSHI_WEI.toString(),
            dustWei: DUST_WEI.toString(),
            baseTxSizeWei: BASE_TX_SIZE_WEI.toString(),
          },
        },
        null,
        2,
      );
    },
  );

  register(
    "build_bridge_withdraw",
    "Build an unsigned L2 transaction to withdraw BTC back to a Bitcoin L1 address. Calls Bridge.withdraw(receiver, maxTxPrice) with msg.value = amount (in wei). The user signs in their wallet and broadcasts via send_raw_transaction; the relayer pays out on L1 after consensus.",
    {
      from: address.describe("L2 EVM address initiating the withdrawal"),
      btcReceiver: z
        .string()
        .min(34)
        .max(90)
        .describe("Bitcoin L1 address that will receive the BTC (P2PKH, P2WPKH, P2WSH, or P2TR)"),
      amountBtc: z.string().describe("Amount of BTC to withdraw, in decimal BTC (e.g. \"0.005\"). Rounded down to the nearest satoshi."),
      maxTxPriceSatPerVbyte: z
        .number()
        .int()
        .positive()
        .max(65535)
        .describe("Max BTC fee rate willing to pay, in sat/vbyte. Higher = faster confirmation."),
    },
    async ({ from, btcReceiver, amountBtc, maxTxPriceSatPerVbyte }) => {
      const valueWei = btcToWei(amountBtc);
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "withdraw",
        args: [btcReceiver, maxTxPriceSatPerVbyte],
      });
      return buildUnsignedTx(
        rpc,
        from,
        BRIDGE,
        data,
        valueWei,
        `bridge.withdraw(${btcReceiver}, ${maxTxPriceSatPerVbyte} sat/vB) for ${amountBtc} BTC`,
      );
    },
  );

  register(
    "build_bridge_rbf",
    "Build an unsigned L2 transaction to bump the fee rate (RBF) of a pending bridge withdrawal. Only the original sender can call this, and only after WITHDRAWAL_UPDATED_DURATION (5 min) since the last update.",
    {
      from: address,
      withdrawalId: z.union([z.number().int().nonnegative(), z.string()]),
      newMaxTxPriceSatPerVbyte: z.number().int().positive().max(65535),
    },
    async ({ from, withdrawalId, newMaxTxPriceSatPerVbyte }) => {
      const id = typeof withdrawalId === "string" ? BigInt(withdrawalId) : BigInt(withdrawalId);
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "replaceByFee",
        args: [id, newMaxTxPriceSatPerVbyte],
      });
      return buildUnsignedTx(
        rpc,
        from,
        BRIDGE,
        data,
        0n,
        `bridge.replaceByFee(#${id}, ${newMaxTxPriceSatPerVbyte} sat/vB)`,
      );
    },
  );

  register(
    "build_bridge_cancel",
    "Build an unsigned L2 transaction to request cancellation of a pending bridge withdrawal. Status moves Pending → Canceling; the relayer then either rejects (cancel2 → Canceled) or pays out anyway.",
    {
      from: address,
      withdrawalId: z.union([z.number().int().nonnegative(), z.string()]),
    },
    async ({ from, withdrawalId }) => {
      const id = typeof withdrawalId === "string" ? BigInt(withdrawalId) : BigInt(withdrawalId);
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "cancel1",
        args: [id],
      });
      return buildUnsignedTx(
        rpc,
        from,
        BRIDGE,
        data,
        0n,
        `bridge.cancel1(#${id})`,
      );
    },
  );

  register(
    "build_bridge_refund",
    "Build an unsigned L2 transaction to claim a refund for a Canceled withdrawal. Returns amount + tax to the original sender. Only callable after status reaches Canceled (the relayer must have approved via cancel2).",
    {
      from: address,
      withdrawalId: z.union([z.number().int().nonnegative(), z.string()]),
    },
    async ({ from, withdrawalId }) => {
      const id = typeof withdrawalId === "string" ? BigInt(withdrawalId) : BigInt(withdrawalId);
      const data = encodeFunctionData({
        abi: BRIDGE_ABI,
        functionName: "refund",
        args: [id],
      });
      return buildUnsignedTx(
        rpc,
        from,
        BRIDGE,
        data,
        0n,
        `bridge.refund(#${id})`,
      );
    },
  );
}
