/**
 * ERC-8004 agent identity tools.
 *
 * ERC-8004 standardises three on-chain registries for AI agents:
 *   - Identity Registry — ERC-721 NFT representing an agent's identity
 *   - Reputation Registry — feedback / reputation signals
 *   - Validation Registry — validator hooks (not deployed on GOAT yet)
 *
 * Source: eips.ethereum.org/EIPS/eip-8004
 * Contract addresses (GOAT): GOATNetwork/agentkit plugins/erc8004/addresses.ts
 *
 * All tools are read-side or build-only — no key custody.
 */

import { z } from "zod";
import { encodeFunctionData, parseAbi, type Abi } from "viem";
import type { RpcClient } from "../rpc.js";
import { toHex } from "../rpc.js";
import { ERC8004_CONTRACTS } from "../networks.js";

type Register = (
  name: string,
  description: string,
  shape: Record<string, z.ZodType>,
  handler: (args: any) => Promise<string>,
) => void;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const IDENTITY_ABI = parseAbi([
  // Writes
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  // Reads (ERC-721 + ERC-8004)
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function totalSupply() view returns (uint256)",
]) as Abi;

const REPUTATION_ABI = parseAbi([
  // Writes
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function revokeFeedback(uint256 agentId, uint64 feedbackIndex)",
  // Reads
  "function getClients(uint256 agentId) view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]) as Abi;

function getContracts(rpc: RpcClient) {
  const entry = ERC8004_CONTRACTS[rpc.config.name];
  if (!entry) {
    throw new Error(
      `ERC-8004 registries not configured for network "${rpc.config.name}". ` +
        `Set GOAT_NETWORK=mainnet or testnet3.`,
    );
  }
  return entry;
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

async function buildUnsignedTx(
  rpc: RpcClient,
  from: string,
  to: string,
  data: string,
  humanReadable: string,
): Promise<string> {
  const call = { from, to, data, value: "0x0" };
  const nonceHex = await rpc.call<string>("eth_getTransactionCount", [from, "pending"]);
  let gasHex: string;
  try {
    gasHex = await rpc.call<string>("eth_estimateGas", [call]);
  } catch (err: any) {
    throw new Error(`call would revert: ${err.message}`);
  }
  const fees = await suggestFees(rpc);
  return JSON.stringify(
    {
      type: "0x2",
      chainId: rpc.config.chainIdHex,
      nonce: nonceHex,
      to,
      value: "0x0",
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

export function registerErc8004Tools(register: Register, rpc: RpcClient) {
  register(
    "agent_identity_addresses",
    "Return the ERC-8004 Identity Registry and Reputation Registry contract addresses for the current network.",
    {},
    async () => {
      const c = getContracts(rpc);
      return JSON.stringify(
        {
          network: rpc.config.name,
          identityRegistry: c.identityRegistry,
          reputationRegistry: c.reputationRegistry,
          notes: {
            identityRegistry: "ERC-721 registry — each agent is a transferable NFT. tokenURI points to the agent's metadata JSON.",
            reputationRegistry: "Stores feedback signals from clients about agents.",
          },
        },
        null,
        2,
      );
    },
  );

  register(
    "agent_lookup",
    "Look up an agent by its ERC-8004 agentId. Returns owner, tokenURI (off-chain metadata pointer), and the agent's operating wallet address.",
    {
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
    },
    async ({ agentId }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);

      const [ownerData, uriData, walletData] = await Promise.all([
        rpc.call<string>("eth_call", [
          { to: c.identityRegistry, data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: "ownerOf", args: [id] }) },
          "latest",
        ]),
        rpc.call<string>("eth_call", [
          { to: c.identityRegistry, data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: "tokenURI", args: [id] }) },
          "latest",
        ]),
        rpc.call<string>("eth_call", [
          { to: c.identityRegistry, data: encodeFunctionData({ abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [id] }) },
          "latest",
        ]).catch(() => null),
      ]);

      const owner = "0x" + ownerData.slice(2).slice(-40);

      // Decode the tokenURI string (ABI: offset, length, data)
      const decodeString = (raw: string): string => {
        const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
        if (hex.length < 128) return "";
        const len = Number(BigInt("0x" + hex.slice(64, 128)));
        const strHex = hex.slice(128, 128 + len * 2);
        return Buffer.from(strHex, "hex").toString("utf8");
      };

      const tokenURI = decodeString(uriData);
      const agentWallet = walletData
        ? "0x" + walletData.slice(2).slice(-40)
        : null;

      return JSON.stringify(
        {
          agentId: id.toString(),
          owner,
          tokenURI,
          agentWallet,
          registry: c.identityRegistry,
          network: rpc.config.name,
        },
        null,
        2,
      );
    },
  );

  register(
    "agent_get_metadata",
    "Read a specific metadata entry for an agent from the ERC-8004 Identity Registry. Returns the raw bytes value (may need application-specific decoding).",
    {
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      metadataKey: z.string().min(1),
    },
    async ({ agentId, metadataKey }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: IDENTITY_ABI,
        functionName: "getMetadata",
        args: [id, metadataKey],
      });
      const raw = await rpc.call<string>("eth_call", [{ to: c.identityRegistry, data }, "latest"]);
      const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
      let value: string = raw;
      let asUtf8: string | null = null;
      if (hex.length >= 128) {
        const len = Number(BigInt("0x" + hex.slice(64, 128)));
        const bytesHex = hex.slice(128, 128 + len * 2);
        value = "0x" + bytesHex;
        const buf = Buffer.from(bytesHex, "hex");
        if (buf.every((b) => b >= 0x20 && b < 0x7f) || buf.toString("utf8").trim().length > 0) {
          asUtf8 = buf.toString("utf8");
        }
      }
      return JSON.stringify(
        { agentId: id.toString(), metadataKey, valueHex: value, valueUtf8: asUtf8 },
        null,
        2,
      );
    },
  );

  register(
    "agent_get_reputation",
    "Read aggregate reputation for an agent from the ERC-8004 Reputation Registry. Returns count of feedbacks plus a summary value (e.g. average rating). Optional tags filter for category/aspect-specific scoring.",
    {
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      clientAddresses: z.array(address).default([]).describe("Optional client allowlist — empty = all clients"),
      tag1: z.string().default("").describe("Optional tag filter (e.g. 'quality')"),
      tag2: z.string().default("").describe("Optional second tag filter"),
    },
    async ({ agentId, clientAddresses, tag1, tag2 }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: REPUTATION_ABI,
        functionName: "getSummary",
        args: [id, clientAddresses, tag1, tag2],
      });
      const raw = await rpc.call<string>("eth_call", [{ to: c.reputationRegistry, data }, "latest"]);
      const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
      const count = BigInt("0x" + hex.slice(0, 64));
      // int128 — handle two's complement
      let summaryRaw = BigInt("0x" + hex.slice(64, 128));
      if (summaryRaw >= 1n << 127n) summaryRaw -= 1n << 128n;
      const decimals = Number(BigInt("0x" + hex.slice(128, 192)));
      const scaled = decimals > 0 ? Number(summaryRaw) / 10 ** decimals : Number(summaryRaw);
      return JSON.stringify(
        {
          agentId: id.toString(),
          count: count.toString(),
          summaryRaw: summaryRaw.toString(),
          summaryValueDecimals: decimals,
          summaryValue: scaled,
          tags: [tag1, tag2].filter(Boolean),
        },
        null,
        2,
      );
    },
  );

  register(
    "agent_get_clients",
    "List the client addresses that have given feedback for a specific agent.",
    {
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
    },
    async ({ agentId }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: REPUTATION_ABI,
        functionName: "getClients",
        args: [id],
      });
      const raw = await rpc.call<string>("eth_call", [{ to: c.reputationRegistry, data }, "latest"]);
      const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
      // ABI decode address[]: offset(32) + length(32) + N * 32-byte addresses
      if (hex.length < 128) {
        return JSON.stringify({ agentId: id.toString(), clients: [] }, null, 2);
      }
      const length = Number(BigInt("0x" + hex.slice(64, 128)));
      const clients: string[] = [];
      for (let i = 0; i < length; i++) {
        const start = 128 + i * 64;
        clients.push("0x" + hex.slice(start + 24, start + 64));
      }
      return JSON.stringify({ agentId: id.toString(), clients, count: length }, null, 2);
    },
  );

  register(
    "build_agent_register",
    "Build an unsigned tx to register a new agent in the ERC-8004 Identity Registry. The agentURI must be a publicly accessible URL pointing to the agent's metadata JSON (e.g. https://example.com/agent.json) — not raw JSON.",
    {
      from: address,
      agentURI: z.string().min(1).url(),
    },
    async ({ from, agentURI }) => {
      const c = getContracts(rpc);
      const data = encodeFunctionData({
        abi: IDENTITY_ABI,
        functionName: "register",
        args: [agentURI],
      });
      return buildUnsignedTx(rpc, from, c.identityRegistry, data, `register("${agentURI}")`);
    },
  );

  register(
    "build_agent_set_uri",
    "Build an unsigned tx to update an existing agent's URI (the metadata pointer).",
    {
      from: address,
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      newURI: z.string().min(1).url(),
    },
    async ({ from, agentId, newURI }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: IDENTITY_ABI,
        functionName: "setAgentURI",
        args: [id, newURI],
      });
      return buildUnsignedTx(rpc, from, c.identityRegistry, data, `setAgentURI(${id}, "${newURI}")`);
    },
  );

  register(
    "build_agent_set_metadata",
    "Build an unsigned tx to set an arbitrary metadata entry on an agent. Value is hex-encoded bytes.",
    {
      from: address,
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      metadataKey: z.string().min(1),
      metadataValueHex: z.string().regex(/^0x[0-9a-fA-F]*$/),
    },
    async ({ from, agentId, metadataKey, metadataValueHex }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: IDENTITY_ABI,
        functionName: "setMetadata",
        args: [id, metadataKey, metadataValueHex as `0x${string}`],
      });
      return buildUnsignedTx(rpc, from, c.identityRegistry, data, `setMetadata(${id}, "${metadataKey}", ${metadataValueHex})`);
    },
  );

  register(
    "build_agent_give_feedback",
    "Build an unsigned tx to give reputation feedback for an agent. value+decimals encode a signed rating (e.g. value=475 decimals=2 → 4.75). tags categorise the feedback; feedbackURI points to longer-form review JSON.",
    {
      from: address,
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      value: z.union([z.number(), z.string()]).describe("int128 signed value (can be negative)"),
      valueDecimals: z.number().int().min(0).max(18).default(2),
      tag1: z.string().default(""),
      tag2: z.string().default(""),
      endpoint: z.string().default(""),
      feedbackURI: z.string().default(""),
      feedbackHash: bytes32.default("0x" + "0".repeat(64)),
    },
    async ({ from, agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const v = typeof value === "string" ? BigInt(value) : BigInt(value);
      const data = encodeFunctionData({
        abi: REPUTATION_ABI,
        functionName: "giveFeedback",
        args: [id, v, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash as `0x${string}`],
      });
      return buildUnsignedTx(rpc, from, c.reputationRegistry, data, `giveFeedback(${id}, ${v}/10^${valueDecimals})`);
    },
  );

  register(
    "build_agent_revoke_feedback",
    "Build an unsigned tx to revoke a previously-given feedback. feedbackIndex is the position in the caller's feedback array for this agent.",
    {
      from: address,
      agentId: z.union([z.number().int().nonnegative(), z.string()]),
      feedbackIndex: z.number().int().nonnegative(),
    },
    async ({ from, agentId, feedbackIndex }) => {
      const c = getContracts(rpc);
      const id = typeof agentId === "string" ? BigInt(agentId) : BigInt(agentId);
      const data = encodeFunctionData({
        abi: REPUTATION_ABI,
        functionName: "revokeFeedback",
        args: [id, BigInt(feedbackIndex)],
      });
      return buildUnsignedTx(rpc, from, c.reputationRegistry, data, `revokeFeedback(${id}, ${feedbackIndex})`);
    },
  );
}
