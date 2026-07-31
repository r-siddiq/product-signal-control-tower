const response = $input.first()?.json ?? {};
const request = $('Build Extraction Contract').first().json;
const intake = $('Claim Event and Check Replay').first().json;

const allowed = {
  product_family: new Set([
    'municipal_websites', 'agenda_and_meeting', 'see_click_fix', 'signal_agent',
    'signal_athena', 'community_development', 'recreation_management',
    'public_safety', 'records_and_documents', 'mass_notification',
    'web_accessibility', 'process_automation', 'unknown',
  ]),
  intelligence_capability: new Set([
    'resident_qa', 'staff_qa', 'content_advisor', 'editing_assistant',
    'category_search', 'photo_analysis', 'code_review', 'none', 'unknown',
  ]),
  government_role: new Set([
    'communications', 'clerk', 'it_administrator', 'community_development',
    'public_safety', 'parks_and_recreation', 'customer_service', 'executive',
    'resident', 'unknown',
  ]),
  signal_type: new Set([
    'bug', 'feature_request', 'usability', 'data_quality', 'integration',
    'performance', 'trust_and_safety', 'workflow_gap', 'positive_outcome', 'unknown',
  ]),
  ai_feedback_type: new Set([
    'answer_quality', 'source_freshness', 'editing_accuracy',
    'classification_accuracy', 'accessibility', 'privacy', 'transparency',
    'workflow_value', 'usability', 'not_ai_related', 'unknown',
  ]),
  trust_risk: new Set(['none', 'low', 'medium', 'high', 'unknown']),
  sentiment: new Set(['positive', 'neutral', 'mixed', 'negative', 'unknown']),
  urgency: new Set(['low', 'medium', 'high', 'critical', 'unknown']),
  customer_impact: new Set([
    'single_user', 'single_department', 'multiple_departments',
    'resident_facing', 'government_wide', 'unknown',
  ]),
};

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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('provider_json_not_object');
  }
  if (
    parsed.answer
    && typeof parsed.answer === 'object'
    && !Array.isArray(parsed.answer)
  ) {
    parsed = parsed.answer;
  }

  for (const [field, values] of Object.entries(allowed)) {
    if (!values.has(parsed[field])) throw new Error(`invalid_${field}`);
  }

  for (const field of ['problem_statement', 'requested_outcome', 'rationale']) {
    if (typeof parsed[field] !== 'string' || !parsed[field].trim()) {
      throw new Error(`invalid_${field}`);
    }
  }

  const confidence = Number(parsed.classification_confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('invalid_classification_confidence');
  }

  if (!Array.isArray(parsed.evidence_spans)) throw new Error('invalid_evidence_spans');
} catch (error) {
  validationError = String(error.message || 'invalid_provider_output');
}

const minimizedText = String(intake.minimized_text ?? '');
const sanitizedSpans = Array.isArray(parsed?.evidence_spans)
  ? parsed.evidence_spans
    .filter((span) => (
      span
      && typeof span.text === 'string'
      && span.text.length > 0
      && minimizedText.includes(span.text)
      && ['problem_statement', 'requested_outcome'].includes(span.supports)
    ))
    .slice(0, 4)
    .map((span) => ({ text: span.text, supports: span.supports }))
  : [];

if (validationError || sanitizedSpans.length === 0) {
  const productHint = allowed.product_family.has(intake.product_hint)
    ? intake.product_hint
    : 'unknown';
  const excerpt = minimizedText.slice(0, 220);

  return [{
    json: {
      extraction_status: 'degraded',
      product_family: productHint,
      intelligence_capability: 'unknown',
      government_role: 'unknown',
      signal_type: 'unknown',
      ai_feedback_type: 'unknown',
      trust_risk: 'unknown',
      problem_statement: `Human review is required for this minimized synthetic signal: ${excerpt}`,
      requested_outcome: 'Confirm the controlled taxonomy and discovery follow-up using the minimized evidence.',
      sentiment: 'unknown',
      urgency: 'unknown',
      customer_impact: 'unknown',
      evidence_spans: excerpt
        ? [{ text: excerpt, supports: 'problem_statement' }]
        : [],
      sensitivity_flags: intake.sensitivity_flags?.matched_data_classes ?? [],
      classification_confidence: 0,
      rationale: 'The provider response was unavailable or failed the local extraction contract; a conservative fallback preserved the mandatory review path.',
      model_metadata: {
        provider: 'zai',
        provider_mode: request.provider_mode,
        extraction_model: request.model_id,
        prompt_contract_version: request.prompt_contract_version,
        provider_call_status: 'degraded',
        provider_error_class: statusCode === 429
          ? 'rate_limited'
          : statusCode >= 500
            ? 'provider_unavailable'
            : validationError ?? 'provider_failure',
        prompt_tokens: Number(body.usage?.prompt_tokens ?? 0),
        completion_tokens: Number(body.usage?.completion_tokens ?? 0),
      },
    },
  }];
}

return [{
  json: {
    extraction_status: 'succeeded',
    product_family: parsed.product_family,
    intelligence_capability: parsed.intelligence_capability,
    government_role: parsed.government_role,
    signal_type: parsed.signal_type,
    ai_feedback_type: parsed.ai_feedback_type,
    trust_risk: parsed.trust_risk,
    problem_statement: parsed.problem_statement.trim().slice(0, 1000),
    requested_outcome: parsed.requested_outcome.trim().slice(0, 1000),
    sentiment: parsed.sentiment,
    urgency: parsed.urgency,
    customer_impact: parsed.customer_impact,
    evidence_spans: sanitizedSpans,
    sensitivity_flags: intake.sensitivity_flags?.matched_data_classes ?? [],
    classification_confidence: Number(parsed.classification_confidence),
    rationale: parsed.rationale.trim().slice(0, 1200),
    model_metadata: {
      provider: 'zai',
      provider_mode: request.provider_mode,
      extraction_model: String(body.model ?? request.model_id),
      prompt_contract_version: request.prompt_contract_version,
      provider_call_status: 'succeeded',
      prompt_tokens: Number(body.usage?.prompt_tokens ?? 0),
      completion_tokens: Number(body.usage?.completion_tokens ?? 0),
    },
  },
}];
