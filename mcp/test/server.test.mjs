// The server as an agent sees it: over the MCP protocol, with no browser anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const server = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function connect(...extra) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, '--world', 'proto-test', ...extra], stderr: 'ignore' }));
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { raw: r.content[0].text, json: JSON.parse(r.content[0].text), err: r.isError }; };
  return { client, call };
}

test('exactly five tools, none of them a cheat, with a small fixed cost in the agent\'s context', async () => {
  const { client } = await connect();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['act', 'advance', 'info', 'look', 'status']);
    const fixed = JSON.stringify(tools).length + (client.getInstructions()?.length ?? 0);
    assert.ok(fixed < 6500, `tool descriptions and rules cost ${fixed} characters of context once`);
  } finally { await client.close(); }
});

test('a game can be played end to end through the protocol, in tiny replies', async () => {
  const { client, call } = await connect();
  try {
    const st = await call('status'); assert.ok(st.raw.length < 900 && st.json.stock.length === 12);
    const act = await call('act', { a: [['place', 0, 12, 4, 0, 6], ['place', 0, 18, 8, 0, 6], ['place', 1, -14, 6, 0, 8], ['nonsense']] });
    assert.equal(act.json.length, 4); assert.ok(Array.isArray(act.json[0]) && act.json[0].length === 3, act.raw); assert.equal(act.json[3], 'unknown action nonsense');
    assert.ok(act.raw.length < 120, `act reply: ${act.raw}`);
    const adv = await call('advance', { ticks: 120 }); assert.ok(adv.raw.length < 300 && adv.json.t > 0, adv.raw);
    const look = await call('look', { what: 'buildings', limit: 5 }); assert.ok(look.json.total >= 3 && look.raw.length < 600);
    const info = await call('info', { kind: 6, opts: true }); assert.equal(info.json.name, 'Quarry');
    const bad = await call('look', { what: 'land', half: 999 }).catch(e => ({ err: true })); assert.ok(bad.err, 'out-of-range arguments are refused');
  } finally { await client.close(); }
});
