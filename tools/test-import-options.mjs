import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { normalizeApiBase, parseImportOptions, secureN8nFetch } from './lib/import-options.mjs';
assert.deepEqual(parseImportOptions([]), { dryRun: false, activateRequested: false });
assert.deepEqual(parseImportOptions(['--dry-run']), { dryRun: true, activateRequested: false });
assert.deepEqual(parseImportOptions(['--activate']), { dryRun: false, activateRequested: true });
assert.throws(() => parseImportOptions(['--dry-run', '--activate']));
assert.throws(() => parseImportOptions(['--activate', '--activate']));
assert.throws(() => parseImportOptions(['--unknown']));
assert.equal(normalizeApiBase('http://127.0.0.1:5678/'), 'http://127.0.0.1:5678');
assert.equal(normalizeApiBase('https://example.invalid/n8n/'), 'https://example.invalid/n8n');
assert.equal(normalizeApiBase('http://localhost:5678/'), 'http://localhost:5678');
assert.equal(normalizeApiBase('http://localhost.:5678/'), 'http://localhost.:5678');
assert.equal(normalizeApiBase('http://127.9.8.7:5678/'), 'http://127.9.8.7:5678');
assert.equal(normalizeApiBase('http://[::1]:5678/'), 'http://[::1]:5678');
assert.throws(() => normalizeApiBase('http://example.invalid/n8n'), /loopback/);
assert.throws(() => normalizeApiBase('http://localhost.evil.invalid'), /loopback/);
assert.throws(() => normalizeApiBase('http://127.0.0.1.evil.invalid'), /loopback/);
assert.throws(() => normalizeApiBase('http://untrusted.example.invalid'), /loopback/);
assert.throws(() => normalizeApiBase('http://0.0.0.0'), /loopback/);
assert.throws(() => normalizeApiBase('ftp://example.invalid'));
assert.throws(() => normalizeApiBase('https://example.invalid/?query=1'));
assert.throws(() => normalizeApiBase('https://example.invalid/#fragment'));
assert.equal(normalizeApiBase('https://example.invalid/n8n', { loopbackOnly: false }), 'https://example.invalid/n8n');
assert.throws(() => normalizeApiBase('https://example.invalid/n8n', { loopbackOnly: true }), /loopback/);
assert.equal(normalizeApiBase('http://127.0.0.1:5678', { loopbackOnly: true }), 'http://127.0.0.1:5678');
let observedOptions;
await secureN8nFetch('https://example.invalid/api', 'synthetic-test-value', { redirect: 'follow', headers: { 'Content-Type': 'application/json' } }, async (_url, options) => {
  observedOptions = options;
  return { ok: true };
});
assert.equal(observedOptions.redirect, 'error');
assert.equal(observedOptions.headers.get('Content-Type'), 'application/json');
let targetRequests = 0;
let redirectRequests = 0;
const target = createServer((_req, res) => { targetRequests += 1; res.end('unexpected'); });
const source = createServer((_req, res) => { redirectRequests += 1; res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` }); res.end(); });
await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
try {
  await assert.rejects(() => secureN8nFetch(`http://127.0.0.1:${source.address().port}/`, 'synthetic-test-value'));
  assert.equal(redirectRequests, 1);
  assert.equal(targetRequests, 0);
} finally {
  await Promise.all([new Promise((resolve) => source.close(resolve)), new Promise((resolve) => target.close(resolve))]);
}
console.log('Importer option and endpoint checks passed.');
