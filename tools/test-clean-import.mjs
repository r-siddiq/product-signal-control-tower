import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) throw new Error(`Invalid environment entry in ${path}`);
        const key = line.slice(0, separator);
        let value = line.slice(separator + 1);
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

const envPath = resolve(projectRoot, 'runtime', '.n8n-mcp.env');
const runtime = {
  ...(existsSync(envPath) ? parseEnv(envPath) : {}),
  ...process.env,
};
const apiBase = runtime.N8N_API_URL?.replace(/\/$/, '');
if (!apiBase || !runtime.N8N_API_KEY) {
  throw new Error('Local n8n API configuration is unavailable.');
}

async function request(path, options = {}, expected = [200]) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': runtime.N8N_API_KEY,
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!expected.includes(response.status)) {
    throw new Error(`n8n API ${response.status}: ${body.message ?? 'request failed'}`);
  }
  return { status: response.status, body };
}

const paths = [
  'workflows/signal-product-signal-control-tower.json',
  'workflows/signal-product-signal-error-handler.json',
];
const workflows = paths.map((path) => (
  JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8'))
));
const created = [];
const checks = [];
const nonce = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
let cleanupComplete = false;

try {
  for (const workflow of workflows) {
    const payload = {
      name: `${workflow.name} · Clean Import Probe ${nonce}`,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings ?? { executionOrder: 'v1' },
    };
    const createdResponse = await request('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, [200, 201]);
    const saved = createdResponse.body;
    created.push(saved.id);

    const fetched = (await request(`/api/v1/workflows/${saved.id}`)).body;
    const originalFunctional = workflow.nodes.filter(
      (node) => node.type !== 'n8n-nodes-base.stickyNote',
    );
    const fetchedFunctional = fetched.nodes.filter(
      (node) => node.type !== 'n8n-nodes-base.stickyNote',
    );
    checks.push({
      workflow: workflow.name,
      inactive: fetched.active === false,
      node_count_preserved: fetched.nodes.length === workflow.nodes.length,
      functional_node_count_preserved: fetchedFunctional.length === originalFunctional.length,
      node_names_preserved:
        JSON.stringify(fetched.nodes.map((node) => node.name))
        === JSON.stringify(workflow.nodes.map((node) => node.name)),
      connections_preserved:
        JSON.stringify(fetched.connections) === JSON.stringify(workflow.connections),
      credentials_absent:
        fetched.nodes.every((node) => !Object.hasOwn(node, 'credentials')),
    });
  }
} finally {
  const cleanup = [];
  for (const id of created.reverse()) {
    await request(`/api/v1/workflows/${id}`, { method: 'DELETE' }, [200]);
    const afterDelete = await request(`/api/v1/workflows/${id}`, {}, [404]);
    cleanup.push(afterDelete.status === 404);
  }
  cleanupComplete = cleanup.length === created.length && cleanup.every(Boolean);
}

const passed = (
  checks.length === workflows.length
  && checks.every((entry) => (
    entry.inactive
    && entry.node_count_preserved
    && entry.functional_node_count_preserved
    && entry.node_names_preserved
    && entry.connections_preserved
    && entry.credentials_absent
  ))
  && cleanupComplete
);
const evidence = {
  schema_version: '1.0.0',
  synthetic: true,
  status: passed ? 'clean_import_acceptance_passed' : 'clean_import_acceptance_failed',
  captured_at: new Date().toISOString(),
  target: 'loopback-only local n8n instance',
  created_inactive_probe_workflows: checks.length,
  removed_probe_workflows: cleanupComplete ? checks.length : null,
  original_workflows_modified: false,
  credentials_imported: false,
  checks,
};

writeFileSync(
  resolve(projectRoot, 'evaluation', 'clean-import-captured-results.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!passed) process.exitCode = 1;
