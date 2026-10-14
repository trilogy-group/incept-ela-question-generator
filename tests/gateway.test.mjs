import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, credentials } from '../gateway.mjs';

test('filtered credential file is never executed and only explicitly supported names are loaded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'writer-env-'));
  try {
    const path = join(directory, 'test.env');
    await writeFile(path, 'UNRELATED_SECRET=ignore\nTFY_INDIVIDUAL_TOKEN=\nMAAT_API_TOKEN="test-token"\nRUN_THIS=$(touch malicious)\n');
    assert.deepEqual(await credentials(path, {}), { MAAT_API_TOKEN: 'test-token' });
    await writeFile(path, 'MAAT_API_TOKEN=$(touch malicious)\n');
    await assert.rejects(credentials(path, {}), /literal/);
  } finally { await rm(directory, { recursive: true }); }
});

test('existing active personal account uses its gateway token; no account mutation or automatic retry occurs', async () => {
  const calls = [];
  const values = [[{ virtual_account_id: 'inactive', kind: 'personal', disabled: true, is_expired: false }, { virtual_account_id: 'existing', kind: 'personal', disabled: false, is_expired: false }], { token: 'gateway-token' }, { data: [{ id: 'direct/writer', owned_by: 'direct' }] }, { model: 'writer', choices: [] }];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => JSON.stringify(values.shift()) }; };
  const route = await connect({ control_base_url: 'https://control.example', gateway_base_url: 'https://gateway.example' }, { MAAT_API_TOKEN: 'dashboard-token' }, fetchImpl);
  assert.deepEqual(await route.models(), [{ id: 'direct/writer', owned_by: 'direct' }]);
  await route.complete({ model: 'direct/writer', messages: [] });
  assert.equal(calls.length, 4); assert.equal(calls[3].init.headers.Authorization, 'Bearer gateway-token');
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1); assert.ok(calls[1].url.endsWith('/existing/token'));
  await assert.rejects(route.complete({ model: 'aws-bedrock/writer' }), /excludes AWS/); assert.equal(calls.length, 4);
});

test('network errors return only a safe HTTP code and never retry or expose server error bodies', async () => {
  let calls = 0;
  await assert.rejects(connect({ control_base_url: 'https://control.example' }, { MAAT_API_TOKEN: 'dashboard-token' }, async () => { calls++; return { ok: false, status: 401, text: async () => 'dashboard-token' }; }), /^Error: Gateway HTTP 401/);
  assert.equal(calls, 1);
});
