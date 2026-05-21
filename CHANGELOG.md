# Changelog

All notable changes to `@purplesquirrel/goat-network-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-05-21

### Added

**Wraps the entire `@goatnetwork/agentkit` action surface as MCP tools.** Total tool count jumps from 33 → 136 (43 native + 93 from agentkit).

- **`src/agentkit-wrap.ts`** — `BuildOnlyEvmProvider` wallet provider that satisfies agentkit's `WalletProvider` interface. Reads route through our `RpcClient`; every write call throws a typed `UnsignedTxEmission` carrying a fully-populated EIP-1559 unsigned tx, which our wrapper surfaces as the tool response. Net effect: every agentkit action that needs a wallet works *without* the MCP ever holding keys.
- **93 wrapped agentkit actions** registered under their native namespaces (`erc8004.*`, `dex.*`, `bridge.*`, `goat.bitvm2.*`, `goat.x402.*`, `wallet.*`, `wgbtc.*`, `goat_token.*`, `oft.*`, `bitcoin.*`, `erc721.*`).
- **`src/tools/erc8004.ts`** — 10 native ERC-8004 tools (parallel to the agentkit `erc8004.*` set; ours run independent of the agentkit dep, providing redundancy and a different surface):
  - `agent_identity_addresses`, `agent_lookup`, `agent_get_metadata`, `agent_get_reputation`, `agent_get_clients`
  - `build_agent_register`, `build_agent_set_uri`, `build_agent_set_metadata`, `build_agent_give_feedback`, `build_agent_revoke_feedback`
- ERC-8004 contract addresses added to `networks.ts` (`ERC8004_CONTRACTS`): identity + reputation registries for mainnet and testnet3, source from `GOATNetwork/agentkit plugins/erc8004/addresses.ts`.

### Fixed (upstream workaround)

- **`@goatnetwork/agentkit@0.1.2` ships broken** — every internal import in `dist/` is extensionless, which Node ESM rejects. Filed upstream as [issue #2](https://github.com/GOATNetwork/agentkit/issues/2). We ship `scripts/fix-agentkit-esm.mjs` as a `postinstall` hook that walks the installed dist and rewrites every relative import to add `.js`. Idempotent (sentinel file `.esm-patched` prevents re-patching) and silent if agentkit isn't installed.
- After patching, `import('@goatnetwork/agentkit')` exports 162 symbols cleanly, of which 95 are Action factories.

### Dependencies

- Added `@goatnetwork/agentkit ^0.1.2`.

## [0.3.0] — 2026-05-21

### Added

GOAT-native BTC L1↔L2 bridge integration (9 new tools, no key custody).

- **`system_contracts`** — predeployed system contract address table (bridge, wgBTC, goatToken, btcBlock relay, etc).
- **`bridge_deposit_op_return`** — generate the 24-byte OP_RETURN payload for a Bitcoin L1 deposit. Network-aware: emits the `GOAT` prefix (`0x474f4154`) on mainnet, `GT3V` (`0x47543356`) on testnet3.
- **`bridge_deposit_status`** — calls `Bridge.isDeposited(txHash, txout)` to confirm a BTC deposit has been credited on L2.
- **`bridge_withdrawal_status`** — reads `Bridge.withdrawals(id)` and decodes the struct: `Pending` / `Canceling` / `Canceled` / `Refunded` / `Paid`, plus amount/tax in BTC and the BTC fee rate.
- **`bridge_params`** — live deposit and withdrawal parameters (min, tax rate, confirmations) with the OP_RETURN prefix decoded to ASCII.
- **`build_bridge_withdraw`** — unsigned L2 tx calling `withdraw(string btcReceiver, uint16 maxTxPriceSatPerVbyte)` with msg.value set to the BTC amount.
- **`build_bridge_rbf`** — bump the BTC fee rate on a pending withdrawal (`replaceByFee`).
- **`build_bridge_cancel`** — request cancellation (`cancel1`).
- **`build_bridge_refund`** — claim refund of a `Canceled` withdrawal.

Bridge contract is `0xBC10000000000000000000000000000000000003` on both networks (verified against GOAT genesis config).

### Changed

- `NetworkConfig` now includes `depositPrefix` (the network-specific OP_RETURN magic bytes).
- Added a `SYSTEM_CONTRACTS` constant export in `src/networks.ts` mirroring `goat-contracts/common/constants.ts`.

## [0.2.0] — 2026-05-21

### Added

Build/write tools (8 new). All build-only: the MCP never holds keys; the user signs the returned tx in their own wallet, then broadcasts via `send_raw_transaction`.

- **`build_transaction`** — auto-fill an unsigned EIP-1559 transaction (nonce, gas, fees, chainId) from a minimal `{from, to, value?, data?}`.
- **`encode_function_data`** — ABI-encode a function call. Accepts a human-readable signature (e.g. `"function transfer(address,uint256)"`) or a full JSON ABI.
- **`decode_function_data`** — reverse of above: calldata → `{functionName, args}`.
- **`decode_event_log`** — decode a raw event log into the event name and named arguments.
- **`simulate_transaction`** — dry-run a tx via `eth_call`. Returns success + return data, or a decoded revert reason (handles `Error(string)` and `Panic(uint256)` selectors).
- **`build_erc20_transfer`** — one-shot ERC-20 transfer builder; takes decimal amount + token decimals.
- **`build_erc20_approve`** — ERC-20 approve builder. Pass `"max"` for unlimited allowance.
- **`build_contract_write`** — generic builder for any contract function call.

### Fixed

- `networks.ts` had `chainIdHex: "0xBEB0"` (uppercase) for testnet3 but `eth_chainId` returns lowercase per JSON-RPC convention. Normalised both networks to lowercase so unsigned tx objects match what every other tool emits.

### Dependencies

- Added `viem ^2.50.4` for ABI encoding/decoding and human-readable signature parsing.

## [0.1.0] — 2026-05-21

Initial release. 16 read-side tools wrapping the GOAT Network JSON-RPC.

### Added

- **`get_chain_info`** — chain ID, latest block, gas price, network metadata.
- **`get_block`** / **`get_block_by_hash`** — block lookup by number, tag, or hash.
- **`get_gas_price`** — current gas price in wei.
- **`get_fee_history`** — EIP-1559 base fees + reward percentiles.
- **`get_balance`** — native BTC balance, formatted in decimal + wei.
- **`get_transaction_count`** — nonce.
- **`get_code`** / **`get_storage_at`** — contract code and storage reads.
- **`get_transaction`** / **`get_transaction_receipt`** — tx lookup by hash, with logs.
- **`send_raw_transaction`** — broadcast a pre-signed raw transaction. The MCP does **not** sign.
- **`eth_call`** — read-only contract call.
- **`estimate_gas`** — gas estimate for a call.
- **`get_logs`** — event log filter (fromBlock, toBlock, address, topics).
- **`explorer_link`** — build an explorer URL for a tx, address, or block.

### Network support

- **Mainnet** (chainId 2345) — `https://rpc.goat.network` / `https://explorer.goat.network`
- **Testnet3** (chainId 48816) — `https://rpc.testnet3.goat.network` / `https://explorer.testnet3.goat.network`
- **Localnet** — any RPC via `GOAT_RPC_URL` override (e.g. `anvil`, a private node).

[0.4.0]: https://github.com/ExpertVagabond/goat-network-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/ExpertVagabond/goat-network-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/ExpertVagabond/goat-network-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/ExpertVagabond/goat-network-mcp/releases/tag/v0.1.0
