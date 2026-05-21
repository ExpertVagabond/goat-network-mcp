export interface NetworkConfig {
  name: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    name: "GOAT Network Alpha Mainnet",
    chainId: 2345,
    chainIdHex: "0x929",
    // (lowercase per JSON-RPC convention; matches eth_chainId response)
    rpcUrl: "https://rpc.goat.network",
    explorerUrl: "https://explorer.goat.network",
    nativeSymbol: "BTC",
    nativeDecimals: 18,
  },
  testnet3: {
    name: "GOAT Network Testnet3",
    chainId: 48816,
    chainIdHex: "0xbeb0",
    rpcUrl: "https://rpc.testnet3.goat.network",
    explorerUrl: "https://explorer.testnet3.goat.network",
    nativeSymbol: "BTC",
    nativeDecimals: 18,
  },
};

export function resolveNetwork(): NetworkConfig {
  const requested = (process.env.GOAT_NETWORK ?? "mainnet").toLowerCase();
  const base = NETWORKS[requested] ?? NETWORKS.mainnet;
  const rpcOverride = process.env.GOAT_RPC_URL;
  return rpcOverride ? { ...base, rpcUrl: rpcOverride } : base;
}
