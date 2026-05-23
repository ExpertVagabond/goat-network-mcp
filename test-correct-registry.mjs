import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWalletClient, createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

const goatTestnet3 = defineChain({
  id: 48816, name: 'GOAT Network Testnet3',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet3.goat.network'] } },
});

const publicClient = createPublicClient({ chain: goatTestnet3, transport: http() });
const walletClient = createWalletClient({ account: TEST_ACCOUNT, chain: goatTestnet3, transport: http() });

console.log('Wallet:', TEST_ACCOUNT.address);
console.log('Balance:', formatEther(await publicClient.getBalance({ address: TEST_ACCOUNT.address })), 'BTC');

const transport = new StdioClientTransport({
  command: 'node', args: ['dist/index.js'],
  env: { ...process.env, GOAT_NETWORK: 'testnet3' },
});
const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Check the registry addresses
console.log('\n=== Registry Addresses ===');
const addrs = await client.callTool({ name: 'agent_identity_addresses', arguments: {} });
console.log(addrs.content?.[0]?.text);

// Register a new agent in the CORRECT registry
console.log('\n=== Registering New Agent ===');
const regResult = await client.callTool({
  name: 'build_agent_register',
  arguments: {
    from: TEST_ACCOUNT.address,
    agentURI: 'https://example.com/correct-registry-agent-' + Date.now() + '.json',
  }
});

const regTxt = regResult.content?.[0]?.text || '';
if (regTxt.includes('Error')) {
  console.log('Registration failed:', regTxt.slice(0, 150));
  await client.close();
  process.exit(1);
}

console.log('Got unsigned tx, signing...');
const txData = JSON.parse(regTxt);
const hash = await walletClient.sendTransaction({
  to: txData.to,
  data: txData.data,
  value: BigInt(txData.value || '0'),
  gas: BigInt(txData.gas),
  maxFeePerGas: BigInt(txData.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(txData.maxPriorityFeePerGas),
});
console.log('Tx:', hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Status:', receipt.status, 'block:', receipt.blockNumber);

// Get agent ID from logs (Transfer event: topic[3] is tokenId)
let newAgentId = null;
for (const log of receipt.logs) {
  if (log.topics.length >= 4) {
    newAgentId = BigInt(log.topics[3]).toString();
    break;
  }
}
console.log('New agent ID:', newAgentId);

if (!newAgentId || newAgentId === '0') {
  console.log('Could not parse agent ID from logs');
  await client.close();
  process.exit(1);
}

// Test give_feedback on this agent
console.log('\n=== Testing give_feedback ===');
const fbResult = await client.callTool({
  name: 'build_agent_give_feedback',
  arguments: {
    from: TEST_ACCOUNT.address,
    agentId: newAgentId,
    value: 100,
    valueDecimals: 0,
  }
});
const fbTxt = fbResult.content?.[0]?.text || '';
if (fbTxt.includes('Error')) {
  console.log('[FAIL] give_feedback:', fbTxt.slice(0, 150));
} else {
  const fbData = JSON.parse(fbTxt);
  const fbHash = await walletClient.sendTransaction({
    to: fbData.to,
    data: fbData.data,
    value: BigInt(fbData.value || '0'),
    gas: BigInt(fbData.gas),
    maxFeePerGas: BigInt(fbData.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(fbData.maxPriorityFeePerGas),
  });
  console.log('Tx:', fbHash);
  const fbReceipt = await publicClient.waitForTransactionReceipt({ hash: fbHash });
  console.log('[PASS] give_feedback:', fbReceipt.status, 'block:', fbReceipt.blockNumber);
}

// Test revoke_feedback
console.log('\n=== Testing revoke_feedback ===');
const rvResult = await client.callTool({
  name: 'build_agent_revoke_feedback',
  arguments: {
    from: TEST_ACCOUNT.address,
    agentId: newAgentId,
    feedbackIndex: 0,
  }
});
const rvTxt = rvResult.content?.[0]?.text || '';
if (rvTxt.includes('Error')) {
  console.log('[FAIL] revoke_feedback:', rvTxt.slice(0, 150));
} else {
  const rvData = JSON.parse(rvTxt);
  const rvHash = await walletClient.sendTransaction({
    to: rvData.to,
    data: rvData.data,
    value: BigInt(rvData.value || '0'),
    gas: BigInt(rvData.gas),
    maxFeePerGas: BigInt(rvData.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(rvData.maxPriorityFeePerGas),
  });
  console.log('Tx:', rvHash);
  const rvReceipt = await publicClient.waitForTransactionReceipt({ hash: rvHash });
  console.log('[PASS] revoke_feedback:', rvReceipt.status, 'block:', rvReceipt.blockNumber);
}

console.log('\n=== All ERC-8004 tests complete ===');
await client.close();
