import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadCode(name) {
  const source = readFileSync(resolve(projectRoot, 'workflows', 'code', name), 'utf8');
  return new Function('$', '$input', source);
}

function selector(values) {
  return (name) => ({
    first() {
      if (!(name in values)) throw new Error(`Missing mocked node: ${name}`);
      return { json: values[name] };
    },
  });
}

function providerResponse(payload, overrides = {}) {
  return {
    statusCode: overrides.statusCode ?? 200,
    body: {
      model: overrides.model ?? 'glm-5.2',
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 101, completion_tokens: 53 },
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const validateExtraction = loadCode('validate-glm-extraction.js');
const validateEvidenceBrief = loadCode('validate-evidence-brief-packet.js');

const intake = {
  source_system: 'product_feedback',
  source_event_id: 'CONTRACT-TEST-001',
  source_event_uuid: '00000000-0000-4000-8000-000000000001',
  canonical_correlation_id: 'corr_contract_test',
  execution_id: 'contract-test-execution',
  received_at: '2026-07-30T12:00:00.000Z',
  channel: 'product_feedback',
  customer_segment: 'municipality',
  demo_case_id: 'CONTRACT-TEST',
  minimized_text:
    'A municipal clerk says the Signal Agent answer cited last year policy and asks for visible source dates.',
  product_hint: 'signal_agent',
  sensitivity_flags: {
    requires_review: false,
    matched_data_classes: [],
  },
};
const extractionRequest = {
  model_id: 'glm-5.2',
  provider_mode: 'live_private_demo',
  prompt_contract_version: '2.0',
};
const extractionPayload = {
  product_family: 'signal_agent',
  intelligence_capability: 'resident_qa',
  government_role: 'clerk',
  signal_type: 'data_quality',
  ai_feedback_type: 'source_freshness',
  trust_risk: 'medium',
  problem_statement: 'The answer cited last year policy.',
  requested_outcome: 'Show visible source dates.',
  sentiment: 'negative',
  urgency: 'high',
  customer_impact: 'single_department',
  evidence_spans: [
    { text: 'cited last year policy', supports: 'problem_statement' },
    { text: 'visible source dates', supports: 'requested_outcome' },
  ],
  classification_confidence: 0.91,
  rationale: 'The exact minimized text supports source-freshness feedback.',
};

const extraction = validateExtraction(
  selector({
    'Build Extraction Contract': extractionRequest,
    'Claim Event and Check Replay': intake,
  }),
  { first: () => ({ json: providerResponse(extractionPayload) }) },
)[0].json;

assert(extraction.extraction_status === 'succeeded', 'valid extraction must succeed');
assert(extraction.evidence_spans.length === 2, 'only grounded extraction spans should survive');
assert(extraction.model_metadata.provider_call_status === 'succeeded', 'provider success must be labeled');

const degradedExtraction = validateExtraction(
  selector({
    'Build Extraction Contract': extractionRequest,
    'Claim Event and Check Replay': intake,
  }),
  { first: () => ({ json: { statusCode: 503, body: {} } }) },
)[0].json;

assert(degradedExtraction.extraction_status === 'degraded', 'provider outage must degrade safely');
assert(degradedExtraction.product_family === 'signal_agent', 'safe fallback may retain an allowed intake hint');
assert(degradedExtraction.classification_confidence === 0, 'fallback must not fabricate confidence');
assert(
  degradedExtraction.model_metadata.provider_error_class === 'provider_unavailable',
  'provider outage must be auditable',
);

const reviewedCandidates = [
  {
    source_event_id: 'SEED-FRESH-RESIDENT-01',
    received_at: '2026-07-01T00:00:00.000Z',
    channel: 'research',
    customer_segment: 'municipality',
    product_family: 'signal_agent',
    ai_feedback_type: 'source_freshness',
    excerpt: 'Residents need a visible source date before trusting an answer.',
  },
  {
    source_event_id: 'SEED-UNRELATED-01',
    received_at: '2026-07-02T00:00:00.000Z',
    channel: 'research',
    customer_segment: 'municipality',
    product_family: 'recreation_management',
    ai_feedback_type: 'usability',
    excerpt: 'Invoice formatting needs an extra column.',
  },
];
const evidenceRequest = {
  model_id: 'glm-5.2',
  provider_mode: 'live_private_demo',
  prompt_contract_version: '2.0',
  deterministic_context: {
    intake,
    extraction,
    reviewed_candidates: reviewedCandidates,
    proposed_theme: {
      slug: 'source-freshness-and-answer-provenance',
      label: 'Source freshness and answer provenance',
    },
  },
};
const briefPayload = {
  matches: [
    {
      source_event_id: 'SEED-FRESH-RESIDENT-01',
      relevance: 'high',
      rationale: 'The reviewed signal describes the same freshness trust concern.',
      evidence_span: 'visible source date',
    },
    {
      source_event_id: 'FABRICATED-ID',
      relevance: 'high',
      rationale: 'This identifier was not supplied.',
      evidence_span: 'invented excerpt',
    },
  ],
  no_match_reason: null,
  brief: {
    title: 'Make source freshness visible in resident answers',
    problem_summary: 'A clerk reports that an answer cited an older policy.',
    requested_outcome: 'Expose a visible source date for review.',
    trust_and_uncertainty: {
      known: ['The current signal and one reviewed signal mention visible source dates.'],
      unknown: ['The mock does not verify a defect or affected-customer count.'],
    },
    suggested_discovery_questions: ['Which source date would help staff validate an answer?'],
    prohibited_roadmap_priority: null,
  },
};

const packet = validateEvidenceBrief(
  selector({ 'Build Evidence-Backed Brief Contract': evidenceRequest }),
  { first: () => ({ json: providerResponse(briefPayload) }) },
)[0].json;

assert(packet.evidence.status === 'ok', 'valid evidence/brief response must succeed');
assert(packet.evidence.matches.length === 1, 'fabricated candidate IDs must be rejected');
assert(
  packet.evidence.matches[0].source_event_id === 'SEED-FRESH-RESIDENT-01',
  'only an exact supplied candidate may survive',
);
assert(packet.evidence.matches[0].evidence_span === 'visible source date', 'excerpt must be exact');
assert(packet.evidence.score_available === false, 'categorical evidence must not claim a vector score');
assert(packet.brief.prohibited_roadmap_priority === null, 'model must not assign roadmap priority');
assert(packet.review_policy.required === true, 'the single Product Operations review must be mandatory');

const degradedPacket = validateEvidenceBrief(
  selector({ 'Build Evidence-Backed Brief Contract': evidenceRequest }),
  { first: () => ({ json: { statusCode: 503, body: {} } }) },
)[0].json;

assert(degradedPacket.evidence.status === 'degraded', 'second-call outage must be explicit');
assert(degradedPacket.evidence.matches.length === 0, 'degraded evidence must not retain a match claim');
assert(
  degradedPacket.brief.brief_status === 'generated_degraded_fallback',
  'second-call outage must still produce a reviewable fallback',
);
assert(
  degradedPacket.review_policy.reasons.includes('evidence_brief_degraded'),
  'degraded synthesis must elevate human review',
);
assert(
  degradedPacket.model_metadata.evidence_brief.provider_error_class === 'provider_unavailable',
  'degraded second call must be auditable',
);

process.stdout.write(`${JSON.stringify({
  valid: true,
  contract_version: '2.0',
  model_calls_exercised: 2,
  human_checkpoints_required: 1,
  valid_extraction_passed: true,
  extraction_degradation_passed: true,
  exact_candidate_id_and_excerpt_passed: true,
  fabricated_candidate_rejected: true,
  vector_similarity_claimed: false,
  roadmap_priority_assigned: false,
  evidence_brief_degradation_passed: true,
}, null, 2)}\n`);
