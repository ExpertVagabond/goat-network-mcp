import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node', args: ['dist/index.js'],
  env: { ...process.env, GOAT_NETWORK: 'testnet3' },
});
const client = new Client({ name: 'list-tools', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();

// Group by namespace
const byNs = {};
for (const t of tools) {
  const ns = t.name.includes('.') ? t.name.split('.')[0] : 'native';
  if (!byNs[ns]) byNs[ns] = [];
  byNs[ns].push(t.name);
}

console.log('=== ALL ' + tools.length + ' TOOLS BY NAMESPACE ===\n');
for (const [ns, names] of Object.entries(byNs).sort((a,b) => b[1].length - a[1].length)) {
  console.log(ns + ' (' + names.length + '):');
  for (const n of names.sort()) {
    console.log('  ' + n);
  }
  console.log();
}

await client.close();
