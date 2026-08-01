import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'fixtures');
const readJson = (name) => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));

const signals = readJson('synthetic-signals.json');
const golden = readJson('golden-expectations.json');
const seeds = readJson('reviewed-signal-seed.json');
const browserDemo = readJson('playwright-demo-scenarios.json');

const mandatoryIds = [
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

const allowed = {
  source_system: new Set(['support', 'customer_success', 'product_feedback', 'research', 'internal_escalation']),
  customer_segment: new Set(['small_municipality', 'mid_market_government', 'large_government', 'special_district', 'unknown']),
  channel: new Set(['ticket', 'crm_note', 'feedback_form', 'interview', 'internal_message']),
};

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const document of [signals, golden, seeds, browserDemo]) {
  assert(document.synthetic === true, `${document.description ?? 'fixture document'} must declare synthetic=true`);
}

const signalCases = signals.cases ?? [];
const goldenCases = golden.cases ?? [];
const signalIds = signalCases.map((entry) => entry.demo_case_id);
const goldenIds = goldenCases.map((entry) => entry.case_id);
const browserScenarioNames = browserDemo.default_order ?? [];
const browserScenarios = browserDemo.scenarios ?? {};

assert(signalCases.length === 16, `expected 16 signal cases, found ${signalCases.length}`);
assert(goldenCases.length === 16, `expected 16 golden cases, found ${goldenCases.length}`);
assert(signals.schema_version === '2.0.0', 'signal fixtures must use the lean v2 schema');
assert(golden.schema_version === '2.0.0', 'golden expectations must use the lean v2 schema');
assert(new Set(signalIds).size === 16, 'signal case IDs must be unique');
assert(new Set(goldenIds).size === 16, 'golden case IDs must be unique');
assert(JSON.stringify([...signalIds].sort()) === JSON.stringify([...mandatoryIds].sort()), 'signal case IDs do not match the mandatory set');
assert(JSON.stringify([...goldenIds].sort()) === JSON.stringify([...mandatoryIds].sort()), 'golden case IDs do not match the mandatory set');
assert(browserDemo.schema_version === '1.0.0', 'browser demo fixtures must use schema v1');
assert(
  JSON.stringify(browserScenarioNames) === JSON.stringify(['invalid', 'replay', 'reject', 'approve']),
  'browser demo order must be invalid, replay, reject, approve',
);
assert(Object.keys(browserScenarios).length === 4, 'browser demo must define exactly four visible scenarios');
assert(
  browserScenarios.invalid?.signal_text?.length > 0
    && browserScenarios.invalid.signal_text.length < 30,
  'browser invalid fixture must be non-empty and shorter than the 30-character workflow minimum',
);
assert(browserScenarios.replay?.preparation_fixture_ref === 'CASE-REPLAY-01A', 'browser replay must use the real canonical preparation fixture');
assert(browserScenarios.replay?.fixture_ref === 'CASE-REPLAY-01B', 'browser replay must use the exact replay fixture');
assert(browserScenarios.reject?.fixture_ref === 'CASE-REJECT-01', 'browser rejection must use CASE-REJECT-01');
assert(browserScenarios.reject?.review_decision === 'reject', 'browser rejection must simulate a human reject decision');
assert(browserScenarios.approve?.fixture_ref === 'CASE-FRESH-02', 'browser approval must use CASE-FRESH-02');
assert(browserScenarios.approve?.review_decision === 'approve_backlog_candidate', 'browser approval must create only the local backlog-candidate stub');
for (const scenarioName of browserScenarioNames) {
  const scenario = browserScenarios[scenarioName];
  assert(scenario?.scenario_id?.startsWith('DEMO-'), `${scenarioName} must have a synthetic DEMO scenario ID`);
  assert(scenario?.expected, `${scenarioName} must define deterministic expectations`);
  for (const fixtureReference of [scenario?.fixture_ref, scenario?.preparation_fixture_ref].filter(Boolean)) {
    assert(signalIds.includes(fixtureReference), `${scenarioName} references missing fixture ${fixtureReference}`);
  }
}

for (const entry of signalCases) {
  assert(entry.synthetic === true, `${entry.demo_case_id} must declare synthetic=true`);
  assert(allowed.source_system.has(entry.source_system), `${entry.demo_case_id} has an invalid source_system`);
  assert(allowed.customer_segment.has(entry.customer_segment), `${entry.demo_case_id} has an invalid customer_segment`);
  assert(allowed.channel.has(entry.channel), `${entry.demo_case_id} has an invalid channel`);
  assert(/^[A-Za-z0-9._:-]{1,100}$/.test(entry.source_event_id), `${entry.demo_case_id} has an invalid source_event_id`);
  assert(entry.raw_text.length >= 30 && entry.raw_text.length <= 4000, `${entry.demo_case_id} raw_text is outside 30-4000 characters`);
  assert(!Number.isNaN(Date.parse(entry.received_at)), `${entry.demo_case_id} has an invalid timestamp`);
  assert(
    entry.simulate_provider_failure === (entry.demo_case_id === 'CASE-DEGRADE-01'),
    `${entry.demo_case_id} has an unexpected provider-failure control`,
  );
}

const replayA = signalCases.find((entry) => entry.demo_case_id === 'CASE-REPLAY-01A');
const replayB = signalCases.find((entry) => entry.demo_case_id === 'CASE-REPLAY-01B');
assert(
  replayA?.source_system === replayB?.source_system && replayA?.source_event_id === replayB?.source_event_id,
  'replay fixtures must share the exact source identity',
);

const piiLikePattern = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)|(?:(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4})/gi;
for (const entry of signalCases) {
  const combined = entry.raw_text ?? '';
  if (entry.demo_case_id === 'CASE-PII-01') {
    assert(piiLikePattern.test(combined), 'CASE-PII-01 must contain an obvious synthetic email or phone');
  } else {
    assert(!piiLikePattern.test(combined), `${entry.demo_case_id} unexpectedly contains PII-like fixture data`);
  }
  piiLikePattern.lastIndex = 0;
}

const seedSignals = seeds.reviewed_signals ?? [];
assert(seedSignals.length >= 6, `expected at least six reviewed seeds, found ${seedSignals.length}`);
assert(seeds.embedding_contract?.model === 'text-embedding-3-small', 'seed embedding model must be text-embedding-3-small');
assert(seeds.embedding_contract?.dimensions === 1024, 'seed embedding dimensions must be 1024');
assert(
  seeds.embedding_contract?.selection_status === 'legacy_candidate_not_selected_or_executed',
  'seed embedding contract must be labeled as an unselected, unexecuted legacy candidate',
);
assert(seeds.embedding_contract?.generation_status === 'not_executed', 'seed embeddings must remain unexecuted');
assert(seeds.embedding_contract?.vectors_included === false, 'seed fixtures must not include vectors');
assert(seeds.embedding_contract?.similarity_scores_included === false, 'seed fixtures must not include similarity scores');

const seedIds = new Set(seedSignals.map((entry) => entry.seed_id));
const retrievableIds = new Set([...seedIds, ...mandatoryIds]);
const allowedDecisions = new Set([
  'approve_backlog_candidate',
  'save_reviewed_insight',
  'reject',
  null,
]);
for (const expectation of goldenCases) {
  assert(
    allowedDecisions.has(expectation.review?.decision),
    `${expectation.case_id} has an invalid lean review decision`,
  );
  assert(
    expectation.expected_side_effect_counts?.final_reviews_created === 0,
    `${expectation.case_id} must not expect a second review`,
  );
  assert(
    expectation.expected_side_effect_counts?.theme_memberships_created === 0,
    `${expectation.case_id} must not expect inline theme administration`,
  );
  assert(
    expectation.expected_side_effect_counts?.vector_index_requests === 0,
    `${expectation.case_id} must not expect vector indexing`,
  );
  const neighbors = expectation.retrieval?.expected_neighbor_set ?? [];
  const forbiddenNeighbors = expectation.retrieval?.forbidden_neighbor_set ?? [];
  for (const neighbor of neighbors) {
    assert(retrievableIds.has(neighbor), `${expectation.case_id} references missing retrievable ID ${neighbor}`);
  }
  for (const neighbor of forbiddenNeighbors) {
    assert(retrievableIds.has(neighbor), `${expectation.case_id} references missing forbidden retrievable ID ${neighbor}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ valid: false, failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    valid: true,
    signal_cases: signalCases.length,
    golden_cases: goldenCases.length,
    reviewed_seeds: seedSignals.length,
    browser_demo_scenarios: browserScenarioNames.length,
    future_embedding_candidate: seeds.embedding_contract.model,
    future_embedding_dimensions: seeds.embedding_contract.dimensions,
    embedding_selection_status: seeds.embedding_contract.selection_status,
    vectors_included: seeds.embedding_contract.vectors_included,
  }, null, 2)}\n`);
}
