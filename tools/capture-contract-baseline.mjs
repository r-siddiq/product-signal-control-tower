import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(
  readFileSync(resolve(projectRoot, 'fixtures', 'synthetic-signals.json'), 'utf8'),
);
const golden = JSON.parse(
  readFileSync(resolve(projectRoot, 'fixtures', 'golden-expectations.json'), 'utf8'),
);
const workflow = JSON.parse(
  readFileSync(
    resolve(projectRoot, 'workflows', 'product-signal-control-tower.json'),
    'utf8',
  ),
);
const minimizerSource = readFileSync(
  resolve(projectRoot, 'workflows', 'code', 'validate-normalize-minimize.js'),
  'utf8',
);
const minimize = new Function('$input', '$execution', minimizerSource);
const goldenById = new Map(golden.cases.map((entry) => [entry.case_id, entry]));

const cases = fixtures.cases.map((fixture, index) => {
  const expected = goldenById.get(fixture.demo_case_id);
  const output = minimize(
    { all: () => [{ json: structuredClone(fixture) }] },
    { id: String(9000 + index) },
  )[0].json;
  const checks = {
    validation_ok: output.validation_ok === expected.exact_deterministic_expectations.validation_ok,
    normalized_source_key:
      `${output.source_system}|${output.source_event_id}`
      === expected.exact_deterministic_expectations.normalized_source_key,
    email_redactions:
      (output.minimized_text.match(/\[REDACTED_EMAIL\]/g) ?? []).length
      === expected.exact_deterministic_expectations.email_redactions,
    phone_redactions:
      (output.minimized_text.match(/\[REDACTED_PHONE\]/g) ?? []).length
      === expected.exact_deterministic_expectations.phone_redactions,
    raw_text_not_persisted: !Object.hasOwn(output, 'raw_text'),
    source_identity_present: Boolean(output.source_system && output.source_event_id),
    provider_failure_control_preserved:
      output.simulate_provider_failure
      === expected.exact_deterministic_expectations.simulate_provider_failure,
  };
  return {
    synthetic: true,
    case_id: fixture.demo_case_id,
    normalized_source_key: `${output.source_system}|${output.source_event_id}`,
    minimized_text_sha256: createHash('sha256').update(output.minimized_text).digest('hex'),
    sensitivity_classes: output.sensitivity_flags.matched_data_classes,
    checks,
    passed: Object.values(checks).every(Boolean),
    expected_terminal_state: expected.expected_terminal_state,
    expected_human_checkpoints: expected.review.human_checkpoints,
    expected_real_external_actions: expected.expected_side_effect_counts.real_external_actions,
  };
});

const functionalNodes = workflow.nodes.filter(
  (node) => node.type !== 'n8n-nodes-base.stickyNote',
);
const output = {
  schema_version: '3.0.0',
  synthetic: true,
  status: cases.every((entry) => entry.passed)
    ? 'credential_free_contract_acceptance_passed'
    : 'credential_free_contract_acceptance_failed',
  evidence_class:
    'Deterministic fixture, minimization, topology, and expected-outcome contract; not a provider-backed workflow execution.',
  generated_at: new Date().toISOString(),
  workflow_contract: {
    name: workflow.name,
    functional_nodes: functionalNodes.length,
    visual_lane_notes: workflow.nodes.length - functionalNodes.length,
    provider_nodes: functionalNodes.filter(
      (node) => node.type === 'n8n-nodes-base.httpRequest',
    ).length,
    human_wait_nodes: functionalNodes.filter(
      (node) => node.type === 'n8n-nodes-base.wait',
    ).length,
    visible_form_fields: (
      functionalNodes.find((node) => node.name === 'Submit Product Signal')
        ?.parameters?.formFields?.values ?? []
    ).filter((field) => field.fieldType !== 'hiddenField').length,
    credentials_in_export: workflow.nodes.some((node) => Boolean(node.credentials)),
  },
  controls: {
    raw_text_persisted: false,
    vector_similarity_claimed: false,
    roadmap_priority_assigned_by_model: false,
    real_external_actions: 0,
    deterministic_contract_test: 'tools/test-deterministic-stubs.mjs',
  },
  aggregate: {
    cases_checked: cases.length,
    cases_passed: cases.filter((entry) => entry.passed).length,
  },
  cases,
};

writeFileSync(
  resolve(projectRoot, 'evaluation', 'captured-results.json'),
  `${JSON.stringify(output, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${JSON.stringify({
  status: output.status,
  cases: output.aggregate.cases_checked,
  passed: output.aggregate.cases_passed,
  functional_nodes: output.workflow_contract.functional_nodes,
  provider_nodes: output.workflow_contract.provider_nodes,
  human_wait_nodes: output.workflow_contract.human_wait_nodes,
  visible_form_fields: output.workflow_contract.visible_form_fields,
}, null, 2)}\n`);

if (output.status.endsWith('_failed')) process.exitCode = 1;
