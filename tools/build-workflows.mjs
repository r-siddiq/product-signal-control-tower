import { readFileSync, writeFileSync } from 'node:fs';

const workflowDir = new URL('../workflows/', import.meta.url);
const codeDir = new URL('../workflows/code/', import.meta.url);
const readCode = (name) => readFileSync(new URL(name, codeDir), 'utf8').replace(/\r\n/g, '\n');

const code = {
  prepare: readCode('validate-normalize-minimize.js'),
  buildExtraction: readCode('build-glm-extraction-request.js'),
  validateExtraction: readCode('validate-glm-extraction.js'),
  buildEvidenceBrief: readCode('build-evidence-brief-request.js'),
  validatePacket: readCode('validate-evidence-brief-packet.js'),
  sanitize: readCode('sanitize-unexpected-error.js'),
};

const ids = {
  submit: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703101',
  prepare: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703102',
  isValid: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703103',
  hash: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703104',
  stop: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703105',
  claim: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703106',
  isNew: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703107',
  replay: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703108',
  buildExtraction: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703109',
  extract: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703123',
  validateExtraction: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703124',
  loadCandidates: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703110',
  buildEvidenceBrief: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703125',
  evidenceBrief: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703127',
  validatePacket: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703128',
  review: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703113',
  persistDecision: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703114',
  routeDecision: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703115',
  finalize: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703121',
  close: '0dd4a57e-0f0c-4fa1-b2d8-22a6af703116',
};

const node = (id, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters,
  id,
  name,
  type,
  typeVersion,
  position,
  ...extra,
});

const postgres = (
  id,
  name,
  position,
  query,
  queryReplacement,
  { continueErrorOutput = false } = {},
) => node(
  id,
  name,
  'n8n-nodes-base.postgres',
  2.6,
  position,
  {
    operation: 'executeQuery',
    query,
    options: {
      queryBatching: 'transaction',
      queryReplacement,
    },
  },
  {
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    alwaysOutputData: true,
    ...(continueErrorOutput ? { onError: 'continueErrorOutput' } : {}),
  },
);

const glmRequest = (id, name, position) => node(
  id,
  name,
  'n8n-nodes-base.httpRequest',
  4.4,
  position,
  {
    method: 'POST',
    url: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.request_body) }}',
    options: {
      timeout: 90000,
      redirect: {
        redirect: {
          followRedirects: false,
        },
      },
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
  {
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1500,
    onError: 'continueErrorOutput',
  },
);

const booleanIf = (id, name, position, leftValue) => node(
  id,
  name,
  'n8n-nodes-base.if',
  2.3,
  position,
  {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [{
        id: `${id.slice(0, -1)}a`,
        leftValue,
        rightValue: true,
        operator: {
          type: 'boolean',
          operation: 'true',
          singleValue: true,
        },
      }],
      combinator: 'and',
    },
    options: {},
  },
);

const setNode = (id, name, position, assignments) => node(
  id,
  name,
  'n8n-nodes-base.set',
  3.4,
  position,
  {
    mode: 'manual',
    assignments: {
      assignments: assignments.map(([fieldId, fieldName, value, type]) => ({
        id: fieldId,
        name: fieldName,
        value,
        type,
      })),
    },
    includeOtherFields: false,
    options: {},
  },
);

const sticky = (id, name, position, width, height, color, content) => node(
  id,
  name,
  'n8n-nodes-base.stickyNote',
  1,
  position,
  { width, height, color, content },
);

const addMain = (connections, from, output, to, input = 0) => {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: 'main', index: input });
};

const claimSql = String.raw`
WITH claimed AS (
  SELECT *
  FROM public.claim_source_event_lean(
    $1::text, $2::text, $3::text, $4::text, $5::text, $6::timestamptz,
    $7::text, $8::text, $9::text, $10::text, $11::jsonb, $12::text, $13::boolean
  )
)
SELECT
  c.event_id AS source_event_uuid,
  c.is_new,
  c.current_status,
  c.current_replay_count,
  c.content_mismatch,
  c.canonical_correlation_id,
  $1::text AS source_system,
  $2::text AS source_event_id,
  $5::text AS execution_id,
  $6::timestamptz AS received_at,
  $7::text AS customer_segment,
  $8::text AS product_hint,
  $9::text AS channel,
  $10::text AS minimized_text,
  $11::jsonb AS sensitivity_flags,
  $12::text AS demo_case_id,
  $13::boolean AS simulate_provider_failure,
  s.id AS signal_id,
  s.review_status,
  a.id AS artifact_id,
  a.version AS artifact_version,
  a.approval_state,
  o.id AS outbox_id,
  o.delivery_status
FROM claimed AS c
LEFT JOIN public.signals AS s ON s.source_event_id = c.event_id
LEFT JOIN LATERAL (
  SELECT id, version, approval_state
  FROM public.artifacts
  WHERE signal_id = s.id
  ORDER BY version DESC
  LIMIT 1
) AS a ON true
LEFT JOIN LATERAL (
  SELECT id, delivery_status
  FROM public.outbox
  WHERE artifact_id = a.id
  ORDER BY created_at DESC
  LIMIT 1
) AS o ON true;`.trim();

const retrievalSql = String.raw`
WITH ranked AS (
  SELECT
    s.id AS signal_id,
    se.source_event_id,
    se.received_at,
    s.product_family,
    s.intelligence_capability,
    s.government_role,
    s.signal_type,
    s.ai_feedback_type,
    s.trust_risk,
    s.problem_statement,
    s.requested_outcome,
    t.slug AS theme_slug,
    left(se.minimized_text, 320) AS excerpt,
    se.channel,
    se.customer_segment,
    row_number() OVER (
      ORDER BY
        (s.product_family = $2::text) DESC,
        (s.ai_feedback_type = $3::text) DESC,
        s.reviewed_at DESC,
        s.id
    ) AS evidence_rank
  FROM public.signals AS s
  JOIN public.source_events AS se ON se.id = s.source_event_id
  LEFT JOIN public.theme_signals AS ts ON ts.signal_id = s.id
  LEFT JOIN public.themes AS t ON t.id = ts.theme_id
  WHERE s.review_status = 'approved'
    AND s.source_event_id <> $1::uuid
    AND se.correlation_id LIKE 'synthetic-seed-%'
  ORDER BY
    (s.product_family = $2::text) DESC,
    (s.ai_feedback_type = $3::text) DESC,
    s.reviewed_at DESC,
    s.id
  LIMIT 5
)
SELECT
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'signal_id', signal_id,
        'source_event_id', source_event_id,
        'received_at', received_at,
        'product_family', product_family,
        'intelligence_capability', intelligence_capability,
        'government_role', government_role,
        'signal_type', signal_type,
        'ai_feedback_type', ai_feedback_type,
        'trust_risk', trust_risk,
        'problem_statement', problem_statement,
        'requested_outcome', requested_outcome,
        'theme_slug', theme_slug,
        'excerpt', excerpt,
        'channel', channel,
        'customer_segment', customer_segment,
        'evidence_rank', evidence_rank
      )
      ORDER BY evidence_rank
    ) FILTER (WHERE signal_id IS NOT NULL),
    '[]'::jsonb
  ) AS reviewed_candidates,
  'bounded_reviewed_postgres_candidates'::text AS candidate_provider_mode
FROM ranked;`.trim();

const decisionSql = String.raw`
SELECT *
FROM public.persist_product_ops_decision_lean(
  $1::uuid,
  $2::text,
  $3::text,
  $4::jsonb,
  $5::text,
  $6::text,
  $7::text
);`.trim();

const finalizeSql = String.raw`
SELECT *
FROM public.finalize_approved_artifact_lean(
  $1::uuid,
  $2::jsonb,
  $3::text,
  $4::jsonb,
  $5::text
);`.trim();

const mainNodes = [
  node(ids.submit, 'Submit Product Signal', 'n8n-nodes-base.formTrigger', 2.6, [0, 0], {
    formTitle: 'Signal Product Signal Control Tower',
    formDescription: 'Synthetic local demo. Enter the product context; execution IDs, timestamps, source identity, and safe defaults are generated automatically.',
    formFields: {
      values: [
        {
          fieldLabel: 'Product signal or feedback',
          fieldName: 'signal_text',
          fieldType: 'textarea',
          placeholder: 'Describe the product feedback, observed workflow friction, or requested outcome.',
          requiredField: true,
        },
        {
          fieldLabel: 'Product area, if known',
          fieldName: 'product_hint',
          fieldType: 'dropdown',
          fieldOptions: {
            values: [
              { option: 'unknown' },
              { option: 'municipal_websites' },
              { option: 'agenda_and_meeting' },
              { option: 'resident_request_tracking' },
              { option: 'signal_agent' },
              { option: 'analytics_assistant' },
              { option: 'community_development' },
              { option: 'recreation_management' },
              { option: 'public_safety' },
              { option: 'records_and_documents' },
              { option: 'mass_notification' },
              { option: 'web_accessibility' },
              { option: 'process_automation' },
            ],
          },
          defaultValue: 'unknown',
        },
        {
          fieldLabel: 'Source context',
          fieldName: 'source_context',
          fieldType: 'dropdown',
          fieldOptions: {
            values: [
              { option: 'product_feedback' },
              { option: 'support' },
              { option: 'customer_success' },
              { option: 'research' },
              { option: 'internal_escalation' },
            ],
          },
          defaultValue: 'product_feedback',
        },
        {
          fieldLabel: 'Source event ID',
          fieldName: 'source_event_id',
          fieldType: 'hiddenField',
        },
        {
          fieldLabel: 'Demo case ID',
          fieldName: 'demo_case_id',
          fieldType: 'hiddenField',
        },
        {
          fieldLabel: 'Simulate provider failure',
          fieldName: 'simulate_provider_failure',
          fieldType: 'hiddenField',
        },
      ],
    },
    responseMode: 'onReceived',
    options: {
      formSubmittedText: 'Signal accepted for the synthetic local workflow. A backlog item does not exist unless Product Operations approves the review packet.',
      appendAttribution: false,
    },
  }),
  node(ids.prepare, 'Prepare Safe Intake', 'n8n-nodes-base.code', 2, [280, 0], {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: code.prepare,
  }),
  booleanIf(ids.isValid, 'Is Signal Valid?', [560, 0], '={{ $json.validation_ok }}'),
  node(ids.stop, 'Stop Invalid Signal', 'n8n-nodes-base.stopAndError', 1, [840, 220], {
    errorType: 'errorMessage',
    errorMessage: 'The synthetic signal failed safe intake validation. Inspect the preceding sanitized validation result.',
  }),
  node(ids.hash, 'Hash Minimized Signal', 'n8n-nodes-base.crypto', 2, [840, 0], {
    action: 'hash',
    type: 'SHA256',
    binaryData: false,
    value: '={{ $json.content_hash_input }}',
    dataPropertyName: 'content_hash',
  }),
  postgres(
    ids.claim,
    'Claim Event and Check Replay',
    [1120, 0],
    claimSql,
    "={{ [ $json.source_system, $json.source_event_id, $json.content_hash, $json.correlation_id, $json.execution_id, $json.received_at, $json.customer_segment, $json.product_hint, $json.channel, $json.minimized_text, JSON.stringify($json.sensitivity_flags || {}), $json.demo_case_id || null, Boolean($json.simulate_provider_failure) ] }}",
  ),
  booleanIf(ids.isNew, 'Is Signal New?', [1400, 0], '={{ $json.is_new }}'),
  setNode(ids.replay, 'Return Replay Outcome', [1400, 220], [
    ['a1d2b301-b051-42f3-b1a1-08c36eae7801', 'outcome', 'replayed_existing_source_event', 'string'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7802', 'source_event_uuid', '={{ $json.source_event_uuid }}', 'string'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7803', 'processing_status', '={{ $json.current_status }}', 'string'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7804', 'replay_count', '={{ $json.current_replay_count }}', 'number'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7805', 'content_mismatch', '={{ $json.content_mismatch }}', 'boolean'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7806', 'signal_id', '={{ $json.signal_id || null }}', 'string'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7807', 'artifact_id', '={{ $json.artifact_id || null }}', 'string'],
    ['a1d2b301-b051-42f3-b1a1-08c36eae7808', 'outbox_delivery_status', '={{ $json.delivery_status || null }}', 'string'],
  ]),
  node(ids.buildExtraction, 'Build Extraction Contract', 'n8n-nodes-base.code', 2, [1680, 0], {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: code.buildExtraction,
  }),
  glmRequest(ids.extract, 'Extract Controlled Signal with GLM-5.2', [1960, 0]),
  node(ids.validateExtraction, 'Validate Extraction or Degrade Safely', 'n8n-nodes-base.code', 2, [2240, 0], {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: code.validateExtraction,
  }),
  postgres(
    ids.loadCandidates,
    'Load Reviewed Evidence Candidates',
    [2520, 0],
    retrievalSql,
    "={{ [ $('Claim Event and Check Replay').first().json.source_event_uuid, $('Validate Extraction or Degrade Safely').first().json.product_family, $('Validate Extraction or Degrade Safely').first().json.ai_feedback_type ] }}",
  ),
  node(ids.buildEvidenceBrief, 'Build Evidence-Backed Brief Contract', 'n8n-nodes-base.code', 2, [2800, 0], {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: code.buildEvidenceBrief,
  }),
  glmRequest(ids.evidenceBrief, 'Select Evidence and Draft Brief with GLM-5.2', [3080, 0]),
  node(ids.validatePacket, 'Validate Brief and Build Review Packet', 'n8n-nodes-base.code', 2, [3360, 0], {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: code.validatePacket,
  }),
  node(ids.review, 'Review Product Signal Brief', 'n8n-nodes-base.wait', 1.1, [3640, 0], {
    resume: 'form',
    incomingAuthentication: 'none',
    formTitle: 'Product Operations decision',
    formDescription: "={{ 'Synthetic signal: ' + $json.source_event_id + '\\nProduct: ' + $json.extraction.product_family + '\\nReview level: ' + $json.review_policy.level + '\\nBrief: ' + $json.brief.title + '\\nEvidence: ' + $json.evidence.matches.length + ' reviewed match(es); no vector score.\\nApproval creates only one local stubbed backlog action.' }}",
    formFields: {
      values: [
        {
          fieldLabel: 'Decision',
          fieldName: 'decision',
          fieldType: 'dropdown',
          fieldOptions: {
            values: [
              { option: 'approve_backlog_candidate' },
              { option: 'save_reviewed_insight' },
              { option: 'reject' },
            ],
          },
          requiredField: true,
        },
        {
          fieldLabel: 'Reviewer rationale',
          fieldName: 'rationale',
          fieldType: 'textarea',
          requiredField: true,
        },
        {
          fieldLabel: 'Corrected product family (optional)',
          fieldName: 'edited_product_family',
          fieldType: 'dropdown',
          fieldOptions: {
            values: [
              { option: 'unknown' },
              { option: 'municipal_websites' },
              { option: 'agenda_and_meeting' },
              { option: 'resident_request_tracking' },
              { option: 'signal_agent' },
              { option: 'analytics_assistant' },
              { option: 'community_development' },
              { option: 'recreation_management' },
              { option: 'public_safety' },
              { option: 'records_and_documents' },
              { option: 'mass_notification' },
              { option: 'web_accessibility' },
              { option: 'process_automation' },
            ],
          },
          defaultValue: "={{ $('Validate Brief and Build Review Packet').first().json.extraction.product_family }}",
        },
        {
          fieldLabel: 'Corrected brief summary (optional)',
          fieldName: 'edited_brief_summary',
          fieldType: 'textarea',
          defaultValue: "={{ $('Validate Brief and Build Review Packet').first().json.brief.problem_summary }}",
        },
      ],
    },
    responseMode: 'onReceived',
    limitWaitTime: false,
    options: { appendAttribution: false },
  }),
  postgres(
    ids.persistDecision,
    'Persist Review Decision',
    [3920, 0],
    decisionSql,
    "={{ [ $('Claim Event and Check Replay').first().json.source_event_uuid, $json.decision || $json['Decision'], $json.rationale || $json['Reviewer rationale'], JSON.stringify($('Validate Brief and Build Review Packet').first().json), $('Claim Event and Check Replay').first().json.execution_id, $json.edited_product_family || $json['Corrected product family (optional)'] || null, $json.edited_brief_summary || $json['Corrected brief summary (optional)'] || null ] }}",
  ),
  node(ids.routeDecision, 'Route Review Decision', 'n8n-nodes-base.switch', 3.4, [4200, 0], {
    mode: 'rules',
    rules: {
      values: [
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{
              id: 'c9184d46-228d-4349-b511-f081db347b11',
              leftValue: '={{ $json.decision }}',
              rightValue: 'approve_backlog_candidate',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'approve_backlog_candidate',
        },
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{
              id: 'c9184d46-228d-4349-b511-f081db347b12',
              leftValue: '={{ $json.decision }}',
              rightValue: 'save_reviewed_insight',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'save_reviewed_insight',
        },
        {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{
              id: 'c9184d46-228d-4349-b511-f081db347b13',
              leftValue: '={{ $json.decision }}',
              rightValue: 'reject',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'reject',
        },
      ],
    },
    options: {
      fallbackOutput: 'extra',
      renameFallbackOutput: 'invalid_decision',
    },
  }),
  postgres(
    ids.finalize,
    'Finalize Approved Artifact and Outbox',
    [4480, -140],
    finalizeSql,
    "={{ [ $('Persist Review Decision').first().json.source_event_uuid, JSON.stringify($('Persist Review Decision').first().json.brief_json), $('Persist Review Decision').first().json.brief_markdown, JSON.stringify($('Validate Brief and Build Review Packet').first().json), $('Claim Event and Check Replay').first().json.execution_id ] }}",
  ),
  setNode(ids.close, 'Close Without Artifact', [4480, 180], [
    ['72954df2-bf1a-48d0-b7ec-1613fc049301', 'outcome', 'completed_without_artifact', 'string'],
    ['72954df2-bf1a-48d0-b7ec-1613fc049302', 'signal_id', '={{ $json.signal_id || null }}', 'string'],
    ['72954df2-bf1a-48d0-b7ec-1613fc049303', 'decision', '={{ $json.decision || "invalid_decision" }}', 'string'],
    ['72954df2-bf1a-48d0-b7ec-1613fc049304', 'processing_status', '={{ $json.processing_status || "failed_closed" }}', 'string'],
    ['72954df2-bf1a-48d0-b7ec-1613fc049305', 'source_event_uuid', '={{ $json.source_event_uuid || null }}', 'string'],
    ['72954df2-bf1a-48d0-b7ec-1613fc049306', 'outbox_created', false, 'boolean'],
  ]),
  sticky(
    '64f5b54d-f515-403a-aeaf-32da0f171101',
    'Intake & Replay',
    [-140, -300],
    1700,
    760,
    5,
    '## 1 · Intake & Replay\nThree visible fields. Metadata is generated, contact-like data is minimized, and stable source identity stops replays before either model call.',
  ),
  sticky(
    '64f5b54d-f515-403a-aeaf-32da0f171102',
    'AI & Evidence',
    [1580, -300],
    1900,
    600,
    6,
    '## 2 · AI & Evidence\nTwo bounded GLM-5.2 contracts: controlled extraction, then evidence selection plus brief synthesis. Local validators preserve exact provenance and degrade safely.',
  ),
  sticky(
    '64f5b54d-f515-403a-aeaf-32da0f171103',
    'Human Decision',
    [3500, -300],
    840,
    600,
    4,
    '## 3 · Human Decision\nOne durable Product Operations review sees the complete packet. AI cannot clear risk reasons or create a backlog action.',
  ),
  sticky(
    '64f5b54d-f515-403a-aeaf-32da0f171104',
    'Auditable Outcomes',
    [4360, -360],
    620,
    900,
    3,
    '## 4 · Auditable Outcomes\nApproval atomically versions the brief and creates one stubbed outbox action. Save-only, rejection, invalid decisions, and replay end without duplicate side effects.',
  ),
];

const mainConnections = {};
addMain(mainConnections, 'Submit Product Signal', 0, 'Prepare Safe Intake');
addMain(mainConnections, 'Prepare Safe Intake', 0, 'Is Signal Valid?');
addMain(mainConnections, 'Is Signal Valid?', 0, 'Hash Minimized Signal');
addMain(mainConnections, 'Is Signal Valid?', 1, 'Stop Invalid Signal');
addMain(mainConnections, 'Hash Minimized Signal', 0, 'Claim Event and Check Replay');
addMain(mainConnections, 'Claim Event and Check Replay', 0, 'Is Signal New?');
addMain(mainConnections, 'Is Signal New?', 0, 'Build Extraction Contract');
addMain(mainConnections, 'Is Signal New?', 1, 'Return Replay Outcome');
addMain(mainConnections, 'Build Extraction Contract', 0, 'Extract Controlled Signal with GLM-5.2');
addMain(mainConnections, 'Extract Controlled Signal with GLM-5.2', 0, 'Validate Extraction or Degrade Safely');
addMain(mainConnections, 'Extract Controlled Signal with GLM-5.2', 1, 'Validate Extraction or Degrade Safely');
addMain(mainConnections, 'Validate Extraction or Degrade Safely', 0, 'Load Reviewed Evidence Candidates');
addMain(mainConnections, 'Load Reviewed Evidence Candidates', 0, 'Build Evidence-Backed Brief Contract');
addMain(mainConnections, 'Build Evidence-Backed Brief Contract', 0, 'Select Evidence and Draft Brief with GLM-5.2');
addMain(mainConnections, 'Select Evidence and Draft Brief with GLM-5.2', 0, 'Validate Brief and Build Review Packet');
addMain(mainConnections, 'Select Evidence and Draft Brief with GLM-5.2', 1, 'Validate Brief and Build Review Packet');
addMain(mainConnections, 'Validate Brief and Build Review Packet', 0, 'Review Product Signal Brief');
addMain(mainConnections, 'Review Product Signal Brief', 0, 'Persist Review Decision');
addMain(mainConnections, 'Persist Review Decision', 0, 'Route Review Decision');
addMain(mainConnections, 'Route Review Decision', 0, 'Finalize Approved Artifact and Outbox');
addMain(mainConnections, 'Route Review Decision', 1, 'Close Without Artifact');
addMain(mainConnections, 'Route Review Decision', 2, 'Close Without Artifact');
addMain(mainConnections, 'Route Review Decision', 3, 'Close Without Artifact');

const mainWorkflow = {
  name: 'Product Signal Control Tower',
  nodes: mainNodes,
  pinData: {},
  connections: mainConnections,
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Los_Angeles',
    saveExecutionProgress: true,
  },
  versionId: 'a3224263-9b8e-4af9-a4b0-d75f518cfa01',
  meta: {
    templateCredsSetupCompleted: false,
    credentialFreeExport: true,
    providerMode: 'zai_glm_5_2_two_bounded_calls',
    evidenceMode: 'bounded_reviewed_postgres_candidates',
    vectorSimilarityClaimed: false,
    functionalNodeCount: 20,
    humanReviewCount: 1,
    nativeOpenTelemetry: true,
  },
  tags: [],
};

const errorConnections = {};
addMain(errorConnections, 'Capture Unexpected Workflow Error', 0, 'Sanitize Unexpected Workflow Error');
addMain(errorConnections, 'Sanitize Unexpected Workflow Error', 0, 'Audit Sanitized Workflow Error');
addMain(errorConnections, 'Sanitize Unexpected Workflow Error', 1, 'Stop Error Sanitization Failure');
addMain(errorConnections, 'Audit Sanitized Workflow Error', 1, 'Stop Error Audit Failure');

const auditErrorSql = String.raw`
INSERT INTO public.workflow_audit (
  idempotency_key, correlation_id, execution_id, event_type,
  from_status, to_status, actor_type, degradation_metadata, details
)
VALUES (
  'unexpected_error:' || COALESCE(NULLIF($1::text, ''), 'unknown-execution'),
  'unexpected_error:' || COALESCE(NULLIF($1::text, ''), 'unknown-execution'),
  COALESCE(NULLIF($1::text, ''), 'unknown-execution'),
  'unexpected_workflow_error',
  NULL,
  'failed_closed',
  'system',
  jsonb_build_object('error_class', $2::text, 'degradation_status', $3::text),
  jsonb_build_object(
    'workflow_id', $4::text,
    'workflow_name', $5::text,
    'last_node', $6::text,
    'sanitized_message', $7::text,
    'captured_at', $8::text
  )
)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id AS audit_id, event_type, to_status;`.trim();

const errorWorkflow = {
  name: 'Product Signal Error Handler',
  nodes: [
    node(
      '6213aa52-f826-484d-996c-7e593f3a7201',
      'Capture Unexpected Workflow Error',
      'n8n-nodes-base.errorTrigger',
      1,
      [-440, 0],
      {},
    ),
    node(
      '6213aa52-f826-484d-996c-7e593f3a7202',
      'Sanitize Unexpected Workflow Error',
      'n8n-nodes-base.code',
      2,
      [-180, 0],
      {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: code.sanitize,
      },
      { onError: 'continueErrorOutput' },
    ),
    postgres(
      '6213aa52-f826-484d-996c-7e593f3a7203',
      'Audit Sanitized Workflow Error',
      [80, 0],
      auditErrorSql,
      "={{ [ $json.execution_id, $json.error_class, $json.degradation_status, $json.workflow_id, $json.workflow_name, $json.last_node, $json.sanitized_message, $json.captured_at ] }}",
      { continueErrorOutput: true },
    ),
    node(
      '6213aa52-f826-484d-996c-7e593f3a7204',
      'Stop Error Sanitization Failure',
      'n8n-nodes-base.stopAndError',
      1,
      [80, 220],
      {
        errorType: 'errorMessage',
        errorMessage: 'The error-handler sanitization step failed closed.',
      },
    ),
    node(
      '6213aa52-f826-484d-996c-7e593f3a7205',
      'Stop Error Audit Failure',
      'n8n-nodes-base.stopAndError',
      1,
      [340, 160],
      {
        errorType: 'errorMessage',
        errorMessage: 'The sanitized error could not be written to the local audit log.',
      },
    ),
    sticky(
      '6213aa52-f826-484d-996c-7e593f3a7206',
      'Sanitized Failure Audit',
      [-500, -240],
      1080,
      600,
      2,
      '## Sanitized Failure Audit\nAssign this inactive companion as the main workflow error workflow after import. It stores identifiers and classifications, never raw provider or database messages.',
    ),
  ],
  pinData: {},
  connections: errorConnections,
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Los_Angeles',
  },
  versionId: 'a3224263-9b8e-4af9-a4b0-d75f518cfa02',
  meta: {
    templateCredsSetupCompleted: false,
    credentialFreeBuild: true,
  },
  tags: [],
};

const expectedRootNames = [
  'Submit Product Signal',
  'Prepare Safe Intake',
  'Is Signal Valid?',
  'Stop Invalid Signal',
  'Hash Minimized Signal',
  'Claim Event and Check Replay',
  'Is Signal New?',
  'Return Replay Outcome',
  'Build Extraction Contract',
  'Extract Controlled Signal with GLM-5.2',
  'Validate Extraction or Degrade Safely',
  'Load Reviewed Evidence Candidates',
  'Build Evidence-Backed Brief Contract',
  'Select Evidence and Draft Brief with GLM-5.2',
  'Validate Brief and Build Review Packet',
  'Review Product Signal Brief',
  'Persist Review Decision',
  'Route Review Decision',
  'Finalize Approved Artifact and Outbox',
  'Close Without Artifact',
];

const validateExport = (workflow, { main = false } = {}) => {
  const names = new Set(workflow.nodes.map((entry) => entry.name));
  const idsSeen = new Set();
  for (const entry of workflow.nodes) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)) {
      throw new Error(`Node "${entry.name}" does not use a UUID v4 ID`);
    }
    if (idsSeen.has(entry.id)) throw new Error(`Duplicate node ID ${entry.id}`);
    idsSeen.add(entry.id);
    if ('credentials' in entry) throw new Error(`Credential reference exported on "${entry.name}"`);
  }
  for (const [from, typed] of Object.entries(workflow.connections)) {
    if (!names.has(from)) throw new Error(`Connection source "${from}" is missing`);
    for (const outputs of typed.main ?? []) {
      for (const target of outputs) {
        if (!names.has(target.node)) throw new Error(`Connection target "${target.node}" is missing`);
      }
    }
  }
  for (const entry of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.postgres')) {
    if (!/\$1/.test(entry.parameters.query)) {
      throw new Error(`Postgres node "${entry.name}" is not parameterized`);
    }
    if (!entry.parameters.options?.queryReplacement?.startsWith('={{ [')) {
      throw new Error(`Postgres node "${entry.name}" does not use a queryReplacement array`);
    }
    if (!entry.retryOnFail || entry.maxTries !== 3 || entry.waitBetweenTries !== 5000) {
      throw new Error(`Postgres node "${entry.name}" is missing bounded retry settings`);
    }
    if (main && entry.onError === 'continueErrorOutput') {
      throw new Error(`Main Postgres node "${entry.name}" must fail closed`);
    }
  }
  if (main) {
    const rootNames = workflow.nodes
      .filter((entry) => entry.type !== 'n8n-nodes-base.stickyNote')
      .map((entry) => entry.name);
    if (JSON.stringify(rootNames) !== JSON.stringify(expectedRootNames)) {
      throw new Error('Main workflow root topology names/order differ from the expected workflow definition');
    }
    if (rootNames.length !== 20) {
      throw new Error(`Expected exactly 20 functional nodes, found ${rootNames.length}`);
    }
    const waits = workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.wait');
    if (
      waits.length !== 1
      || waits[0].parameters.incomingAuthentication !== 'none'
      || waits[0].parameters.limitWaitTime !== false
    ) {
      throw new Error('The single Product Operations review must be durable and loopback-only');
    }
    const trigger = workflow.nodes.find((entry) => entry.type === 'n8n-nodes-base.formTrigger');
    const visibleFields = trigger.parameters.formFields.values
      .filter((field) => field.fieldType !== 'hiddenField');
    if (visibleFields.length !== 3) {
      throw new Error(`Expected three visible intake fields, found ${visibleFields.length}`);
    }
    const route = workflow.nodes.find((entry) => entry.name === 'Route Review Decision');
    if (
      route.parameters.options?.fallbackOutput !== 'extra'
      || !(workflow.connections[route.name]?.main?.[3]?.length > 0)
    ) {
      throw new Error('Review Switch fallback is not explicit and wired');
    }
    if (workflow.nodes.some((entry) => entry.type.includes('langchain') || entry.type.includes('openAi'))) {
      throw new Error('Workflow unexpectedly contains an Agent or provider-specific AI node');
    }
    const glmNodes = workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.httpRequest');
    if (glmNodes.length !== 2) {
      throw new Error(`Expected two bounded GLM HTTP nodes, found ${glmNodes.length}`);
    }
    for (const entry of glmNodes) {
      if (
        entry.parameters.url !== 'https://api.z.ai/api/coding/paas/v4/chat/completions'
        || entry.parameters.authentication !== 'genericCredentialType'
        || entry.parameters.genericAuthType !== 'httpHeaderAuth'
        || !entry.retryOnFail
        || entry.maxTries !== 3
        || entry.waitBetweenTries !== 1500
        || entry.onError !== 'continueErrorOutput'
      ) {
        throw new Error(`GLM node "${entry.name}" violates the provider boundary`);
      }
      if (
        !(workflow.connections[entry.name]?.main?.[0]?.length > 0)
        || !(workflow.connections[entry.name]?.main?.[1]?.length > 0)
      ) {
        throw new Error(`GLM node "${entry.name}" must wire success and error outputs`);
      }
    }
    const stickies = workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.stickyNote');
    if (stickies.length !== 4) throw new Error(`Expected four visual lanes, found ${stickies.length}`);
  }
  const serialized = JSON.stringify(workflow);
  if (/"credentials"\s*:|OPENAI_API_KEY|ANTHROPIC_AUTH_TOKEN|postgresApi/i.test(serialized)) {
    throw new Error('Export contains a credential, credential type, or secret name');
  }
};

validateExport(mainWorkflow, { main: true });
validateExport(errorWorkflow);

for (const [name, workflow] of [
  ['product-signal-control-tower.json', mainWorkflow],
  ['product-signal-error-handler.json', errorWorkflow],
]) {
  writeFileSync(new URL(name, workflowDir), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  console.log(`Wrote workflows/${name}`);
}
