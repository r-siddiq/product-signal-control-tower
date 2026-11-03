BEGIN;

INSERT INTO public.taxonomy_terms (
  taxonomy_name,
  value,
  display_label,
  sort_order
)
SELECT
  seed.taxonomy_name,
  term.value,
  initcap(replace(term.value, '_', ' ')),
  term.sort_order::integer
FROM (
  VALUES
    (
      'product_family',
      ARRAY[
        'municipal_websites',
        'agenda_and_meeting',
        'resident_request_tracking',
        'signal_agent',
        'analytics_assistant',
        'community_development',
        'recreation_management',
        'public_safety',
        'records_and_documents',
        'mass_notification',
        'web_accessibility',
        'process_automation',
        'unknown'
      ]::text[]
    ),
    (
      'intelligence_capability',
      ARRAY[
        'resident_qa',
        'staff_qa',
        'content_advisor',
        'editing_assistant',
        'category_search',
        'photo_analysis',
        'code_review',
        'none',
        'unknown'
      ]::text[]
    ),
    (
      'government_role',
      ARRAY[
        'communications',
        'clerk',
        'it_administrator',
        'community_development',
        'public_safety',
        'parks_and_recreation',
        'customer_service',
        'executive',
        'resident',
        'unknown'
      ]::text[]
    ),
    (
      'signal_type',
      ARRAY[
        'bug',
        'feature_request',
        'usability',
        'data_quality',
        'integration',
        'performance',
        'trust_and_safety',
        'workflow_gap',
        'positive_outcome',
        'unknown'
      ]::text[]
    ),
    (
      'ai_feedback_type',
      ARRAY[
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
        'unknown'
      ]::text[]
    ),
    (
      'trust_risk',
      ARRAY['none', 'low', 'medium', 'high', 'unknown']::text[]
    ),
    (
      'sentiment',
      ARRAY['positive', 'neutral', 'mixed', 'negative', 'unknown']::text[]
    ),
    (
      'urgency',
      ARRAY['low', 'medium', 'high', 'critical', 'unknown']::text[]
    ),
    (
      'customer_impact',
      ARRAY[
        'single_user',
        'single_department',
        'multiple_departments',
        'resident_facing',
        'government_wide',
        'unknown'
      ]::text[]
    )
) AS seed(taxonomy_name, values)
CROSS JOIN LATERAL unnest(seed.values)
  WITH ORDINALITY AS term(value, sort_order)
ON CONFLICT (taxonomy_name, value) DO NOTHING;

INSERT INTO public.themes (
  id,
  slug,
  label,
  definition,
  lifecycle_state,
  approved_by,
  approved_at
)
VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    'source-freshness-and-answer-provenance',
    'Source freshness and answer provenance',
    'Reviewed feedback about the currency and visible provenance of AI-assisted answers.',
    'approved',
    'Synthetic Seed Maintainer',
    '2026-07-01T16:00:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    'official-content-editing-fidelity',
    'Official-content editing fidelity',
    'Reviewed feedback about AI-assisted edits that may change legally or operationally meaningful public content.',
    'approved',
    'Synthetic Seed Maintainer',
    '2026-07-01T16:00:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    'service-request-classification',
    'Service-request classification evidence',
    'Reviewed feedback about category-search or photo-analysis suggestions that conflict with submitted request evidence.',
    'approved',
    'Synthetic Seed Maintainer',
    '2026-07-01T16:00:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    'recreation-registration-usability',
    'Recreation registration usability',
    'Reviewed usability feedback about recreation registration and reservation flows.',
    'approved',
    'Synthetic Seed Maintainer',
    '2026-07-01T16:00:00Z'
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.source_events (
  id,
  source_system,
  source_event_id,
  content_hash,
  correlation_id,
  claim_token,
  first_execution_id,
  received_at,
  customer_segment,
  product_hint,
  channel,
  minimized_text,
  sensitivity_flags,
  demo_case_id,
  processing_status,
  extraction_status,
  retrieval_status,
  extraction_payload,
  retrieval_payload,
  degradation_flags,
  created_at,
  updated_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'research',
    'SYN-SEED-001',
    'd36986502467d0e0e831c88d87d257da5fff9199207fd9568cbe3c08518a8cad',
    'synthetic-seed-001',
    '11000000-0000-4000-8000-000000000001',
    'synthetic-seed-execution-001',
    '2026-06-10T16:00:00Z',
    'unknown',
    'signal_agent',
    'interview',
    'Synthetic scenario: a mock resident answer references an older collection schedule, and the reviewer requests visible source dates.',
    '{}'::jsonb,
    'SEED-REVIEWED-001',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'research',
    'SYN-SEED-002',
    'd5e0d76a6318a2a9058a5f970c1ceade96ebed684c7901fdeee3f73382d5c1fa',
    'synthetic-seed-002',
    '11000000-0000-4000-8000-000000000002',
    'synthetic-seed-execution-002',
    '2026-06-12T16:00:00Z',
    'unknown',
    'municipal_websites',
    'feedback_form',
    'Synthetic scenario: a mock communications editor sees an AI-assisted rewrite change the meaning of an approved public notice.',
    '{}'::jsonb,
    'SEED-REVIEWED-002',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'research',
    'SYN-SEED-003',
    'ecfa4842df97272dddf07a6f143fcab049fac6195ab40e48923a97bbaffa46b2',
    'synthetic-seed-003',
    '11000000-0000-4000-8000-000000000003',
    'synthetic-seed-execution-003',
    '2026-06-14T16:00:00Z',
    'unknown',
    'recreation_management',
    'crm_note',
    'Synthetic scenario: mock recreation staff cannot tell whether a demo registration completed after the confirmation screen refreshes.',
    '{}'::jsonb,
    'SEED-REVIEWED-003',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'research',
    'SYN-SEED-004',
    '66b849128a98ee72ad630b022a7acaeaf48120aa7eed0bfb328802b4ec3cf828',
    'synthetic-seed-004',
    '11000000-0000-4000-8000-000000000004',
    'synthetic-seed-execution-004',
    '2026-06-16T16:00:00Z',
    'unknown',
    'resident_request_tracking',
    'ticket',
    'Synthetic scenario: a mock service request photo is assigned to the wrong demo category before staff review.',
    '{}'::jsonb,
    'SEED-REVIEWED-004',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'research',
    'SYN-SEED-005',
    '0858395ee67dc3e1e9b10a121f3d60773ad60ca12eef6b3dd8539ea30448ed5a',
    'synthetic-seed-005',
    '11000000-0000-4000-8000-000000000005',
    'synthetic-seed-execution-005',
    '2026-06-18T16:00:00Z',
    'unknown',
    'web_accessibility',
    'internal_message',
    'Synthetic scenario: a mock communications editor wants accessibility feedback before publishing demo content.',
    '{}'::jsonb,
    'SEED-REVIEWED-005',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'research',
    'SYN-SEED-006',
    '4352701b5c4ce4341f7f34d72885883d28aa05870ee3cf1719521a2dce5502f7',
    'synthetic-seed-006',
    '11000000-0000-4000-8000-000000000006',
    'synthetic-seed-execution-006',
    '2026-06-20T16:00:00Z',
    'unknown',
    'resident_request_tracking',
    'feedback_form',
    'Synthetic scenario: a mock service-request search suggests an unrelated demo category before staff review.',
    '{}'::jsonb,
    'SEED-REVIEWED-006',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    'research',
    'SYN-SEED-007',
    '9141f6f40c17a24791dfa20bcfdf3738a1c9e20f2832a37f6e5df8017da17ae3',
    'synthetic-seed-007',
    '11000000-0000-4000-8000-000000000007',
    'synthetic-seed-execution-007',
    '2026-06-22T16:00:00Z',
    'unknown',
    'signal_agent',
    'interview',
    'Synthetic scenario: a mock staff answer omits the effective date of the approved policy excerpt shown to the user.',
    '{}'::jsonb,
    'SEED-REVIEWED-007',
    'reviewed_approved',
    'succeeded',
    'not_started',
    '{"seeded":true,"authorship":"synthetic_human"}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '2026-07-01T16:00:00Z',
    '2026-07-01T16:00:00Z'
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.signals (
  id,
  source_event_id,
  product_family,
  intelligence_capability,
  government_role,
  signal_type,
  ai_feedback_type,
  trust_risk,
  problem_statement,
  requested_outcome,
  sentiment,
  urgency,
  customer_impact,
  evidence_spans,
  sensitivity_flags,
  classification_confidence,
  rationale,
  review_status,
  vector_index_status,
  reviewed_at,
  created_at,
  updated_at
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'signal_agent',
    'resident_qa',
    'resident',
    'data_quality',
    'source_freshness',
    'high',
    'A synthetic resident-facing answer references an older mock schedule.',
    'Use current approved content and show source recency.',
    'negative',
    'high',
    'resident_facing',
    '[{"text":"references an older collection schedule","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.9100,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:05:00Z',
    '2026-07-01T16:05:00Z',
    '2026-07-01T16:05:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'municipal_websites',
    'editing_assistant',
    'communications',
    'trust_and_safety',
    'editing_accuracy',
    'high',
    'A synthetic AI-assisted rewrite changes the meaning of an approved public notice.',
    'Preserve the meaning of official content while suggesting edits.',
    'negative',
    'high',
    'resident_facing',
    '[{"text":"change the meaning of an approved public notice","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.8600,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:06:00Z',
    '2026-07-01T16:06:00Z',
    '2026-07-01T16:06:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'recreation_management',
    'none',
    'parks_and_recreation',
    'usability',
    'not_ai_related',
    'low',
    'A synthetic registration flow leaves mock recreation staff unsure whether registration completed.',
    'Show a durable and unambiguous registration confirmation.',
    'negative',
    'medium',
    'single_user',
    '[{"text":"cannot tell whether a demo registration completed","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.9400,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:07:00Z',
    '2026-07-01T16:07:00Z',
    '2026-07-01T16:07:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    'resident_request_tracking',
    'photo_analysis',
    'customer_service',
    'usability',
    'classification_accuracy',
    'medium',
    'A synthetic service-request photo receives the wrong mock category.',
    'Present an accurate suggested category for staff review.',
    'negative',
    'medium',
    'resident_facing',
    '[{"text":"assigned to the wrong demo category","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.8800,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:08:00Z',
    '2026-07-01T16:08:00Z',
    '2026-07-01T16:08:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    'web_accessibility',
    'editing_assistant',
    'communications',
    'workflow_gap',
    'accessibility',
    'medium',
    'A synthetic content workflow delays accessibility feedback until after drafting.',
    'Show accessibility feedback before mock content is published.',
    'neutral',
    'high',
    'resident_facing',
    '[{"text":"accessibility feedback before publishing","supports":"requested_outcome"}]'::jsonb,
    '[]'::jsonb,
    0.9000,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:09:00Z',
    '2026-07-01T16:09:00Z',
    '2026-07-01T16:09:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000006',
    'resident_request_tracking',
    'category_search',
    'customer_service',
    'usability',
    'classification_accuracy',
    'medium',
    'A synthetic service-request search suggests an unrelated mock category.',
    'Show a relevant suggested service-request category for staff review.',
    'negative',
    'medium',
    'resident_facing',
    '[{"text":"suggests an unrelated demo category","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.8700,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:10:00Z',
    '2026-07-01T16:10:00Z',
    '2026-07-01T16:10:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000007',
    'signal_agent',
    'staff_qa',
    'clerk',
    'data_quality',
    'source_freshness',
    'high',
    'A synthetic staff answer omits the effective date of an approved mock policy excerpt.',
    'Display the effective date with the approved source excerpt.',
    'negative',
    'high',
    'single_department',
    '[{"text":"omits the effective date of the approved policy excerpt","supports":"problem_statement"}]'::jsonb,
    '[]'::jsonb,
    0.9200,
    'A synthetic human reviewer confirmed the controlled labels for evaluation.',
    'approved',
    'not_indexed',
    '2026-07-01T16:11:00Z',
    '2026-07-01T16:11:00Z',
    '2026-07-01T16:11:00Z'
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.signal_reviews (
  id,
  idempotency_key,
  signal_id,
  source_event_id,
  review_stage,
  decision,
  before_data,
  after_data,
  actor_name,
  actor_role,
  rationale,
  execution_id,
  correlation_id,
  reviewed_at
)
SELECT
  seed.review_id,
  'synthetic_seed_review:' || seed.signal_id::text,
  seed.signal_id,
  seed.source_event_id,
  'product_ops',
  'approve',
  jsonb_build_object(
    'seeded_extraction',
    true,
    'synthetic',
    true
  ),
  jsonb_build_object(
    'product_family',
    signal.product_family,
    'intelligence_capability',
    signal.intelligence_capability,
    'government_role',
    signal.government_role,
    'signal_type',
    signal.signal_type,
    'ai_feedback_type',
    signal.ai_feedback_type,
    'trust_risk',
    signal.trust_risk,
    'problem_statement',
    signal.problem_statement,
    'requested_outcome',
    signal.requested_outcome,
    'sentiment',
    signal.sentiment,
    'urgency',
    signal.urgency,
    'customer_impact',
    signal.customer_impact,
    'synthetic',
    true
  ),
  'Synthetic Product Operations Reviewer',
  'demo_seed',
  'Synthetic reviewed fixture for retrieval evaluation; not customer evidence.',
  source.first_execution_id,
  source.correlation_id,
  signal.reviewed_at
FROM (
  VALUES
    (
      '30000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000002'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000003'::uuid,
      '20000000-0000-4000-8000-000000000003'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000004'::uuid,
      '20000000-0000-4000-8000-000000000004'::uuid,
      '10000000-0000-4000-8000-000000000004'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000005'::uuid,
      '20000000-0000-4000-8000-000000000005'::uuid,
      '10000000-0000-4000-8000-000000000005'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000006'::uuid,
      '20000000-0000-4000-8000-000000000006'::uuid,
      '10000000-0000-4000-8000-000000000006'::uuid
    ),
    (
      '30000000-0000-4000-8000-000000000007'::uuid,
      '20000000-0000-4000-8000-000000000007'::uuid,
      '10000000-0000-4000-8000-000000000007'::uuid
    )
) AS seed(review_id, signal_id, source_event_id)
JOIN public.signals AS signal
  ON signal.id = seed.signal_id
JOIN public.source_events AS source
  ON source.id = seed.source_event_id
ON CONFLICT DO NOTHING;

INSERT INTO public.theme_signals (
  theme_id,
  signal_id,
  evidence_rank,
  similarity_score,
  association_provenance,
  associated_by,
  associated_at
)
VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:05:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:06:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000003',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:07:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:08:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000005',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:09:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000006',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:10:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000007',
    NULL,
    NULL,
    '{"method":"synthetic_human_seed","reviewed":true}'::jsonb,
    'Synthetic Product Operations Reviewer',
    '2026-07-01T16:11:00Z'
  )
ON CONFLICT DO NOTHING;

COMMIT;
