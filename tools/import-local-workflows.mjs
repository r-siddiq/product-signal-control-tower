import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

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
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

const runtimeEnv = resolve(projectRoot, 'runtime', '.n8n-mcp.env');
const runtime = {
  ...(existsSync(runtimeEnv) ? parseEnv(runtimeEnv) : {}),
  ...process.env,
};
const apiBase = runtime.N8N_API_URL?.replace(/\/$/, '');
if (!apiBase || !runtime.N8N_API_KEY) {
  throw new Error(
    'Set N8N_API_URL and N8N_API_KEY in the process environment or provide runtime/.n8n-mcp.env.',
  );
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': runtime.N8N_API_KEY,
      ...options.headers,
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${body.message ?? 'request failed'}`);
  }
  return body;
}

const cleanFiles = [
  resolve(projectRoot, 'workflows', 'signal-product-signal-control-tower.json'),
  resolve(projectRoot, 'workflows', 'signal-product-signal-error-handler.json'),
];
const cleanWorkflows = cleanFiles.map((path) => JSON.parse(readFileSync(path, 'utf8')));

for (const [index, workflow] of cleanWorkflows.entries()) {
  if (workflow.nodes.some((node) => node.credentials)) {
    throw new Error(`Clean export unexpectedly contains credentials: ${cleanFiles[index]}`);
  }
}

const credentialResponse = await api('/api/v1/credentials');
const credentialByName = new Map(
  (credentialResponse.data ?? []).map((credential) => [credential.name, credential]),
);
const postgresCredential = credentialByName.get('Signal Demo Postgres');
const zaiCredential = credentialByName.get('Signal Demo Z.ai');

if (!postgresCredential || postgresCredential.type !== 'postgres') {
  throw new Error('Local n8n credential "Signal Demo Postgres" was not found.');
}
if (!zaiCredential || zaiCredential.type !== 'httpHeaderAuth') {
  throw new Error('Local n8n credential "Signal Demo Z.ai" was not found.');
}

function prepareLocalWorkflow(cleanWorkflow) {
  const workflow = structuredClone(cleanWorkflow);
  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.postgres') {
      node.credentials = {
        postgres: {
          id: postgresCredential.id,
          name: postgresCredential.name,
        },
      };
    }
    if (
      node.type === 'n8n-nodes-base.httpRequest'
      && node.parameters?.url === 'https://api.z.ai/api/coding/paas/v4/chat/completions'
    ) {
      node.credentials = {
        httpHeaderAuth: {
          id: zaiCredential.id,
          name: zaiCredential.name,
        },
      };
    }
  }

  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? { executionOrder: 'v1' },
  };
}

const existingResponse = await api('/api/v1/workflows?limit=100');
const existingByName = new Map(
  (existingResponse.data ?? []).map((workflow) => [workflow.name, workflow]),
);
const results = [];

for (const cleanWorkflow of cleanWorkflows) {
  const payload = prepareLocalWorkflow(cleanWorkflow);
  const existing = existingByName.get(payload.name);

  if (dryRun) {
    results.push({
      name: payload.name,
      action: existing ? 'would_update' : 'would_create',
      node_count: payload.nodes.length,
      credential_blocks_added: payload.nodes.filter((node) => node.credentials).length,
      active: false,
    });
    continue;
  }

  const saved = existing
    ? await api(`/api/v1/workflows/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    : await api('/api/v1/workflows', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

  results.push({
    id: saved.id,
    name: saved.name,
    action: existing ? 'updated' : 'created',
    node_count: saved.nodes?.length ?? payload.nodes.length,
    active: Boolean(saved.active),
  });
}

const mainName = 'Product Signal Control Tower';
const errorName = 'Product Signal Error Handler';
let errorWorkflowAssignment = dryRun ? 'would_assign_after_import' : 'not_assigned';

if (!dryRun) {
  const mainResult = results.find((result) => result.name === mainName);
  const errorResult = results.find((result) => result.name === errorName);
  const cleanMain = cleanWorkflows.find((workflow) => workflow.name === mainName);
  if (!mainResult || !errorResult || !cleanMain) {
    throw new Error('Unable to resolve the main and companion workflow IDs for error-workflow assignment.');
  }

  const mainPayload = prepareLocalWorkflow(cleanMain);
  mainPayload.settings = {
    ...mainPayload.settings,
    errorWorkflow: errorResult.id,
  };
  const reassigned = await api(`/api/v1/workflows/${mainResult.id}`, {
    method: 'PUT',
    body: JSON.stringify(mainPayload),
  });
  errorWorkflowAssignment = reassigned.settings?.errorWorkflow === errorResult.id
    ? 'assigned'
    : 'update_returned_without_confirmation';

  // Both workflows must be active for production-form executions to invoke the
  // companion Error Trigger on this n8n version. Activation remains loopback-only
  // because the runtime binds n8n to 127.0.0.1.
  for (const result of [errorResult, mainResult]) {
    const activated = await api(`/api/v1/workflows/${result.id}/activate`, {
      method: 'POST',
      body: '{}',
    });
    result.active = Boolean(activated.active);
    if (!result.active) {
      throw new Error(`Workflow did not activate: ${result.name}`);
    }
  }
}

if (!dryRun) {
  const localEvidenceDirectory = resolve(projectRoot, 'evaluation', 'local');
  mkdirSync(localEvidenceDirectory, { recursive: true });
  writeFileSync(
    resolve(localEvidenceDirectory, 'imported-workflows.json'),
    `${JSON.stringify({
      captured_synthetic_test: true,
      imported_at: new Date().toISOString(),
      error_workflow_assignment: errorWorkflowAssignment,
      workflows: results,
    }, null, 2)}\n`,
    'utf8',
  );
}

process.stdout.write(`${JSON.stringify({
  dry_run: dryRun,
  error_workflow_assignment: errorWorkflowAssignment,
  workflows: results,
}, null, 2)}\n`);
