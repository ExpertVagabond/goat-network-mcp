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
// Source: GOATNetwork/agentkit plugins/erc8004/addresses.ts
export const ERC8004_CONTRACTS: Record<string, { identityRegistry: string; reputationRegistry: string }> = {
  "GOAT Network Alpha Mainnet": {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  "GOAT Network Testnet3": {
    identityRegistry: "0x556089008Fc0a60cD09390Eca93477ca254A5522",
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
