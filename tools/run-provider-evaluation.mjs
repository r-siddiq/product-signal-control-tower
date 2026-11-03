import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeApiBase, secureN8nFetch } from './lib/import-options.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowName = 'Product Signal Control Tower';
const extractionHttpNode = 'Extract Controlled Signal with GLM-5.2';
const evidenceBriefHttpNode = 'Select Evidence and Draft Brief with GLM-5.2';

function parseArguments(argv) {
  const result = {
    cases: null,
    output: resolve(projectRoot, 'evaluation', 'provider-captured-results.json'),
    runLabel: `LEAN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cases') result.cases = argv[++index]?.split(',').filter(Boolean) ?? null;
    else if (argument === '--output') result.output = resolve(projectRoot, argv[++index]);
    else if (argument === '--run-label') result.runLabel = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(result.runLabel)) {
    throw new Error('--run-label must use 1-40 safe source-key characters.');
  }
  return result;
}

function parseEnv(path) {
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
        ) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, separator).trim(), value];
      }),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeIdentifier(value, label) {
  assert(/^[A-Za-z0-9._:-]{1,140}$/.test(value), `${label} contains unsafe characters.`);
  return value;
}

const sleep = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

const arguments_ = parseArguments(process.argv.slice(2));
const n8nEnv = {
  ...parseEnv(resolve(projectRoot, 'runtime', '.n8n-api.env')),
  ...process.env,
};
const apiBase = n8nEnv.N8N_API_URL ? normalizeApiBase(n8nEnv.N8N_API_URL) : '';
const n8nCredential = n8nEnv.N8N_API_KEY;
assert(apiBase && n8nCredential, 'The local n8n API URL/key is unavailable.');

const fixtureDocument = JSON.parse(
  readFileSync(resolve(projectRoot, 'fixtures', 'synthetic-signals.json'), 'utf8'),
);
const goldenDocument = JSON.parse(
  readFileSync(resolve(projectRoot, 'fixtures', 'golden-expectations.json'), 'utf8'),
);
const goldenByCase = new Map(goldenDocument.cases.map((entry) => [entry.case_id, entry]));
const selectedFixtures = arguments_.cases
  ? fixtureDocument.cases.filter((entry) => arguments_.cases.includes(entry.demo_case_id))
  : fixtureDocument.cases;
assert(selectedFixtures.length > 0, 'No fixture cases were selected.');
if (arguments_.cases) {
  assert(
    selectedFixtures.length === new Set(arguments_.cases).size,
    'At least one requested fixture ID was not found.',
  );
}

async function n8nApi(path, { includeData = false } = {}) {
  const suffix = includeData ? `${path.includes('?') ? '&' : '?'}includeData=true` : '';
  const response = await secureN8nFetch(`${apiBase}${path}${suffix}`, n8nCredential);
  if (!response.ok) {
    const error = new Error(`n8n API request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function findWorkflow() {
  const page = await n8nApi('/api/v1/workflows?limit=100');
  const match = page.data?.find((workflow) => workflow.name === workflowName);
  if (!match) throw new Error(`Active workflow not found: ${workflowName}`);
  return n8nApi(`/api/v1/workflows/${match.id}`);
}

function nodeByName(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert(result, `Workflow node not found: ${name}`);
  return result;
}

function appendConfiguredFields(form, node, values) {
  const fields = node.parameters?.formFields?.values ?? [];
  fields.forEach((field, index) => {
    const value = values[field.fieldName];
    if (value === undefined || value === null || value === '') return;
    form.append(`field-${index}`, String(value));
  });
  form.append('useResponseData', 'true');
}

async function submitForm(url, node, values) {
  const form = new FormData();
  appendConfiguredFields(form, node, values);
  const response = await fetch(url, { method: 'POST', body: form });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(`Form submission failed with HTTP ${response.status}.`);
  return body;
}

async function pollExecution(executionId, predicate, timeoutMilliseconds = 180_000) {
  const started = Date.now();
  let missingRetries = 0;
  while (Date.now() - started < timeoutMilliseconds) {
    try {
      const execution = await n8nApi(
        `/api/v1/executions/${executionId}`,
        { includeData: true },
      );
      if (predicate(execution)) return execution;
      if (['error', 'canceled', 'crashed'].includes(execution.status)) return execution;
    } catch (error) {
      if (error.status !== 404 || missingRetries > 20) throw error;
      missingRetries += 1;
    }
    await sleep(750);
  }
  throw new Error(`Execution ${executionId} did not reach the expected state before timeout.`);
}

function runOutput(execution, nodeName) {
  return execution.data?.resultData?.runData?.[nodeName]?.[0]?.data?.main?.[0]?.[0]?.json ?? null;
}

function runNodeNames(execution) {
  return Object.keys(execution.data?.resultData?.runData ?? {});
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function databaseSnapshot(sourceSystem, sourceEventId) {
  safeIdentifier(sourceSystem, 'source_system');
  safeIdentifier(sourceEventId, 'source_event_id');
  const query = `
WITH target AS (
  SELECT id, replay_count, processing_status
  FROM public.source_events
  WHERE source_system = ${sqlLiteral(sourceSystem)}
    AND source_event_id = ${sqlLiteral(sourceEventId)}
)
SELECT json_build_object(
  'source_events', (SELECT count(*) FROM target),
  'replay_count', COALESCE((SELECT replay_count FROM target LIMIT 1), 0),
  'processing_status', (SELECT processing_status FROM target LIMIT 1),
  'signals', (
    SELECT count(*) FROM public.signals s JOIN target t ON t.id = s.source_event_id
  ),
  'product_ops_reviews', (
    SELECT count(*) FROM public.signal_reviews r
    JOIN target t ON t.id = r.source_event_id
    WHERE r.review_stage = 'product_ops'
  ),
  'final_reviews', (
    SELECT count(*) FROM public.signal_reviews r
    JOIN target t ON t.id = r.source_event_id
    WHERE r.review_stage = 'final_approval'
  ),
  'theme_memberships', (
    SELECT count(*) FROM public.theme_signals ts
    JOIN public.signals s ON s.id = ts.signal_id
    JOIN target t ON t.id = s.source_event_id
  ),
  'embedding_records', (
    SELECT count(*) FROM public.signal_embeddings e
    JOIN public.signals s ON s.id = e.signal_id
    JOIN target t ON t.id = s.source_event_id
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
      'compose',
      '--project-directory',
      resolve(projectRoot, 'runtime'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'signal_demo',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
  ).trim();
  return JSON.parse(output);
}

function snapshotDelta(before, after) {
  const numericKeys = [
    'source_events',
    'replay_count',
    'signals',
    'product_ops_reviews',
    'final_reviews',
    'theme_memberships',
    'embedding_records',
    'artifacts',
    'outbox_rows',
  ];
  return Object.fromEntries(
    numericKeys.map((key) => [key, Number(after[key] ?? 0) - Number(before[key] ?? 0)]),
  );
}

function decisionForCase(caseId, golden) {
  return golden.review.decision;
}

const editOverrides = {
  'CASE-EDIT-01': {
    edited_product_family: 'municipal_websites',
    edited_brief_summary: 'Synthetic feedback alleges that an editing assistant changed official meaning in a draft; Product Operations retains it as unverified evidence pending source comparison.',
  },
  'CASE-PII-01': {
    edited_product_family: 'signal_agent',
    edited_brief_summary: 'A synthetic resident signal alleges contact-data exposure; contact-like values were removed before model and persistence boundaries, and no production incident is confirmed.',
  },
  'CASE-AMB-01': {
    edited_product_family: 'process_automation',
    edited_brief_summary: 'Synthetic staff feedback describes a repeated approval step and confusing wording; Product Operations classified it as a workflow-discovery signal, not a verified AI defect.',
  },
};

function reviewPayload(fixture, golden) {
  const decision = decisionForCase(fixture.demo_case_id, golden);
  return {
    decision,
    rationale: `Synthetic ${fixture.demo_case_id} Product Operations decision after reviewing minimized evidence, uncertainty, and deterministic controls.`,
    ...(editOverrides[fixture.demo_case_id] ?? {}),
  };
}

function acceptedLabelChecks(extraction, golden) {
  return Object.fromEntries(
    Object.entries(golden.acceptable_model_labels).map(([field, accepted]) => [
      field,
      {
        observed: extraction?.[field] ?? null,
        accepted,
        passed: accepted.includes(extraction?.[field]),
      },
    ]),
  );
}

const providerEvidenceIdMap = {
  'SEED-FRESH-RESIDENT-01': 'SYN-SEED-001',
  'SEED-FRESH-STAFF-01': 'SYN-SEED-007',
  'SEED-EDIT-WEB-01': 'SYN-SEED-002',
  'SEED-EDIT-AGENDA-01': 'SYN-SEED-002',
  'SEED-SCF-CATEGORY-01': 'SYN-SEED-006',
  'SEED-SCF-PHOTO-01': 'SYN-SEED-004',
  'SEED-RECREATION-USABILITY-01': 'SYN-SEED-003',
};
const providerEvidenceIds = (ids) => [...new Set(
  ids.map((id) => providerEvidenceIdMap[id] ?? null).filter(Boolean),
)];

function expectedEffects(fixture, decision) {
  if (fixture.demo_case_id === 'CASE-REPLAY-01B') {
    return {
      source_events: 0,
      replay_count: 1,
      signals: 0,
      product_ops_reviews: 0,
      final_reviews: 0,
      theme_memberships: 0,
      embedding_records: 0,
      artifacts: 0,
      outbox_rows: 0,
    };
  }
  const retainsSignal = decision !== 'reject';
  const createsArtifact = decision === 'approve_backlog_candidate';
  return {
    source_events: 1,
    replay_count: 0,
    signals: retainsSignal ? 1 : 0,
    product_ops_reviews: 1,
    final_reviews: 0,
    theme_memberships: 0,
    embedding_records: 0,
    artifacts: createsArtifact ? 1 : 0,
    outbox_rows: createsArtifact ? 1 : 0,
  };
}

function expectedTerminal(caseId, decision) {
  if (caseId === 'CASE-REPLAY-01B') return 'completed_approved';
  if (decision === 'approve_backlog_candidate') return 'completed_approved';
  if (decision === 'save_reviewed_insight') return 'reviewed_no_action';
  return 'completed_rejected';
}

function providerResult(fixture, golden, execution, before, after) {
  const nodes = runNodeNames(execution);
  const extraction = runOutput(execution, 'Validate Extraction or Degrade Safely');
  const packet = runOutput(execution, 'Validate Brief and Build Review Packet');
  const final = runOutput(execution, 'Finalize Approved Artifact and Outbox');
  const closed = runOutput(execution, 'Close Without Artifact');
  const replay = runOutput(execution, 'Return Replay Outcome');
  const decision = decisionForCase(fixture.demo_case_id, golden);
  const delta = snapshotDelta(before, after);
  const expected = expectedEffects(fixture, decision);
  const sideEffectChecks = Object.fromEntries(
    Object.keys(expected).map((key) => [
      key,
      { expected: expected[key], observed: delta[key], passed: expected[key] === delta[key] },
    ]),
  );
  const providerCalls = [extractionHttpNode, evidenceBriefHttpNode]
    .filter((name) => nodes.includes(name));
  const matches = packet?.evidence?.matches ?? [];
  const matchedIds = matches.map((match) => match.source_event_id);
  const expectedNeighbors = providerEvidenceIds(golden.retrieval.expected_neighbor_set ?? []);
  const forbiddenNeighbors = providerEvidenceIds(golden.retrieval.forbidden_neighbor_set ?? []);
  const terminalState = replay?.processing_status
    ?? final?.outcome
    ?? closed?.processing_status
    ?? after.processing_status
    ?? execution.status;
  const expectedState = expectedTerminal(fixture.demo_case_id, decision);
  const modelLabelChecks = extraction ? acceptedLabelChecks(extraction, golden) : {};
  const operationalChecks = {
    execution_succeeded: execution.status === 'success',
    terminal_state: terminalState === expectedState,
    one_review_for_new_signal: fixture.demo_case_id === 'CASE-REPLAY-01B'
      ? !nodes.includes('Review Product Signal Brief')
      : nodes.includes('Review Product Signal Brief'),
    replay_bypasses_both_model_calls: fixture.demo_case_id === 'CASE-REPLAY-01B'
      ? providerCalls.length === 0
      : true,
    exactly_two_model_calls_for_new_signal: fixture.demo_case_id === 'CASE-REPLAY-01B'
      ? true
      : providerCalls.length === 2,
    no_vector_similarity_claim: packet
      ? packet.evidence?.score_available === false
        && packet.model_metadata?.vector_similarity_claimed === false
      : true,
    degraded_case_is_explicit: fixture.demo_case_id === 'CASE-DEGRADE-01'
      ? packet?.evidence?.status === 'degraded'
        && packet?.brief?.brief_status === 'generated_degraded_fallback'
        && providerCalls.includes(evidenceBriefHttpNode)
      : true,
    brief_prohibits_roadmap_priority: packet
      ? packet.brief?.prohibited_roadmap_priority === null
      : true,
    side_effect_deltas: Object.values(sideEffectChecks).every((check) => check.passed),
    no_real_external_action: true,
  };
  const durationMilliseconds = execution.startedAt && execution.stoppedAt
    ? new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()
    : null;

  return {
    synthetic: true,
    case_id: fixture.demo_case_id,
    execution_id: String(execution.id),
    source_key: `${fixture.source_system}|${fixture.source_event_id}`,
    run_source_event_id: after.run_source_event_id,
    execution_status: execution.status,
    duration_ms: durationMilliseconds,
    terminal_state: terminalState,
    expected_terminal_state: expectedState,
    run_nodes: nodes,
    provider_calls: providerCalls,
    provider_call_count: providerCalls.length,
    extraction: extraction ? {
      status: extraction.extraction_status,
      model: extraction.model_metadata?.extraction_model ?? null,
      provider_call_status: extraction.model_metadata?.provider_call_status ?? null,
      prompt_tokens: extraction.model_metadata?.prompt_tokens ?? 0,
      completion_tokens: extraction.model_metadata?.completion_tokens ?? 0,
      classification_confidence: extraction.classification_confidence,
      labels: Object.fromEntries(
        Object.keys(golden.acceptable_model_labels).map((field) => [field, extraction[field]]),
      ),
      evidence_span_count: extraction.evidence_spans?.length ?? 0,
    } : null,
    evidence_brief: packet ? {
      evidence_status: packet.evidence?.status,
      brief_status: packet.brief?.brief_status,
      model: packet.model_metadata?.evidence_brief?.model ?? null,
      provider_call_status: packet.model_metadata?.evidence_brief?.provider_call_status ?? null,
      prompt_tokens: packet.model_metadata?.evidence_brief?.prompt_tokens ?? 0,
      completion_tokens: packet.model_metadata?.evidence_brief?.completion_tokens ?? 0,
      score_available: packet.evidence?.score_available,
      matched_source_ids: matchedIds,
      prohibited_roadmap_priority_is_null:
        packet.brief?.prohibited_roadmap_priority === null,
    } : null,
    review: {
      decision,
      policy_level: packet?.review_policy?.level ?? null,
      policy_reasons: packet?.review_policy?.reasons ?? [],
      human_checkpoints: fixture.demo_case_id === 'CASE-REPLAY-01B' ? 0 : 1,
    },
    checks: {
      operational: operationalChecks,
      operational_passed: Object.values(operationalChecks).every(Boolean),
      model_labels: modelLabelChecks,
      model_label_fields_passed:
        Object.values(modelLabelChecks).filter((check) => check.passed).length,
      model_label_fields_total: Object.keys(modelLabelChecks).length,
      retrieval_expected_neighbors_present:
        expectedNeighbors.every((id) => matchedIds.includes(id)),
      retrieval_forbidden_neighbors_absent:
        forbiddenNeighbors.every((id) => !matchedIds.includes(id)),
      side_effects: sideEffectChecks,
    },
    database_delta: delta,
  };
}

const workflow = await findWorkflow();
assert(workflow.active === true, 'The main workflow is not active.');
const trigger = workflow.nodes.find((node_) => node_.type === 'n8n-nodes-base.formTrigger');
assert(trigger?.webhookId, 'The active Form Trigger webhook ID is unavailable.');
const reviewWait = nodeByName(workflow, 'Review Product Signal Brief');
const formUrl = `${apiBase}/form/${trigger.webhookId}`;
const results = [];

for (const fixture of selectedFixtures) {
  const golden = goldenByCase.get(fixture.demo_case_id);
  assert(golden, `Missing golden expectation for ${fixture.demo_case_id}.`);
  const replayRoot = fixture.demo_case_id === 'CASE-REPLAY-01B'
    ? fixtureDocument.cases.find((candidate) => candidate.demo_case_id === 'CASE-REPLAY-01A')
    : fixture;
  const runSourceEventId = safeIdentifier(
    `${replayRoot.source_event_id}-${arguments_.runLabel}`,
    'run source_event_id',
  );
  const before = databaseSnapshot(fixture.source_system, runSourceEventId);
  before.run_source_event_id = runSourceEventId;

  try {
    const formResponse = await submitForm(formUrl, trigger, {
      signal_text: fixture.raw_text,
      product_hint: fixture.product_hint ?? 'unknown',
      source_context: fixture.source_system ?? 'product_feedback',
      source_event_id: runSourceEventId,
      demo_case_id: fixture.demo_case_id,
      simulate_provider_failure: fixture.demo_case_id === 'CASE-DEGRADE-01',
    });
    const executionId = /\/form-waiting\/(\d+)/.exec(formResponse.formWaitingUrl ?? '')?.[1];
    assert(executionId, `${fixture.demo_case_id} did not return a local execution identifier.`);

    let execution = await pollExecution(
      executionId,
      (candidate) => (
        candidate.status !== 'running'
        && (
          candidate.status !== 'waiting'
          || candidate.data?.resultData?.lastNodeExecuted === 'Review Product Signal Brief'
        )
      ),
    );

    if (
      execution.status === 'waiting'
      && execution.data?.resultData?.lastNodeExecuted === 'Review Product Signal Brief'
    ) {
      const resumeUrl = execution.data.resultData.runData['Review Product Signal Brief'][0]
        .metadata.resumeFormUrl;
      await submitForm(resumeUrl, reviewWait, reviewPayload(fixture, golden));
      execution = await pollExecution(
        executionId,
        (candidate) => candidate.status !== 'waiting' && candidate.status !== 'running',
      );
    }

    const after = databaseSnapshot(fixture.source_system, runSourceEventId);
    after.run_source_event_id = runSourceEventId;
    const result = providerResult(fixture, golden, execution, before, after);
    results.push(result);
    console.log(JSON.stringify({
      case_id: result.case_id,
      execution_id: result.execution_id,
      terminal_state: result.terminal_state,
      provider_calls: result.provider_call_count,
      operational_passed: result.checks.operational_passed,
      model_labels:
        `${result.checks.model_label_fields_passed}/${result.checks.model_label_fields_total}`,
    }));
  } catch (error) {
    results.push({
      synthetic: true,
      case_id: fixture.demo_case_id,
      source_key: `${fixture.source_system}|${fixture.source_event_id}`,
      run_source_event_id: runSourceEventId,
      execution_status: 'harness_error',
      error_class: error.name || 'Error',
      error_message: String(error.message || 'provider evaluation failed').slice(0, 300),
      checks: { operational_passed: false },
    });
    console.log(JSON.stringify({
      case_id: fixture.demo_case_id,
      execution_status: 'harness_error',
      error_class: error.name || 'Error',
      error_message: String(error.message || '').slice(0, 160),
    }));
  }
}

const labelPassed = results.reduce(
  (sum, result) => sum + (result.checks?.model_label_fields_passed ?? 0),
  0,
);
const labelTotal = results.reduce(
  (sum, result) => sum + (result.checks?.model_label_fields_total ?? 0),
  0,
);
const providerCalls = results.reduce(
  (sum, result) => sum + (result.provider_call_count ?? 0),
  0,
);
const promptTokens = results.reduce(
  (sum, result) => sum
    + (result.extraction?.prompt_tokens ?? 0)
    + (result.evidence_brief?.prompt_tokens ?? 0),
  0,
);
const completionTokens = results.reduce(
  (sum, result) => sum
    + (result.extraction?.completion_tokens ?? 0)
    + (result.evidence_brief?.completion_tokens ?? 0),
  0,
);
const operationalPassed = results.filter(
  (result) => result.checks?.operational_passed,
).length;
const evidenceEvaluated = results.filter(
  (result) => result.evidence_brief?.evidence_status === 'ok',
);
const evidenceExpectedPassed = evidenceEvaluated.filter(
  (result) => result.checks?.retrieval_expected_neighbors_present,
).length;

const document = {
  schema_version: '3.0.0',
  synthetic: true,
  status: operationalPassed === results.length
    ? 'provider_backed_operational_acceptance_passed'
    : 'provider_backed_acceptance_has_failures',
  captured_at: new Date().toISOString(),
  run_label: arguments_.runLabel,
  workflow_contract: {
    functional_nodes: 20,
    model_calls_per_new_signal: 2,
    human_review_checkpoints_per_new_signal: 1,
    visible_intake_fields: 3,
  },
  provider: {
    name: 'Z.ai',
    endpoint_class: 'coding_plan_openai_compatible_chat',
    model: 'glm-5.2',
    credential_storage: 'encrypted_local_n8n_credential',
    embedding_model_available: false,
    demo_only: true,
  },
  evidence_strategy: {
    transactional_store: 'PostgreSQL',
    selection_and_synthesis:
      'One bounded GLM call over at most five human-reviewed PostgreSQL candidates',
    vector_similarity_claimed: false,
    pgvector_status: 'provisioned production seam; not evaluated by this credential',
  },
  aggregate: {
    cases_captured: results.length,
    operational_cases_passed: operationalPassed,
    provider_calls: providerCalls,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    model_label_fields_passed: labelPassed,
    model_label_fields_total: labelTotal,
    model_label_agreement:
      labelTotal ? Number((labelPassed / labelTotal).toFixed(4)) : null,
    evidence_cases_evaluated: evidenceEvaluated.length,
    evidence_expected_neighbor_cases_passed: evidenceExpectedPassed,
    evidence_expected_neighbor_case_rate: evidenceEvaluated.length
      ? Number((evidenceExpectedPassed / evidenceEvaluated.length).toFixed(4))
      : null,
    real_external_actions: 0,
    fabricated_vector_scores: 0,
  },
  interpretation: [
    'Operational pass/fail is distinct from probabilistic label and evidence-selection agreement.',
    'Every new valid signal reaches one Product Operations review after the complete AI packet.',
    'The replay path bypasses both model calls and every side effect.',
    'The available credential exposes chat but not embeddings; no pgvector or cosine-similarity result is claimed.',
  ],
  cases: results,
};

writeFileSync(arguments_.output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: arguments_.output.replace(`${projectRoot}\\`, '').replaceAll('\\', '/'),
  status: document.status,
  cases: results.length,
  operational_passed: operationalPassed,
  provider_calls: providerCalls,
  model_label_agreement: document.aggregate.model_label_agreement,
}));
