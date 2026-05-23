import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node', args: ['dist/index.js'],
  env: { ...process.env, GOAT_NETWORK: 'mainnet' },
});
const client = new Client({ name: 'mainnet-test', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('Mainnet tools:', tools.length);

const results = { pass: 0, fail: 0 };

async function test(name, args, expectRevert = false) {
  const r = await client.callTool({ name, arguments: args });
  const txt = r.content?.[0]?.text || '';
  const hasError = r.isError || txt.includes('Error') || txt.includes('revert');
  const pass = expectRevert ? hasError : (hasError === false);

  if (pass) {
    console.log('[PASS]', name.padEnd(30), txt.slice(0, 35).replace(/\n/g, ' '));
    results.pass++;
  } else {
    console.log('[FAIL]', name.padEnd(30), txt.slice(0, 35).replace(/\n/g, ' '));
    results.fail++;
  }
}

console.log('\n=== ERC-8004 TESTS (mainnet) ===');
await test('agent_identity_addresses', {});
await test('agent_lookup', { agentId: '1' });
await test('agent_get_metadata', { agentId: '1', metadataKey: 'name' });
await test('agent_get_clients', { agentId: '1' });

// Build tests (simulation works because mainnet registries are properly linked)
await test('build_agent_register', { from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentURI: 'https://test.com/agent.json' });
await test('build_agent_give_feedback', { from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentId: '1', value: 100, valueDecimals: 0 });
// revoke_feedback expects revert since we haven't given feedback
await test('build_agent_revoke_feedback', { from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentId: '1', feedbackIndex: 0 }, true);

console.log('\n=== SUMMARY ===');
console.log('Pass:', results.pass, '/', results.pass + results.fail);

await client.close();
