import { readFile } from 'node:fs/promises';

export class RouteError extends Error {}

const TOKEN_NAMES = new Set(['TFY_INDIVIDUAL_TOKEN', 'MAAT_API_TOKEN']);

// Read only literal values from an explicitly supplied file. Never source a shell.
export async function credentials(envFile, environment = process.env) {
  const selected = {};
  for (const name of TOKEN_NAMES) if (environment[name]) selected[name] = environment[name];
  if (envFile) {
    for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || !TOKEN_NAMES.has(match[1]) || selected[match[1]]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      if (!value) continue;
      if (/\$|`|\r|\n/.test(value)) throw new RouteError('Credential values must be literal; shell expressions are unsupported');
      selected[match[1]] = value;
    }
  }
  if (!selected.MAAT_API_TOKEN && !selected.TFY_INDIVIDUAL_TOKEN) throw new RouteError('Provide MAAT_API_TOKEN or TFY_INDIVIDUAL_TOKEN, or an explicit --env-file');
  return selected;
}

function endpoint(base, path) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new RouteError('Gateway and control URLs must be plain HTTPS URLs');
  return `${base.replace(/\/$/, '')}${path}`;
}

async function jsonRequest(url, token, fetchImpl, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new RouteError('Gateway network request failed or timed out; no automatic retry ran');
  }
  if (!response.ok) throw new RouteError(`Gateway HTTP ${response.status}; no automatic retry ran`);
  const raw = await response.text();
  try { return { raw, value: JSON.parse(raw) }; }
  catch { throw new RouteError('Gateway returned invalid JSON'); }
}

export async function connect(config, selected, fetchImpl = fetch) {
  const dashboard = selected.MAAT_API_TOKEN || selected.TFY_INDIVIDUAL_TOKEN;
  const inventory = (await jsonRequest(endpoint(config.control_base_url, '/api/profile/vats'), dashboard, fetchImpl)).value;
  const accounts = Array.isArray(inventory) ? inventory : inventory.vats ?? inventory.data;
  if (!Array.isArray(accounts)) throw new RouteError('Control service returned an unsupported account inventory');
  const usable = accounts.filter(row => row.disabled === false && row.is_expired === false && typeof row.virtual_account_id === 'string');
  const account = usable.find(row => row.kind === 'personal') || usable.find(row => row.kind === 'team' && typeof row.name === 'string' && row.name.endsWith('-dev'));
  if (!account) throw new RouteError('No existing active personal or team development account is available; no account was created or changed');
  const tokenPacket = (await jsonRequest(endpoint(config.control_base_url, `/api/profile/vats/${encodeURIComponent(account.virtual_account_id)}/token`), dashboard, fetchImpl)).value;
  if (typeof tokenPacket.token !== 'string' || !tokenPacket.token) throw new RouteError('Control service did not return a gateway credential');
  const token = tokenPacket.token;
  return {
    async models() {
      const result = (await jsonRequest(endpoint(config.gateway_base_url, '/models'), token, fetchImpl)).value;
      const data = Array.isArray(result) ? result : result.data;
      if (!Array.isArray(data)) throw new RouteError('Gateway returned an unsupported model inventory');
      return data.filter(row => typeof row.id === 'string');
    },
    async complete(body) {
      if (/bedrock|\baws\b/i.test(body.model ?? '')) throw new RouteError('This writer configuration excludes AWS and Bedrock routes');
      const result = await jsonRequest(endpoint(config.gateway_base_url, '/chat/completions'), token, fetchImpl, { method: 'POST', body: JSON.stringify(body) });
      // Provider errors must never disclose a credential, even if a server echoes it.
      for (const secret of [dashboard, token]) if (result.raw.includes(secret)) throw new RouteError('Gateway response contained credential material and was withheld');
      return result;
    },
  };
}
