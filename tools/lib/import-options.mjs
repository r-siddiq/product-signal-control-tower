import { isIP } from 'node:net';

export function parseImportOptions(flags) {
  if (flags.some((flag) => !['--dry-run', '--activate'].includes(flag)) || new Set(flags).size !== flags.length) {
    throw new Error('Usage: node tools/import-local-workflows.mjs [--dry-run | --activate]');
  }
  const dryRun = flags.includes('--dry-run');
  const activateRequested = flags.includes('--activate');
  if (dryRun && activateRequested) throw new Error('Choose dry-run or explicit activation, not both');
  return { dryRun, activateRequested };
}

export function normalizeApiBase(value, { loopbackOnly = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The n8n API base must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The n8n API base must be an HTTP(S) URL without embedded credentials, query, or fragment');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === 'localhost.' || host === '[::1]'
    || (isIP(host) === 4 && host.split('.')[0] === '127');
  if (loopbackOnly && !loopback) {
    throw new Error('This n8n operation is permitted only on a loopback host');
  }
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('Plain HTTP is permitted only for loopback n8n API hosts; use HTTPS for remote hosts');
  }
  return url.toString().replace(/\/+$/, '');
}

export function secureN8nFetch(url, apiKey, options = {}, implementation = globalThis.fetch) {
  if (!apiKey) throw new Error('An n8n API key is required');
  const headers = new Headers(options.headers ?? {});
  headers.set('X-N8N-API-KEY', apiKey);
  return implementation(url, { ...options, headers, redirect: 'error' });
}
