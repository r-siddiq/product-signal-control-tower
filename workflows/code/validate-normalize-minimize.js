const items = $input.all();

if (items.length !== 1) {
  throw new Error('Expected exactly one synthetic signal per execution.');
}

const input = items[0]?.json ?? {};
const errors = [];

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const normalizeEnum = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[\s-]+/g, '_');

const toBoolean = (value) => (
  Array.isArray(value)
    ? value.length > 0
    : typeof value === 'boolean'
      ? value
      : ['true', '1', 'yes', 'on', 'checked'].includes(normalizeText(value).toLowerCase())
);

const allowed = {
  source_context: new Set([
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
  product_hint: new Set([
    'municipal_websites',
    'agenda_and_meeting',
    'see_click_fix',
    'signal_agent',
    'signal_athena',
    'community_development',
    'recreation_management',
    'public_safety',
    'records_and_documents',
    'mass_notification',
    'web_accessibility',
    'process_automation',
    'unknown',
  ]),
};

const channelBySource = {
  support: 'ticket',
  customer_success: 'crm_note',
  product_feedback: 'feedback_form',
  research: 'interview',
  internal_escalation: 'internal_message',
};

const executionId = String($execution.id);
const signalText = normalizeText(
  input.signal_text
  ?? input['Product signal or feedback']
  ?? input.raw_text,
);
const productHint = normalizeEnum(
  input.product_hint
  ?? input['Product area, if known']
  ?? 'unknown',
) || 'unknown';
const sourceContext = normalizeEnum(
  input.source_context
  ?? input['Source context']
  ?? input.source_system
  ?? 'product_feedback',
) || 'product_feedback';
const customerSegment = normalizeEnum(input.customer_segment || 'unknown') || 'unknown';
const sourceEventId = normalizeText(input.source_event_id || `FORM-${executionId}`);
const demoCaseId = normalizeText(input.demo_case_id);
const submittedAt = normalizeText(input.submittedAt || input.received_at);
const receivedDate = submittedAt ? new Date(submittedAt) : new Date();

if (!allowed.source_context.has(sourceContext)) {
  errors.push('source_context is not in the controlled list');
}
if (!allowed.customer_segment.has(customerSegment)) {
  errors.push('customer_segment is not in the controlled list');
}
if (!allowed.product_hint.has(productHint)) {
  errors.push('product_hint is not in the controlled list');
}
if (!/^[A-Za-z0-9._:-]{1,100}$/.test(sourceEventId)) {
  errors.push('source_event_id must use 1-100 safe characters');
}
if (signalText.length < 30 || signalText.length > 4000) {
  errors.push('signal_text must be between 30 and 4000 characters');
}
if (
  Number.isNaN(receivedDate.getTime())
  || receivedDate.getTime() > Date.now() + (24 * 60 * 60 * 1000)
) {
  errors.push('received_at must be a valid, plausible timestamp');
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;
const containsEmail = emailPattern.test(signalText);
emailPattern.lastIndex = 0;
const containsPhone = phonePattern.test(signalText);
phonePattern.lastIndex = 0;

const minimizedText = signalText
  .replace(emailPattern, '[REDACTED_EMAIL]')
  .replace(phonePattern, '[REDACTED_PHONE]');
const meaningfulText = minimizedText
  .replace(/\[REDACTED_[A-Z_]+\]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '');

if (signalText.length >= 30 && meaningfulText.length < 12) {
  errors.push('redaction leaves no meaningful text');
}

const sensitivityFlags = {
  contains_email: containsEmail,
  contains_phone: containsPhone,
  requires_review: containsEmail || containsPhone,
  matched_data_classes: [
    ...(containsEmail ? ['email'] : []),
    ...(containsPhone ? ['phone'] : []),
  ],
};

return [{
  json: {
    synthetic: true,
    validation_ok: errors.length === 0,
    validation_errors: errors,
    correlation_id: `exec_${executionId}`,
    execution_id: executionId,
    source_system: sourceContext,
    source_event_id: sourceEventId,
    received_at: Number.isNaN(receivedDate.getTime()) ? null : receivedDate.toISOString(),
    customer_segment: customerSegment,
    product_hint: productHint,
    channel: channelBySource[sourceContext] ?? 'feedback_form',
    minimized_text: minimizedText,
    sensitivity_flags: sensitivityFlags,
    demo_case_id: demoCaseId || null,
    simulate_provider_failure: toBoolean(input.simulate_provider_failure),
    content_hash_input: `${productHint}\n${minimizedText}`,
  },
}];
