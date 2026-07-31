const response = $input.first()?.json ?? {};
const request = $('Build Evidence-Backed Brief Contract').first().json;
const context = request.deterministic_context;
const extraction = context.extraction;
const intake = context.intake;
const candidates = Array.isArray(context.reviewed_candidates)
  ? context.reviewed_candidates
  : [];
const candidateById = new Map(candidates.map((candidate) => [
  String(candidate.source_event_id),
  candidate,
]));

const body = response.body ?? response;
const statusCode = Number(response.statusCode ?? (Array.isArray(body.choices) ? 200 : 0));
const content = body.choices?.[0]?.message?.content;
let parsed = null;
let validationError = null;

try {
  if (statusCode < 200 || statusCode >= 300 || typeof content !== 'string') {
    throw new Error('provider_response_unavailable');
  }
  parsed = JSON.parse(content);
  if (
    !parsed
    || typeof parsed !== 'object'
    || !Array.isArray(parsed.matches)
    || !parsed.brief
    || typeof parsed.brief !== 'object'
  ) {
    throw new Error('provider_json_contract_invalid');
  }
  for (const field of ['title', 'problem_summary', 'requested_outcome']) {
    if (typeof parsed.brief[field] !== 'string' || !parsed.brief[field].trim()) {
      throw new Error(`invalid_${field}`);
    }
  }
  if (
    !parsed.brief.trust_and_uncertainty
    || !Array.isArray(parsed.brief.trust_and_uncertainty.known)
    || !Array.isArray(parsed.brief.trust_and_uncertainty.unknown)
    || !Array.isArray(parsed.brief.suggested_discovery_questions)
    || parsed.brief.prohibited_roadmap_priority !== null
  ) {
    throw new Error('invalid_brief_contract');
  }
} catch (error) {
  validationError = String(error.message || 'invalid_provider_output');
}

const selected = [];
const seen = new Set();
if (!validationError) {
  for (const proposed of parsed.matches) {
    const sourceEventId = String(proposed?.source_event_id ?? '');
    const candidate = candidateById.get(sourceEventId);
    if (
      !candidate
      || seen.has(sourceEventId)
      || !['high', 'medium'].includes(proposed?.relevance)
      || !(
        candidate.product_family === extraction.product_family
        || candidate.ai_feedback_type === extraction.ai_feedback_type
      )
    ) {
      continue;
    }

    const candidateExcerpt = String(candidate.excerpt ?? '');
    if (
      typeof proposed.evidence_span !== 'string'
      || !proposed.evidence_span
      || !candidateExcerpt.includes(proposed.evidence_span)
    ) {
      continue;
    }

    selected.push({
      ...candidate,
      evidence_rank: selected.length + 1,
      model_relevance: proposed.relevance,
      semantic_rationale: typeof proposed.rationale === 'string'
        ? proposed.rationale.trim().slice(0, 600)
        : 'Selected under the bounded evidence contract.',
      evidence_span: proposed.evidence_span,
    });
    seen.add(sourceEventId);
    if (selected.length === 3) break;
  }
}

const currentEvidence = {
  source_event_id: intake.source_event_id,
  received_at: intake.received_at,
  channel: intake.channel,
  customer_segment: intake.customer_segment,
  excerpt: extraction.evidence_spans?.[0]?.text || extraction.problem_statement,
  evidence_kind: 'current_signal',
};
const representedEvidence = [
  currentEvidence,
  ...selected.map((match) => ({
    source_event_id: match.source_event_id,
    received_at: match.received_at,
    channel: match.channel,
    customer_segment: match.customer_segment,
    excerpt: match.evidence_span,
    evidence_kind: 'reviewed_related_signal',
  })),
];
const dates = representedEvidence
  .map((item) => item.received_at)
  .filter(Boolean)
  .sort();
const cleanStrings = (values, limit) => (Array.isArray(values) ? values : [])
  .filter((value) => typeof value === 'string' && value.trim())
  .slice(0, limit)
  .map((value) => value.trim().slice(0, 800));

const degraded = Boolean(validationError);
const briefSource = degraded ? {} : parsed.brief;
const theme = context.proposed_theme;
const brief = {
  brief_status: degraded ? 'generated_degraded_fallback' : 'generated_with_glm',
  title: degraded
    ? `${theme.label}: synthetic product signal`
    : briefSource.title.trim().slice(0, 240),
  theme,
  affected_product_families: [extraction.product_family].filter(Boolean),
  affected_government_roles: [extraction.government_role].filter(Boolean),
  problem_summary: degraded
    ? extraction.problem_statement
    : briefSource.problem_summary.trim().slice(0, 1600),
  requested_outcome: degraded
    ? extraction.requested_outcome
    : briefSource.requested_outcome.trim().slice(0, 1200),
  evidence_summary: {
    supporting_signal_count: representedEvidence.length,
    source_channels: [...new Set(representedEvidence.map((item) => item.channel).filter(Boolean))],
    customer_segments: [...new Set(representedEvidence.map((item) => item.customer_segment).filter(Boolean))],
    oldest_signal_at: dates[0] ?? null,
    newest_signal_at: dates.at(-1) ?? null,
    representative_evidence: representedEvidence.slice(0, 3).map((item) => ({
      source_event_id: item.source_event_id,
      excerpt: item.excerpt,
    })),
  },
  trust_and_uncertainty: {
    trust_risk: extraction.trust_risk,
    known: degraded
      ? ['The current minimized synthetic signal is retained for Product Operations review.']
      : cleanStrings(briefSource.trust_and_uncertainty.known, 5),
    unknown: degraded
      ? [
        'Evidence selection and brief synthesis degraded; no related-signal claim is retained.',
        'The mock does not verify a defect, affected-customer count, business impact, or roadmap priority.',
      ]
      : cleanStrings(briefSource.trust_and_uncertainty.unknown, 5),
  },
  reviewer_changes: [],
  suggested_discovery_questions: degraded
    ? ['What evidence should Product Operations validate before creating a backlog candidate?']
    : cleanStrings(briefSource.suggested_discovery_questions, 5),
  prohibited_roadmap_priority: null,
};

const reasons = [];
if (intake.sensitivity_flags?.requires_review) reasons.push('sensitivity_flag');
if (['high', 'unknown'].includes(extraction.trust_risk)) reasons.push('high_or_unknown_trust_risk');
if (extraction.urgency === 'critical') reasons.push('critical_urgency');
if (['product_family', 'government_role', 'signal_type']
  .some((field) => extraction[field] === 'unknown')) {
  reasons.push('unknown_classification');
}
if (Number(extraction.classification_confidence ?? 0) < 0.78) {
  reasons.push('low_classification_confidence');
}
if (extraction.extraction_status !== 'succeeded') reasons.push('extraction_degraded');
if (degraded) reasons.push('evidence_brief_degraded');
if (!degraded && selected.length === 0) reasons.push('no_reviewed_neighbor');

const providerErrorClass = statusCode === 429
  ? 'rate_limited'
  : statusCode >= 500
    ? 'provider_unavailable'
    : validationError;

return [{
  json: {
    synthetic: true,
    source_event_id: intake.source_event_id,
    source_event_uuid: intake.source_event_uuid,
    correlation_id: intake.canonical_correlation_id ?? intake.correlation_id,
    execution_id: intake.execution_id,
    source_metadata: {
      source_system: intake.source_system,
      source_event_id: intake.source_event_id,
      received_at: intake.received_at,
      customer_segment: intake.customer_segment,
      channel: intake.channel,
      demo_case_id: intake.demo_case_id,
    },
    redaction_notice: 'Only minimized synthetic text is shown. Contact-like values were removed before model and database boundaries.',
    minimized_text: intake.minimized_text,
    sensitivity_flags: intake.sensitivity_flags,
    extraction,
    evidence: {
      status: degraded ? 'degraded' : 'ok',
      label: 'GLM-selected reviewed PostgreSQL evidence (no vector similarity score)',
      provider_mode: request.provider_mode,
      score_available: false,
      matches: degraded ? [] : selected,
      notice: degraded
        ? 'The provider response failed the local contract; no related-signal claim was retained.'
        : selected.length > 0
          ? 'Only supplied, human-reviewed candidates with exact excerpts were retained.'
          : String(parsed.no_match_reason ?? 'No reviewed candidate was retained.').slice(0, 600),
    },
    brief,
    review_policy: {
      required: true,
      level: reasons.length > 0 ? 'elevated' : 'normal',
      reasons,
      model_cannot_clear_reasons: true,
    },
    degradation_flags: [
      ...(extraction.extraction_status === 'succeeded' ? [] : ['extraction_degraded']),
      ...(degraded ? ['evidence_brief_degraded'] : []),
    ],
    model_metadata: {
      extraction: extraction.model_metadata ?? {},
      evidence_brief: {
        provider: 'zai',
        model: degraded ? request.model_id : String(body.model ?? request.model_id),
        prompt_contract_version: request.prompt_contract_version,
        provider_call_status: degraded ? 'degraded' : 'succeeded',
        provider_error_class: degraded ? providerErrorClass : null,
        prompt_tokens: Number(body.usage?.prompt_tokens ?? 0),
        completion_tokens: Number(body.usage?.completion_tokens ?? 0),
      },
      vector_similarity_claimed: false,
    },
  },
}];
