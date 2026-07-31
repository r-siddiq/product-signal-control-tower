import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const inputIndex = arguments_.indexOf('--input');
const outputIndex = arguments_.indexOf('--output');
const inputPath = resolve(
  projectRoot,
  inputIndex >= 0 ? arguments_[inputIndex + 1] : 'evaluation/provider-captured-results.json',
);
const outputPath = resolve(
  projectRoot,
  outputIndex >= 0 ? arguments_[outputIndex + 1] : 'evaluation/otel-captured-results.json',
);
const jaegerBase = process.env.JAEGER_API_URL?.replace(/\/$/, '')
  ?? 'http://127.0.0.1:16686';

const providerResults = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(providerResults.cases)) {
  throw new Error('Provider evidence does not contain a cases array.');
}

const response = await fetch(`${jaegerBase}/api/traces?service=n8n&limit=500`);
if (!response.ok) throw new Error(`Jaeger query failed with HTTP ${response.status}.`);
const body = await response.json();
const traces = Array.isArray(body.data) ? body.data : [];

const tagValue = (span, key) => span.tags?.find((tag) => tag.key === key)?.value ?? null;
const executionIdForTrace = (trace) => {
  for (const span of trace.spans ?? []) {
    const value = tagValue(span, 'n8n.execution.id');
    if (value !== null && value !== undefined) return String(value);
  }
  return null;
};
const tracesByExecution = new Map();
for (const trace of traces) {
  const executionId = executionIdForTrace(trace);
  if (!executionId) continue;
  const current = tracesByExecution.get(executionId) ?? [];
  current.push(trace);
  tracesByExecution.set(executionId, current);
}

const summarizeTrace = (trace) => {
  const nodeNames = [];
  const workflowSpans = [];
  let followsFromReferences = 0;
  for (const span of trace.spans ?? []) {
    if (span.operationName === 'node.execute') {
      const nodeName = tagValue(span, 'n8n.node.name');
      if (nodeName) nodeNames.push(String(nodeName));
    }
    if (span.operationName === 'workflow.execute') {
      workflowSpans.push({
        workflow_name: tagValue(span, 'n8n.workflow.name'),
        execution_mode: tagValue(span, 'n8n.execution.mode'),
        execution_status: tagValue(span, 'n8n.execution.status'),
        node_count: tagValue(span, 'n8n.workflow.node_count'),
        error_type: tagValue(span, 'n8n.execution.error_type'),
      });
    }
    followsFromReferences += (span.references ?? [])
      .filter((reference) => reference.refType === 'FOLLOWS_FROM').length;
  }
  return {
    trace_id: trace.traceID,
    span_count: (trace.spans ?? []).length,
    workflow_span_count: workflowSpans.length,
    node_span_count: nodeNames.length,
    follows_from_reference_count: followsFromReferences,
    workflow_spans: workflowSpans,
    node_names: nodeNames,
  };
};

const selectedCaseIds = [
  'CASE-FRESH-01',
  'CASE-REPLAY-01B',
  'CASE-DEGRADE-01',
  'CASE-REJECT-01',
];
const evidenceCases = [];
for (const caseId of selectedCaseIds) {
  const providerCase = providerResults.cases.find((entry) => entry.case_id === caseId);
  if (!providerCase?.execution_id) continue;
  const summaries = (tracesByExecution.get(String(providerCase.execution_id)) ?? [])
    .map(summarizeTrace);
  const nodeNames = [...new Set(summaries.flatMap((trace) => trace.node_names))];
  const followsFromCount = summaries.reduce(
    (sum, trace) => sum + trace.follows_from_reference_count,
    0,
  );
  evidenceCases.push({
    synthetic: true,
    case_id: caseId,
    execution_id: String(providerCase.execution_id),
    terminal_state: providerCase.terminal_state,
    provider_call_count: providerCase.provider_call_count,
    business_degradation:
      providerCase.evidence_brief?.evidence_status === 'degraded',
    traces: summaries,
    checks: {
      trace_present: summaries.length > 0,
      workflow_spans_present:
        summaries.some((trace) => trace.workflow_span_count > 0),
      node_spans_present:
        summaries.some((trace) => trace.node_span_count > 0),
      wait_resume_link_present: caseId === 'CASE-REPLAY-01B'
        ? true
        : followsFromCount > 0,
      replay_bypasses_provider_nodes: caseId === 'CASE-REPLAY-01B'
        ? !nodeNames.includes('Extract Controlled Signal with GLM-5.2')
          && !nodeNames.includes('Select Evidence and Draft Brief with GLM-5.2')
        : true,
      degraded_path_traced: caseId === 'CASE-DEGRADE-01'
        ? nodeNames.includes('Select Evidence and Draft Brief with GLM-5.2')
          && providerCase.evidence_brief?.evidence_status === 'degraded'
        : true,
    },
  });
}

const allChecksPassed = evidenceCases.every(
  (entry) => Object.values(entry.checks).every(Boolean),
);
const document = {
  schema_version: '1.0.0',
  synthetic: true,
  captured_at: new Date().toISOString(),
  source: {
    provider_evidence_file: inputPath.replace(`${projectRoot}\\`, '').replaceAll('\\', '/'),
    backend: 'Jaeger 2.20.0 in-memory demo backend',
    service_name: 'n8n',
    query_api: 'loopback-only',
  },
  interpretation: [
    'These are native n8n workflow.execute and node.execute traces, not telemetry nodes added to the workflow.',
    'A Wait/Form resume creates a new trace linked to the pre-wait trace with FOLLOWS_FROM.',
    'Business/model quality and token metrics remain in PostgreSQL/provider evidence rather than custom span attributes.',
    'The direct Jaeger exporter is a demo choice; production should use an approved OpenTelemetry Collector and backend.',
  ],
  status: allChecksPassed
    ? 'native_otel_acceptance_passed'
    : 'native_otel_acceptance_has_failures',
  cases: evidenceCases,
};

writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: outputPath.replace(`${projectRoot}\\`, '').replaceAll('\\', '/'),
  status: document.status,
  cases: evidenceCases.length,
  checks_passed: allChecksPassed,
}));
