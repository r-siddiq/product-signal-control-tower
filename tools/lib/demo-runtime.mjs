import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const WORKFLOW_NAME = 'Product Signal Control Tower';
export const EXTRACTION_NODE = 'Extract Controlled Signal with GLM-5.2';
export const BRIEF_NODE = 'Select Evidence and Draft Brief with GLM-5.2';
export const REVIEW_NODE = 'Review Product Signal Brief';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [line.slice(0, separator).trim(), value];
      }),
  );
}

export function safeRunId(value) {
  assert(
    /^PW-DEMO-[0-9]{8}T[0-9]{6}(?:-[A-Z0-9]{1,8})?$/.test(value),
    'Run ID must use PW-DEMO-YYYYMMDDTHHMMSS with an optional safe suffix.',
  );
  return value;
}

export function generateRunId(now = new Date()) {
  return safeRunId(`PW-DEMO-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
}

export function safeSourceIdentifier(value) {
  assert(/^[A-Za-z0-9._:-]{1,140}$/.test(value), 'Source event ID contains unsafe characters.');
  return value;
}

export function localRuntimeConfig(projectRoot) {
  const n8n = {
    ...parseEnvFile(resolve(projectRoot, 'runtime', '.n8n-mcp.env')),
    ...process.env,
  };
  const owner = parseEnvFile(resolve(projectRoot, 'runtime', '.owner.env'));
  const apiBase = n8n.N8N_API_URL?.replace(/\/$/, '');
  assert(apiBase === 'http://127.0.0.1:5678', 'The demo only permits loopback n8n at http://127.0.0.1:5678.');
  assert(n8n.N8N_API_KEY, 'The ignored local n8n API key is unavailable.');
  return {
    apiBase,
    authorization: n8n.N8N_API_KEY,
    owner,
    jaegerBase: 'http://127.0.0.1:16686',
  };
}

export function createN8nClient(config) {
  const request = async (path, { includeData = false } = {}) => {
    const suffix = includeData ? `${path.includes('?') ? '&' : '?'}includeData=true` : '';
    const response = await fetch(`${config.apiBase}${path}${suffix}`, {
      headers: { 'X-N8N-API-KEY': config.authorization },
    });
    if (!response.ok) {
      const error = new Error(`n8n API request failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  return {
    request,
    async findWorkflow(name = WORKFLOW_NAME) {
      const page = await request('/api/v1/workflows?limit=100');
      const match = page.data?.find((workflow) => workflow.name === name);
      assert(match, `Workflow not found: ${name}`);
      return request(`/api/v1/workflows/${match.id}`);
    },
    async pollExecution(executionId, predicate, timeoutMilliseconds = 180_000) {
      const started = Date.now();
      let missingRetries = 0;
      while (Date.now() - started < timeoutMilliseconds) {
        try {
          const execution = await request(
            `/api/v1/executions/${executionId}`,
            { includeData: true },
          );
          if (predicate(execution)) return execution;
          if (['error', 'canceled', 'crashed'].includes(execution.status)) return execution;
        } catch (error) {
          if (error.status !== 404 || missingRetries >= 20) throw error;
          missingRetries += 1;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
      }
      throw new Error(`Execution ${executionId} did not reach the expected state before timeout.`);
    },
  };
}

export function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert(node, `Workflow node not found: ${name}`);
  return node;
}

export function formFieldIndex(node, fieldName) {
  const fields = node.parameters?.formFields?.values ?? [];
  const index = fields.findIndex((field) => field.fieldName === fieldName);
  assert(index >= 0, `Configured form field not found: ${fieldName}`);
  return index;
}

export function executionIdFromFormBody(body) {
  const executionId = /\/form-waiting\/(\d+)/.exec(body?.formWaitingUrl ?? '')?.[1];
  assert(executionId, 'The form submission did not return a local execution identifier.');
  return executionId;
}

export function runNodeNames(execution) {
  return Object.keys(execution.data?.resultData?.runData ?? {});
}

export function runOutput(execution, nodeName) {
  return execution.data?.resultData?.runData?.[nodeName]?.[0]?.data?.main?.[0]?.[0]?.json ?? null;
}

export function resumeFormUrl(execution) {
  return execution.data?.resultData?.runData?.[REVIEW_NODE]?.[0]?.metadata?.resumeFormUrl ?? null;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function databaseSnapshot(projectRoot, sourceSystem, sourceEventId) {
  assert(/^[a-z_]{1,40}$/.test(sourceSystem), 'Source system contains unsafe characters.');
  safeSourceIdentifier(sourceEventId);
  const query = `
WITH target AS (
  SELECT id, replay_count, replay_content_mismatch_count, processing_status
  FROM public.source_events
  WHERE source_system = ${sqlLiteral(sourceSystem)}
    AND source_event_id = ${sqlLiteral(sourceEventId)}
)
SELECT json_build_object(
  'source_events', (SELECT count(*) FROM target),
  'replay_count', COALESCE((SELECT replay_count FROM target LIMIT 1), 0),
  'replay_mismatch_count', COALESCE((SELECT replay_content_mismatch_count FROM target LIMIT 1), 0),
  'processing_status', (SELECT processing_status FROM target LIMIT 1),
  'signals', (
    SELECT count(*) FROM public.signals s JOIN target t ON t.id = s.source_event_id
  ),
  'product_ops_reviews', (
    SELECT count(*) FROM public.signal_reviews r
    JOIN target t ON t.id = r.source_event_id
    WHERE r.review_stage = 'product_ops'
  ),
  'artifacts', (
    SELECT count(*) FROM public.artifacts a
    JOIN public.signals s ON s.id = a.signal_id
    JOIN target t ON t.id = s.source_event_id
  ),
  'outbox_rows', (
    SELECT count(*) FROM public.outbox o
    JOIN public.artifacts a ON a.id = o.artifact_id
    JOIN public.signals s ON s.id = a.signal_id
    JOIN target t ON t.id = s.source_event_id
  )
)::text;`;
  const output = execFileSync(
    'docker',
    [
      'compose', '--project-directory', resolve(projectRoot, 'runtime'),
      'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'signal_demo',
      '-At', '-v', 'ON_ERROR_STOP=1', '-c', query,
    ],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
  ).trim();
  return JSON.parse(output);
}

export function snapshotDelta(before, after) {
  const numericKeys = [
    'source_events', 'replay_count', 'replay_mismatch_count', 'signals',
    'product_ops_reviews', 'artifacts', 'outbox_rows',
  ];
  return Object.fromEntries(
    numericKeys.map((key) => [key, Number(after[key] ?? 0) - Number(before[key] ?? 0)]),
  );
}

export function summarizeExecution(execution, before, after) {
  const nodes = runNodeNames(execution);
  const final = runOutput(execution, 'Finalize Approved Artifact and Outbox');
  const closed = runOutput(execution, 'Close Without Artifact');
  const replay = runOutput(execution, 'Return Replay Outcome');
  return {
    execution_id: String(execution.id),
    execution_status: execution.status,
    terminal_node: execution.data?.resultData?.lastNodeExecuted ?? null,
    terminal_state:
      replay?.processing_status
      ?? final?.outcome
      ?? closed?.processing_status
      ?? after.processing_status
      ?? execution.status,
    duration_ms: execution.startedAt && execution.stoppedAt
      ? new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()
      : null,
    run_nodes: nodes,
    provider_calls: [EXTRACTION_NODE, BRIEF_NODE].filter((name) => nodes.includes(name)),
    human_reviews: nodes.includes(REVIEW_NODE) ? 1 : 0,
    database_delta: snapshotDelta(before, after),
  };
}

export function scenarioChecks(summary, expected) {
  const checks = {
    execution_status: summary.execution_status === expected.execution_status,
    terminal_node: summary.terminal_node === expected.terminal_node,
    provider_calls: summary.provider_calls.length === expected.provider_calls,
    human_reviews: summary.human_reviews === expected.human_reviews,
  };
  if (expected.terminal_state) checks.terminal_state = summary.terminal_state === expected.terminal_state;
  for (const key of [
    'source_events', 'replay_count', 'signals', 'product_ops_reviews', 'artifacts', 'outbox_rows',
  ]) checks[`delta_${key}`] = summary.database_delta[key] === expected[key];
  checks.provider_nodes_absent_when_expected = expected.provider_calls !== 0
    || (!summary.run_nodes.includes(EXTRACTION_NODE) && !summary.run_nodes.includes(BRIEF_NODE));
  return checks;
}

const tagValue = (span, key) => span.tags?.find((tag) => tag.key === key)?.value ?? null;

export async function waitForJaegerExecution(config, executionId, timeoutMilliseconds = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    const response = await fetch(`${config.jaegerBase}/api/traces?service=n8n&limit=500`);
    assert(response.ok, `Jaeger query failed with HTTP ${response.status}.`);
    const body = await response.json();
    const traces = (body.data ?? []).filter((trace) => (
      trace.spans?.some((span) => String(tagValue(span, 'n8n.execution.id')) === String(executionId))
    ));
    if (traces.length > 0) {
      const nodeNames = [...new Set(traces.flatMap((trace) => (
        trace.spans
          ?.filter((span) => span.operationName === 'node.execute')
          .map((span) => tagValue(span, 'n8n.node.name'))
          .filter(Boolean) ?? []
      )))];
      return {
        trace_ids: traces.map((trace) => trace.traceID),
        trace_count: traces.length,
        span_count: traces.reduce((sum, trace) => sum + (trace.spans?.length ?? 0), 0),
        workflow_spans: traces.reduce(
          (sum, trace) => sum + (trace.spans?.filter((span) => span.operationName === 'workflow.execute').length ?? 0),
          0,
        ),
        node_spans: traces.reduce(
          (sum, trace) => sum + (trace.spans?.filter((span) => span.operationName === 'node.execute').length ?? 0),
          0,
        ),
        follows_from: traces.reduce(
          (sum, trace) => sum + (trace.spans ?? []).reduce(
            (traceSum, span) => traceSum + (span.references ?? []).filter(
              (reference) => reference.refType === 'FOLLOWS_FROM',
            ).length,
            0,
          ),
          0,
        ),
        node_names: nodeNames,
      };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  throw new Error(`No Jaeger trace appeared for execution ${executionId} within the timeout.`);
}
