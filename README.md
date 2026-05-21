<p align="center">
  <img src="logo.png" alt="GOAT Network" width="420">
</p>

# goat-network-mcp

MCP server for [GOAT Network](https://www.goat.network) — the BitVM-based Bitcoin L2. EVM-compatible JSON-RPC access (blocks, transactions, balances, contract reads, logs, fee history) for any AI agent.

## Networks

| Network                       | Chain ID | RPC                                | Explorer                              |
| ----------------------------- | -------- | ---------------------------------- | ------------------------------------- |
| GOAT Network Alpha Mainnet    | 2345     | https://rpc.goat.network           | https://explorer.goat.network         |
| GOAT Network Testnet3         | 48816    | https://rpc.testnet3.goat.network  | https://explorer.testnet3.goat.network|

Native token: **BTC** (18 decimals, wei-style).

## Install

```bash
npm install -g @psmedia/goat-network-mcp
```

Or run from source:

```bash
git clone https://github.com/ExpertVagabond/goat-network-mcp
cd goat-network-mcp
npm install
npm run build
node dist/index.js
```

## Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "goat-network": {
      "command": "npx",
      "args": ["-y", "@psmedia/goat-network-mcp"],
      "env": {
        "GOAT_NETWORK": "mainnet"
      }
    }
  }
}
```

## Environment

| Variable        | Default   | Description                                              |
| --------------- | --------- | -------------------------------------------------------- |
| `GOAT_NETWORK`  | `mainnet` | `mainnet` or `testnet3`                                  |
| `GOAT_RPC_URL`  | —         | Override the RPC endpoint (e.g. a private/paid node)     |

## Tools

### Chain
- **`get_chain_info`** — chain ID, latest block, gas price, network metadata
- **`get_block`** — block by number or tag (`latest`, `safe`, `finalized`, …)
- **`get_block_by_hash`** — block by hash
- **`get_gas_price`** — current gas price in wei
- **`get_fee_history`** — EIP-1559 base fees and reward percentiles

### Accounts
- **`get_balance`** — native BTC balance (returns decimal and wei)
- **`get_transaction_count`** — nonce
- **`get_code`** — contract bytecode
- **`get_storage_at`** — read a storage slot

### Transactions
- **`get_transaction`** — tx by hash
- **`get_transaction_receipt`** — receipt with status + logs
- **`send_raw_transaction`** — broadcast a pre-signed raw tx (MCP does **not** sign)

### Contracts
- **`eth_call`** — read-only contract call
- **`estimate_gas`** — gas estimate for a call
- **`get_logs`** — event log filter

### Explorer
- **`explorer_link`** — build an explorer URL for a tx, address, or block

## Security

This MCP is **read-mostly**. The only write surface is `send_raw_transaction`, which broadcasts a transaction you already signed elsewhere — the server never holds keys. Run it under whatever sandbox your MCP host provides.

## License

MIT © Purple Squirrel Media
