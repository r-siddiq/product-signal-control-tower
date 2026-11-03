import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = resolve(fileURLToPath(import.meta.url));
const expectedMainName = 'Product Signal Control Tower';
const mainWorkflowRelative = 'workflows/product-signal-control-tower.json';
const companionWorkflowRelative = 'workflows/product-signal-error-handler.json';

const reviewableRootFiles = new Set([
  '.env.example',
  'local development instructions',
  'package.json',
]);
const reviewableRootDirectories = [
  'database',
  'evaluation',
  'fixtures',
  'main',
  'presentation',
  'submission',
  'tools',
  'workflows',
];
const generatedDirectoryNames = new Set([
  '.cache',
  '.parcel-cache',
  '.playwright',
  '.vite',
  'browser-test-results',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.svg',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);

const failures = new Map();
const pending = new Map();
const parsedJson = new Map();
const scannedFiles = [];
const skippedBinaryFiles = [];
const workflowSummary = {
  main: { status: 'pending', functional_non_sticky_nodes: null },
  companion: { status: 'pending', error_trigger_nodes: null },
};
const fixtureSummary = {
  status: 'not_checked',
  signal_cases: null,
  golden_cases: null,
  reviewed_seeds: null,
};
const providerEvidenceSummary = {
  status: 'not_checked',
  cases_captured: null,
  operational_cases_passed: null,
  provider_calls: null,
  model: null,
};
const otelEvidenceSummary = {
  status: 'not_checked',
  cases_captured: null,
  native_n8n_tracing: null,
  wait_resume_links: null,
};
const cleanImportSummary = {
  status: 'not_checked',
  probes_imported: null,
  probes_removed: null,
};
const workflowLayoutSummary = {
  status: 'not_checked',
  functional_nodes: null,
  visual_groups: null,
};
const presentationQaSummary = {
  status: 'not_checked',
  file_mode: null,
  viewports: null,
  pdf_pages: null,
};

function toRelative(path) {
  return relative(projectRoot, path).split(sep).join('/');
}

function incrementFinding(collection, rule, path, count = 1) {
  const key = `${rule}\u0000${path}`;
  const current = collection.get(key);
  if (current) {
    current.count += count;
  } else {
    collection.set(key, { rule, path, count });
  }
}

function fail(rule, path, count = 1) {
  incrementFinding(failures, rule, path, count);
}

function pend(rule, path) {
  incrementFinding(pending, rule, path);
}

function isExcluded(relativePath, directoryName = '') {
  const normalized = relativePath.split(sep).join('/');
  if (normalized === '.env') return true;
  if (
    normalized === 'evaluation/local'
    || normalized.startsWith('evaluation/local/')
    || normalized === 'submission/.working'
    || normalized.startsWith('submission/.working/')
  ) {
    return true;
  }
  return generatedDirectoryNames.has(directoryName);
}

function collectDirectory(path) {
  const relativeDirectory = toRelative(path);
  const directoryName = relativeDirectory.split('/').at(-1) ?? '';
  if (isExcluded(relativeDirectory, directoryName)) return;

  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    fail('artifact.read_failed', relativeDirectory);
    return;
  }

  for (const entry of entries) {
    const childPath = join(path, entry.name);
    const childRelative = toRelative(childPath);
    if (isExcluded(childRelative, entry.name)) continue;

    if (entry.isSymbolicLink()) {
      fail('artifact.symlink_not_allowed', childRelative);
    } else if (entry.isDirectory()) {
      collectDirectory(childPath);
    } else if (entry.isFile() && childPath !== verifierPath) {
      scannedFiles.push(childPath);
    }
  }
}

for (const name of reviewableRootFiles) {
  const path = resolve(projectRoot, name);
  if (existsSync(path) && lstatSync(path).isFile()) scannedFiles.push(path);
}
for (const name of reviewableRootDirectories) {
  const path = resolve(projectRoot, name);
  if (existsSync(path) && lstatSync(path).isDirectory()) collectDirectory(path);
}

scannedFiles.sort((left, right) => toRelative(left).localeCompare(toRelative(right)));

for (const path of scannedFiles) {
  if (extname(path).toLowerCase() !== '.json') continue;
  try {
    parsedJson.set(path, JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    fail('json.parse_failed', toRelative(path));
  }
}

const mandatoryCaseIds = [
  'CASE-FRESH-01',
  'CASE-FRESH-02',
  'CASE-FRESH-03',
  'CASE-EDIT-01',
  'CASE-EDIT-02',
  'CASE-SCF-01',
  'CASE-SCF-02',
  'CASE-PII-01',
  'CASE-AMB-01',
  'CASE-URGENT-01',
  'CASE-UNREL-01',
  'CASE-UNREL-02',
  'CASE-REPLAY-01A',
  'CASE-REPLAY-01B',
  'CASE-DEGRADE-01',
  'CASE-REJECT-01',
];
const inputEnums = {
  source_system: new Set([
    'support',
    'customer_success',
    'product_feedback',
    'research',
    'internal_escalation',
  ]),
  customer_segment: new Set([
    'small_municipality',
    'mid_market_government',
    'large_government',
    'special_district',
    'unknown',
  ]),
  channel: new Set([
    'ticket',
    'crm_note',
    'feedback_form',
    'interview',
    'internal_message',
  ]),
  product_hint: new Set(["agenda_and_meeting", "analytics_assistant", "municipal_websites", "process_automation", "recreation_management", "resident_request_tracking", "signal_agent", "unknown"]),
};
const modelEnums = {
  product_family: inputEnums.product_hint,
  intelligence_capability: new Set([
    'resident_qa',
    'staff_qa',
    'content_advisor',
    'editing_assistant',
    'category_search',
    'photo_analysis',
    'code_review',
    'none',
    'unknown',
  ]),
  government_role: new Set([
    'communications',
    'clerk',
    'it_administrator',
    'community_development',
    'public_safety',
    'parks_and_recreation',
    'customer_service',
    'executive',
    'resident',
    'unknown',
  ]),
  signal_type: new Set([
    'bug',
    'feature_request',
    'usability',
    'data_quality',
    'integration',
    'performance',
    'trust_and_safety',
    'workflow_gap',
    'positive_outcome',
    'unknown',
  ]),
  ai_feedback_type: new Set([
    'answer_quality',
    'source_freshness',
    'editing_accuracy',
    'classification_accuracy',
    'accessibility',
    'privacy',
    'transparency',
    'workflow_value',
    'usability',
    'not_ai_related',
    'unknown',
  ]),
  trust_risk: new Set(['none', 'low', 'medium', 'high', 'unknown']),
  sentiment: new Set(['positive', 'neutral', 'mixed', 'negative', 'unknown']),
  urgency: new Set(['low', 'medium', 'high', 'critical', 'unknown']),
  customer_impact: new Set([
    'single_user',
    'single_department',
    'multiple_departments',
    'resident_facing',
    'government_wide',
    'unknown',
  ]),
};

function sameUniqueSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return actualSet.size === actual.length
    && expected.every((value) => actualSet.has(value));
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function validateFixtureContract() {
  const fixturePaths = {
    signals: resolve(projectRoot, 'fixtures', 'synthetic-signals.json'),
    golden: resolve(projectRoot, 'fixtures', 'golden-expectations.json'),
    seeds: resolve(projectRoot, 'fixtures', 'reviewed-signal-seed.json'),
  };

  for (const path of Object.values(fixturePaths)) {
    if (!existsSync(path)) fail('fixture.required_file_missing', toRelative(path));
  }
  if (
    Object.values(fixturePaths).some((path) => !parsedJson.has(path))
  ) {
    fixtureSummary.status = 'failed';
    return;
  }

  const before = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  const signals = parsedJson.get(fixturePaths.signals);
  const golden = parsedJson.get(fixturePaths.golden);
  const seeds = parsedJson.get(fixturePaths.seeds);
  const signalCases = Array.isArray(signals?.cases) ? signals.cases : [];
  const goldenCases = Array.isArray(golden?.cases) ? golden.cases : [];
  const reviewedSeeds = Array.isArray(seeds?.reviewed_signals)
    ? seeds.reviewed_signals
    : [];
  fixtureSummary.signal_cases = signalCases.length;
  fixtureSummary.golden_cases = goldenCases.length;
  fixtureSummary.reviewed_seeds = reviewedSeeds.length;

  for (const [name, document] of Object.entries({ signals, golden, seeds })) {
    if (document?.synthetic !== true) {
      fail('fixture.synthetic_flag_missing', `fixtures/${name}`);
    }
  }

  const signalIds = signalCases.map((entry) => entry.demo_case_id);
  const goldenIds = goldenCases.map((entry) => entry.case_id);
  if (!sameUniqueSet(signalIds, mandatoryCaseIds)) {
    fail('fixture.signal_case_ids_invalid', 'fixtures/synthetic-signals.json');
  }
  if (!sameUniqueSet(goldenIds, mandatoryCaseIds)) {
    fail('fixture.golden_case_ids_invalid', 'fixtures/golden-expectations.json');
  }

  const piiPattern = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)|(?:(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4})/i;
  for (const entry of signalCases) {
    const id = typeof entry.demo_case_id === 'string' ? entry.demo_case_id : 'unknown';
    if (entry.synthetic !== true) {
      fail('fixture.synthetic_flag_missing', `fixtures/synthetic-signals.json#${id}`);
    }
    for (const [field, allowed] of Object.entries(inputEnums)) {
      if (!allowed.has(entry[field])) {
        fail(`fixture.input_enum_invalid.${field}`, `fixtures/synthetic-signals.json#${id}`);
      }
    }
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(entry.source_event_id ?? '')) {
      fail('fixture.source_event_id_invalid', `fixtures/synthetic-signals.json#${id}`);
    }
    if (
      typeof entry.raw_text !== 'string'
      || entry.raw_text.length < 30
      || entry.raw_text.length > 4000
    ) {
      fail('fixture.raw_text_length_invalid', `fixtures/synthetic-signals.json#${id}`);
    }
    if (!validIsoTimestamp(entry.received_at)) {
      fail('fixture.timestamp_invalid', `fixtures/synthetic-signals.json#${id}`);
    }
    const contactText = `${entry.raw_text ?? ''} ${entry.synthetic_contact ?? ''}`;
    const hasPiiLikeValue = piiPattern.test(contactText);
    if (id === 'CASE-PII-01' ? !hasPiiLikeValue : hasPiiLikeValue) {
      fail('fixture.pii_case_isolation_invalid', `fixtures/synthetic-signals.json#${id}`);
    }
  }

  const replayA = signalCases.find((entry) => entry.demo_case_id === 'CASE-REPLAY-01A');
  const replayB = signalCases.find((entry) => entry.demo_case_id === 'CASE-REPLAY-01B');
  if (
    !replayA
    || !replayB
    || replayA.source_system !== replayB.source_system
    || replayA.source_event_id !== replayB.source_event_id
  ) {
    fail('fixture.replay_identity_invalid', 'fixtures/synthetic-signals.json');
  }

  const retrievableIds = new Set([
    ...mandatoryCaseIds,
    ...reviewedSeeds.map((entry) => entry.seed_id),
  ]);
  for (const expectation of goldenCases) {
    const id = typeof expectation.case_id === 'string' ? expectation.case_id : 'unknown';
    if (expectation.synthetic !== true) {
      fail('fixture.synthetic_flag_missing', `fixtures/golden-expectations.json#${id}`);
    }
    for (const [field, allowed] of Object.entries(modelEnums)) {
      const values = expectation.acceptable_model_labels?.[field];
      if (
        !Array.isArray(values)
        || values.some((value) => !allowed.has(value))
      ) {
        fail(`fixture.model_enum_invalid.${field}`, `fixtures/golden-expectations.json#${id}`);
      }
    }
    for (
      const requiredField of [
        'exact_deterministic_expectations',
        'acceptable_model_labels',
        'forbidden_claims_or_actions',
        'review',
        'retrieval',
        'expected_terminal_state',
        'expected_side_effect_counts',
      ]
    ) {
      if (!Object.hasOwn(expectation, requiredField)) {
        fail(`fixture.golden_section_missing.${requiredField}`, `fixtures/golden-expectations.json#${id}`);
      }
    }
    for (
      const neighbor of [
        ...(expectation.retrieval?.expected_neighbor_set ?? []),
        ...(expectation.retrieval?.forbidden_neighbor_set ?? []),
      ]
    ) {
      if (!retrievableIds.has(neighbor)) {
        fail('fixture.retrieval_reference_missing', `fixtures/golden-expectations.json#${id}`);
      }
    }
    for (const value of Object.values(expectation.expected_side_effect_counts ?? {})) {
      if (!Number.isInteger(value) || value < 0) {
        fail('fixture.side_effect_count_invalid', `fixtures/golden-expectations.json#${id}`);
      }
    }
  }

  if (reviewedSeeds.length < 6) {
    fail('fixture.reviewed_seed_count_invalid', 'fixtures/reviewed-signal-seed.json');
  }
  if (
    seeds.embedding_contract?.model !== 'text-embedding-3-small'
    || seeds.embedding_contract?.dimensions !== 1024
    || seeds.embedding_contract?.selection_status !== 'legacy_candidate_not_selected_or_executed'
    || seeds.embedding_contract?.generation_status !== 'not_executed'
    || seeds.embedding_contract?.vectors_included !== false
    || seeds.embedding_contract?.similarity_scores_included !== false
  ) {
    fail('fixture.embedding_contract_invalid', 'fixtures/reviewed-signal-seed.json');
  }
  for (const seed of reviewedSeeds) {
    const id = typeof seed.seed_id === 'string' ? seed.seed_id : 'unknown';
    if (seed.synthetic !== true || seed.review_status !== 'approved') {
      fail('fixture.reviewed_seed_state_invalid', `fixtures/reviewed-signal-seed.json#${id}`);
    }
    if (
      seed.embedding_dimensions !== 1024
      || seed.embedding_status !== 'not_executed'
      || Object.hasOwn(seed, 'embedding')
      || Object.hasOwn(seed, 'vector')
      || Object.hasOwn(seed, 'score')
      || Object.hasOwn(seed, 'similarity_score')
    ) {
      fail('fixture.reviewed_seed_embedding_invalid', `fixtures/reviewed-signal-seed.json#${id}`);
    }
    if (!validIsoTimestamp(seed.received_at) || !validIsoTimestamp(seed.reviewed_at)) {
      fail('fixture.timestamp_invalid', `fixtures/reviewed-signal-seed.json#${id}`);
    }
    for (const [field, allowed] of Object.entries(modelEnums)) {
      if (!allowed.has(seed[field])) {
        fail(`fixture.model_enum_invalid.${field}`, `fixtures/reviewed-signal-seed.json#${id}`);
      }
    }
  }

  const after = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  fixtureSummary.status = after === before ? 'passed' : 'failed';
}

function validateRedactedCapture(relativePath, rule, requiredKeys) {
  const fullPath = resolve(projectRoot, relativePath);
  if (!existsSync(fullPath)) {
    fail(rule, relativePath);
    return;
  }
  try {
    const capture = JSON.parse(readFileSync(fullPath, "utf8"));
    const source = capture && capture.source_capture;
    const valid = capture && typeof capture.provenance === "string"
      && source && typeof source === "object"
      && typeof source.captured_at === "string" && Number.isFinite(Date.parse(source.captured_at))
      && typeof source.status === "string"
      && requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(source, key));
    if (!valid) fail(rule, relativePath);
  } catch {
    fail(rule, relativePath);
  }
}

function validateProviderEvidence() {
validateRedactedCapture("evaluation/historical/provider-capture.redacted.json", "evidence.provider_capture_missing", ["cases", "aggregate", "provider", "synthetic"]);
}

function validateOtelEvidence() {
validateRedactedCapture("evaluation/historical/observability-capture.redacted.json", "evidence.otel_capture_contract_invalid", ["cases", "source", "synthetic"]);
}

function validateCleanImportEvidence() {
validateRedactedCapture("evaluation/historical/clean-import-capture.redacted.json", "evidence.clean_import_contract_invalid", ["checks", "created_inactive_probe_workflows", "removed_probe_workflows", "synthetic"]);
}

function validateWorkflowLayoutEvidence() {
  const relativePath = 'evaluation/workflow-layout-captured-results.json';
  const path = resolve(projectRoot, relativePath);
  if (!existsSync(path) || !parsedJson.has(path)) {
    fail('evidence.workflow_layout_missing_or_invalid', relativePath);
    workflowLayoutSummary.status = 'failed';
    return;
  }
  const before = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  const evidence = parsedJson.get(path);
  workflowLayoutSummary.functional_nodes = evidence?.functional_nodes ?? null;
  workflowLayoutSummary.visual_groups = evidence?.visual_groups ?? null;
  const checks = evidence?.checks ?? {};
  if (
    evidence?.synthetic !== true
    || evidence?.status !== 'workflow_layout_acceptance_passed'
    || evidence?.functional_nodes !== 20
    || evidence?.visual_groups !== 4
    || !Object.values(checks).every((value) => value === true)
    || Object.values(evidence?.violations ?? {}).some(
      (entries) => !Array.isArray(entries) || entries.length !== 0,
    )
  ) {
    fail('evidence.workflow_layout_contract_invalid', relativePath);
  }
  const after = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  workflowLayoutSummary.status = after === before ? 'passed' : 'failed';
}

function validatePresentationQaEvidence() {
validateRedactedCapture("evaluation/historical/presentation-qa-capture.redacted.json", "evidence.presentation_qa_contract_invalid", ["standalone_html", "pdf"]);
}

function containsObjectKey(value, targetKey) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, targetKey)) return true;
  return Object.values(value).some((child) => containsObjectKey(child, targetKey));
}

const forbiddenExternalTypeFragments = [
  '.airtable',
  '.discord',
  '.emailSend',
  '.ftp',
  '.gmail',
  '.googleSheets',
  '.httpRequest',
  '.hubspot',
  '.jira',
  '.microsoftOutlook',
  '.microsoftTeams',
  '.notion',
  '.productboard',
  '.s3',
  '.salesforce',
  '.slack',
  '.ssh',
  '.twilio',
  '.zendesk',
];

function workflowNodeTypeViolations(nodes) {
  const violations = {
    aiAgent: 0,
    aws: 0,
    externalAction: 0,
    approvedProviderCall: 0,
  };
  for (const node of nodes) {
    const type = String(node?.type ?? '');
    const lower = type.toLowerCase();
    if (
      lower.endsWith('.agent')
      || lower.includes('nodes-langchain.agent')
      || lower.includes('aiagent')
    ) {
      violations.aiAgent += 1;
    }
    if (lower.includes('aws') || lower.includes('amazon')) {
      violations.aws += 1;
    }
    const approvedProviderCall = (
      lower === 'n8n-nodes-base.httprequest'
      && node?.parameters?.method === 'POST'
      && node?.parameters?.url === 'https://api.z.ai/api/coding/paas/v4/chat/completions'
      && node?.parameters?.authentication === 'genericCredentialType'
      && node?.parameters?.genericAuthType === 'httpHeaderAuth'
      && node?.parameters?.options?.redirect?.redirect?.followRedirects === false
    );
    if (approvedProviderCall) {
      violations.approvedProviderCall += 1;
    } else if (
      forbiddenExternalTypeFragments.some((fragment) => lower.includes(fragment.toLowerCase()))
    ) {
      violations.externalAction += 1;
    }
  }
  return violations;
}

function validateWorkflow(relativePath, kind) {
  const path = resolve(projectRoot, relativePath);
  if (!existsSync(path)) {
    pend(`workflow.${kind}_missing`, relativePath);
    return;
  }
  if (!parsedJson.has(path)) {
    workflowSummary[kind].status = 'failed';
    return;
  }

  const before = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  const workflow = parsedJson.get(path);
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  if (!Array.isArray(workflow?.nodes)) fail('workflow.nodes_missing', relativePath);
  if (containsObjectKey(workflow, 'credentials')) {
    fail('workflow.credential_block_present', relativePath);
  }

  const violations = workflowNodeTypeViolations(nodes);
  if (violations.aiAgent > 0) fail('workflow.ai_agent_node_present', relativePath, violations.aiAgent);
  if (violations.aws > 0) fail('workflow.aws_node_present', relativePath, violations.aws);
  if (violations.externalAction > 0) {
    fail(
      kind === 'companion'
        ? 'workflow.external_notification_node_present'
        : 'workflow.real_external_action_node_present',
      relativePath,
      violations.externalAction,
    );
  }

  if (kind === 'main') {
    if (workflow?.name !== expectedMainName) {
      fail('workflow.main_name_invalid', relativePath);
    }
    const functionalNodes = nodes.filter(
      (node) => String(node?.type ?? '').toLowerCase() !== 'n8n-nodes-base.stickynote',
    );
    workflowSummary.main.functional_non_sticky_nodes = functionalNodes.length;
    if (functionalNodes.length !== 20) {
      fail('workflow.main_functional_node_count_invalid', relativePath);
    }
    if (violations.approvedProviderCall !== 2) {
      fail(
        'workflow.approved_provider_call_count_invalid',
        relativePath,
        Math.abs(2 - violations.approvedProviderCall) || 1,
      );
    }
    const waitNodes = functionalNodes.filter(
      (node) => String(node?.type ?? '').toLowerCase() === 'n8n-nodes-base.wait',
    );
    if (waitNodes.length !== 1) {
      fail('workflow.single_human_checkpoint_invalid', relativePath);
    }
    const trigger = functionalNodes.find((node) => node.name === 'Submit Product Signal');
    const formFields = trigger?.parameters?.formFields?.values ?? [];
    const visibleFields = formFields.filter((field) => field.fieldType !== 'hiddenField');
    if (visibleFields.length !== 3 || formFields.length !== 6) {
      fail('workflow.form_field_contract_invalid', relativePath);
    }
    const stickyCount = nodes.length - functionalNodes.length;
    if (stickyCount !== 4) {
      fail('workflow.visual_lane_count_invalid', relativePath);
    }
  } else {
    const errorTriggerCount = nodes.filter(
      (node) => String(node?.type ?? '').toLowerCase() === 'n8n-nodes-base.errortrigger',
    ).length;
    workflowSummary.companion.error_trigger_nodes = errorTriggerCount;
    if (errorTriggerCount < 1) {
      fail('workflow.companion_error_trigger_missing', relativePath);
    }
  }

  const after = [...failures.values()].reduce((sum, item) => sum + item.count, 0);
  workflowSummary[kind].status = after === before ? 'passed' : 'failed';
}

function isPlaceholderOrDynamic(value) {
  const normalized = String(value).trim().replace(/^['"]|['"]$/g, '');
  if (!normalized) return true;
  return (
    /^(?:false|true|null|undefined)$/i.test(normalized)
    || /(?:replace|placeholder|example|invalid|redacted|generate|change[_-]?me|credential-gated|pending|unset|dummy|test-only)/i.test(normalized)
    || normalized.startsWith('${')
    || normalized.startsWith('<')
    || /^(?:process|runtime|env)\./i.test(normalized)
    || /^(?:randomBytes|crypto\.|getenv|current_setting)\b/i.test(normalized)
  );
}

function inspectJsonSecrets(value, relativePath) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      typeof child === 'string'
      && /(?:apikey|password|clientsecret|accesstoken|authtoken|privatekey)$/.test(normalizedKey)
      && !isPlaceholderOrDynamic(child)
    ) {
      fail('secret.sensitive_json_assignment', relativePath);
    }
    if (
      typeof child === 'string'
      && /(?:credentialid|idcredential)$/.test(normalizedKey)
      && !isPlaceholderOrDynamic(child)
    ) {
      fail('secret.local_credential_id', relativePath);
    }
    inspectJsonSecrets(child, relativePath);
  }
}

const knownSecretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];
const assignmentPattern = /\b([A-Za-z0-9_.-]*(?:API[_-]?KEY|PASSWORD|CLIENT[_-]?SECRET|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PRIVATE[_-]?KEY)[A-Za-z0-9_.-]*)\s*[:=]\s*([^\s,;#}]+)/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const windowsPathPattern = /(?:^|[\s"'(])([A-Za-z]:[\\/][^\s"'<>)]*)/gm;
const unsupportedClaimPatterns = [
  /\bGovRAMP[\s-]+(?:certified|authorized|compliant|approved)\b/gi,
  /\bFedRAMP[\s-]+(?:certified|authorized|compliant|approved)\b/gi,
  /\bHIPAA[\s-]+(?:certified|compliant)\b/gi,
  /\bSOC\s*2[\s-]+certified\b/gi,
];

for (const path of scannedFiles) {
  const relativePath = toRelative(path);
  const extension = extname(path).toLowerCase();
  const isKnownRootText = relativePath === '.env.example';
  if (!textExtensions.has(extension) && !isKnownRootText) {
    skippedBinaryFiles.push(relativePath);
    continue;
  }

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail('artifact.read_failed', relativePath);
    continue;
  }

  if (parsedJson.has(path)) inspectJsonSecrets(parsedJson.get(path), relativePath);

  for (const pattern of knownSecretPatterns) {
    const matches = text.match(pattern);
    if (matches?.length) fail('secret.known_api_key_pattern', relativePath, matches.length);
  }

  assignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(assignmentPattern)) {
    if (!isPlaceholderOrDynamic(match[2])) {
      fail('secret.sensitive_assignment', relativePath);
    }
  }

  emailPattern.lastIndex = 0;
  for (const match of text.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    if (
      !domain.endsWith('.invalid')
      && !['example.com', 'example.net', 'example.org'].includes(domain)
    ) {
      fail('privacy.real_email_domain', relativePath);
    }
  }

  windowsPathPattern.lastIndex = 0;
  const windowsPaths = [...text.matchAll(windowsPathPattern)];
  if (windowsPaths.length > 0) {
    fail('portability.absolute_windows_path', relativePath, windowsPaths.length);
  }

  for (const pattern of unsupportedClaimPatterns) {
    const matches = text.match(pattern);
    if (matches?.length) fail('claim.unsupported_high_risk', relativePath, matches.length);
  }

  const credentialIdMatches = text.match(
    /["']?(?:credentialId|credential_id)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{8,}["']/g,
  );
  if (credentialIdMatches?.length) {
    fail('secret.local_credential_id', relativePath, credentialIdMatches.length);
  }
}

validateFixtureContract();
validateProviderEvidence();
validateOtelEvidence();
validateCleanImportEvidence();
validateWorkflowLayoutEvidence();
validatePresentationQaEvidence();
validateWorkflow(mainWorkflowRelative, 'main');
validateWorkflow(companionWorkflowRelative, 'companion');

const projectScopeExclusions = [
  "Root and runtime .env files are local configuration and excluded from checked-in source scans",
  "evaluation/local/ and runtime/tmp/ are generated evidence and temporary output locations",
  "Agent configuration and instruction files are absent from the project tree",
  "An earlier reference matrix is not included with the project files",
  "The original presentation scripts are not part of the summary page at presentation/index.html",
  "Supporting project artifacts are outside the retained project scope",
];
const genericPresentationPath = resolve(projectRoot, "presentation/index.html");
if (!existsSync(genericPresentationPath)) fail("artifact.generic_portfolio_presentation_missing", "presentation/index.html");
validateRedactedCapture("evaluation/historical/playwright-2026-08-04.redacted.json", "evidence.august_capture_missing_or_invalid", ["scenarios", "mode", "synthetic"]);
const currentMockPath = resolve(projectRoot, "evaluation/current-mock-run.json");
if (!existsSync(currentMockPath)) {
  fail("evidence.current_mock_run_missing", "evaluation/current-mock-run.json");
} else {
  try {
    const mock = JSON.parse(readFileSync(currentMockPath, "utf8"));
    const scenarios = mock && mock.playwright && mock.playwright.scenarios;
    const actual = Array.isArray(scenarios) ? scenarios.map((item) => item.scenario).sort() : [];
    const expected = ["approve", "invalid", "reject", "replay"];
    const migrationsOk = mock.database_migrations && mock.database_migrations.fresh_database_apply_passed === true && mock.database_migrations.repeat_application_refused === true;
    const importOk = mock.workflow_import && mock.workflow_import.documented_inactive_import === true && mock.workflow_import.explicit_activation === true;
    const mockOnly = mock.isolation && mock.isolation.real_provider_calls === 0 && mock.isolation.local_structured_mock_calls > 0;
    const scenariosOk = Array.isArray(scenarios) && scenarios.length === 4 && JSON.stringify(actual) === JSON.stringify(expected) && scenarios.every((item) => item.passed === true);
    if (!migrationsOk || !importOk || !mockOnly || !scenariosOk) fail("evidence.current_mock_run_invalid", "evaluation/current-mock-run.json");
  } catch {
    fail("evidence.current_mock_run_invalid", "evaluation/current-mock-run.json");
  }
}

const sortedFailures = [...failures.values()].sort(
  (left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
);
const sortedPending = [...pending.values()].sort(
  (left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
);

const summary = {
  verifier: 'verify-project-static',
  version: '1.0.0',
  project_scope: '.',
  read_only: true,
  passed: sortedFailures.length === 0,
  counts: {
    files_scanned: scannedFiles.length,
    json_files_parsed: parsedJson.size,
    binary_files_not_content_scanned: skippedBinaryFiles.length,
    failures: sortedFailures.reduce((sum, item) => sum + item.count, 0),
    pending: sortedPending.reduce((sum, item) => sum + item.count, 0),
  },
  fixture_contract: fixtureSummary,
  provider_evidence: providerEvidenceSummary,
  otel_evidence: otelEvidenceSummary,
  clean_import_evidence: cleanImportSummary,
  workflow_layout_evidence: workflowLayoutSummary,
  presentation_qa_evidence: presentationQaSummary,
  workflows: workflowSummary,
  failures: sortedFailures,
  pending: sortedPending,
  exclusions: projectScopeExclusions,
  sanitized_output: true,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.passed ? 0 : 1;
