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
npm install -g @purplesquirrel/goat-network-mcp
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
      "args": ["-y", "@purplesquirrel/goat-network-mcp"],
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

### Bridge (v0.3.0 — GOAT-native BTC L1↔L2)

The bridge contract lives at `0xBC10000000000000000000000000000000000003` on both mainnet and testnet3.

- **`system_contracts`** — return the full predeployed system contract table (bridge, wgBTC, goatToken, btcBlock relay, …)
- **`bridge_deposit_op_return`** — generate the OP_RETURN payload for a BTC L1 deposit (network-aware: `GOAT` on mainnet, `GT3V` on testnet3)
- **`bridge_deposit_status`** — call `isDeposited(txHash, txout)` to verify a BTC deposit has been credited
- **`bridge_withdrawal_status`** — read a withdrawal by id; returns status (`Pending`/`Canceling`/`Canceled`/`Refunded`/`Paid`), amount, tax, BTC fee rate
- **`bridge_params`** — live deposit/withdrawal limits, tax rates, confirmation requirements
- **`build_bridge_withdraw`** — build unsigned L2 tx calling `withdraw(btcReceiver, maxTxPriceSatPerVbyte)` with the BTC amount as msg.value
- **`build_bridge_rbf`** — bump fee rate on a pending withdrawal
- **`build_bridge_cancel`** — request cancellation (`cancel1`)
- **`build_bridge_refund`** — claim refund after relayer-approved cancellation

### Build / Write (v0.2.0 — no key custody)
- **`build_transaction`** — auto-fill an unsigned EIP-1559 tx (nonce, gas, fees, chainId) ready for an external wallet to sign
- **`encode_function_data`** — ABI-encode a function call (accepts JSON ABI or human-readable signature)
- **`decode_function_data`** — decode calldata back to `{functionName, args}`
- **`decode_event_log`** — decode a raw event log into the event name + named arguments
- **`simulate_transaction`** — dry-run via `eth_call`; returns success or a decoded revert reason
- **`build_erc20_transfer`** — one-shot ERC-20 transfer builder (accepts decimal amount + decimals)
- **`build_erc20_approve`** — ERC-20 approve builder; pass `"max"` for unlimited allowance
- **`build_contract_write`** — generic write builder for any contract function

Sign the returned tx in your wallet (MetaMask/Phantom/Ledger/etc), then broadcast the signed hex via `send_raw_transaction`. The MCP never holds keys.

## Security

This MCP is **read-mostly**. The only write surface is `send_raw_transaction`, which broadcasts a transaction you already signed elsewhere — the server never holds keys. Run it under whatever sandbox your MCP host provides.

## License

MIT © Purple Squirrel Media
