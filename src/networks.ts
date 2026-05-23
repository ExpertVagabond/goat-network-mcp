export interface NetworkConfig {
  name: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
  // 4-byte OP_RETURN prefix used to identify a deposit on Bitcoin L1.
  // Mainnet = "GOAT", Testnet3 = "GT3V".
  depositPrefix: string;
}

// ERC-8004 agent identity registries (network-specific addresses).
// CRITICAL: Use the ACTUAL linked registries discovered from on-chain storage.
// The reputation registry stores its linked identity registry in storage slot 0.
// On testnet3, agentkit's addresses.ts has the WRONG identity registry address.
// See issue: https://github.com/GOATNetwork/agentkit/issues/4
export const ERC8004_CONTRACTS: Record<string, { identityRegistry: string; reputationRegistry: string }> = {
  "GOAT Network Alpha Mainnet": {
    // Mainnet: verified correctly linked (reputation slot 0 matches this identity address)
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  "GOAT Network Testnet3": {
    // Testnet3: use the identity registry ACTUALLY linked to reputation (from slot 0)
    // This is 0x54b8... NOT 0x5560... (agentkit's incorrect address)
    identityRegistry: "0x54b8d8e2455946f2a5b8982283f2359812e815ce",
    reputationRegistry: "0xd9140951d8aE6E5F625a02F5908535e16e3af964",
  },
};

// Predeployed system contracts — identical addresses on mainnet and testnet3.
// Source: GOATNetwork/goat-contracts genesis/common/constants.ts
export const SYSTEM_CONTRACTS = {
  wgbtc: "0xbC10000000000000000000000000000000000000",
  goatToken: "0xbC10000000000000000000000000000000000001",
  goatFoundation: "0xBc10000000000000000000000000000000000002",
  bridge: "0xBC10000000000000000000000000000000000003",
  locking: "0xbC10000000000000000000000000000000000004",
  btcBlock: "0xbc10000000000000000000000000000000000005",
  relayer: "0xBC10000000000000000000000000000000000006",
  lockingTokenFactory: "0xBc10000000000000000000000000000000000007",
  goatDao: "0xBC10000000000000000000000000000000000Da0",
} as const;

export const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    name: "GOAT Network Alpha Mainnet",
    chainId: 2345,
    chainIdHex: "0x929",
    rpcUrl: "https://rpc.goat.network",
    explorerUrl: "https://explorer.goat.network",
    nativeSymbol: "BTC",
    nativeDecimals: 18,
    depositPrefix: "0x474f4154", // "GOAT"
  },
  testnet3: {
    name: "GOAT Network Testnet3",
    chainId: 48816,
    chainIdHex: "0xbeb0",
    rpcUrl: "https://rpc.testnet3.goat.network",
    explorerUrl: "https://explorer.testnet3.goat.network",
    nativeSymbol: "BTC",
    nativeDecimals: 18,
    depositPrefix: "0x47543356", // "GT3V"
  },
};

export function resolveNetwork(): NetworkConfig {
  const requested = (process.env.GOAT_NETWORK ?? "mainnet").toLowerCase();
  const base = NETWORKS[requested] ?? NETWORKS.mainnet;
  const rpcOverride = process.env.GOAT_RPC_URL;
  return rpcOverride ? { ...base, rpcUrl: rpcOverride } : base;
}
