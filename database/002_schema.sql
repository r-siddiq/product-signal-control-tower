BEGIN;

CREATE TABLE IF NOT EXISTS public.taxonomy_terms (
  taxonomy_name text NOT NULL,
  value text NOT NULL,
  display_label text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order > 0),
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (taxonomy_name, value),
  CONSTRAINT taxonomy_terms_name_check CHECK (
    taxonomy_name IN (
      'product_family',
      'intelligence_capability',
      'government_role',
      'signal_type',
      'ai_feedback_type',
      'trust_risk',
      'sentiment',
      'urgency',
      'customer_impact'
    )
  ),
  CONSTRAINT taxonomy_terms_value_format_check
    CHECK (value ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT taxonomy_terms_label_not_blank_check
    CHECK (btrim(display_label) <> '')
);

CREATE TABLE IF NOT EXISTS public.source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  content_hash text NOT NULL,
  correlation_id text NOT NULL UNIQUE,
  claim_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  first_execution_id text NOT NULL,
  received_at timestamptz NOT NULL,
  customer_segment text NOT NULL,
  product_hint text NOT NULL DEFAULT 'unknown',
  channel text NOT NULL,
  minimized_text text NOT NULL,
  sensitivity_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  demo_case_id text,
  simulate_embedding_failure boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'received',
  extraction_status text NOT NULL DEFAULT 'not_started',
  retrieval_status text NOT NULL DEFAULT 'not_started',
  extraction_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieval_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  degradation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  extraction_model_id text,
  embedding_model_id text,
  embedding_dimensions integer,
  replay_count bigint NOT NULL DEFAULT 0,
  replay_content_mismatch_count bigint NOT NULL DEFAULT 0,
  last_replayed_at timestamptz,
  last_replay_execution_id text,
  last_replay_content_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT source_events_source_key_unique
    UNIQUE (source_system, source_event_id),
  CONSTRAINT source_events_source_system_check CHECK (
    source_system IN (
      'support',
      'customer_success',
      'product_feedback',
      'research',
      'internal_escalation'
    )
  ),
  CONSTRAINT source_events_source_event_id_check CHECK (
    char_length(source_event_id) BETWEEN 1 AND 100
    AND source_event_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT source_events_content_hash_check
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT source_events_correlation_not_blank_check
    CHECK (btrim(correlation_id) <> ''),
  CONSTRAINT source_events_execution_not_blank_check
    CHECK (btrim(first_execution_id) <> ''),
  CONSTRAINT source_events_customer_segment_check CHECK (
    customer_segment IN (
      'small_municipality',
      'mid_market_government',
      'large_government',
      'special_district',
      'unknown'
    )
  ),
  CONSTRAINT source_events_product_hint_check CHECK (
    product_hint IN (
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
      'unknown'
    )
  ),
  CONSTRAINT source_events_channel_check CHECK (
    channel IN (
      'ticket',
      'crm_note',
      'feedback_form',
      'interview',
      'internal_message'
    )
  ),
  CONSTRAINT source_events_minimized_text_check
    CHECK (char_length(btrim(minimized_text)) BETWEEN 1 AND 4000),
  CONSTRAINT source_events_sensitivity_flags_check
    CHECK (jsonb_typeof(sensitivity_flags) = 'object'),
  CONSTRAINT source_events_processing_status_check CHECK (
    processing_status IN (
      'received',
      'pending_product_ops_review',
      'product_ops_rejected',
      'product_ops_unrelated',
      'reviewed_approved',
      'pending_final_approval',
      'completed_approved',
      'completed_rejected',
      'failed_closed'
    )
  ),
  CONSTRAINT source_events_extraction_status_check CHECK (
    extraction_status IN ('not_started', 'succeeded', 'degraded')
  ),
  CONSTRAINT source_events_retrieval_status_check CHECK (
    retrieval_status IN ('not_started', 'succeeded', 'degraded')
  ),
  CONSTRAINT source_events_extraction_payload_check
    CHECK (jsonb_typeof(extraction_payload) = 'object'),
  CONSTRAINT source_events_retrieval_payload_check
    CHECK (jsonb_typeof(retrieval_payload) = 'object'),
  CONSTRAINT source_events_degradation_flags_check
    CHECK (jsonb_typeof(degradation_flags) = 'array'),
  CONSTRAINT source_events_embedding_contract_check CHECK (
    (
      embedding_model_id IS NULL
      AND embedding_dimensions IS NULL
    )
    OR (
      embedding_model_id = 'text-embedding-3-small'
      AND embedding_dimensions = 1024
    )
  ),
  CONSTRAINT source_events_replay_count_check
    CHECK (replay_count >= 0 AND replay_content_mismatch_count >= 0),
  CONSTRAINT source_events_last_replay_hash_check CHECK (
    last_replay_content_hash IS NULL
    OR last_replay_content_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT source_events_replay_metadata_check CHECK (
    (
      replay_count = 0
      AND last_replayed_at IS NULL
      AND last_replay_execution_id IS NULL
      AND last_replay_content_hash IS NULL
      AND replay_content_mismatch_count = 0
    )
    OR (
      replay_count > 0
      AND last_replayed_at IS NOT NULL
      AND last_replay_execution_id IS NOT NULL
      AND last_replay_content_hash IS NOT NULL
      AND replay_content_mismatch_count <= replay_count
    )
  )
);

CREATE TABLE IF NOT EXISTS public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid NOT NULL UNIQUE
    REFERENCES public.source_events(id) ON DELETE RESTRICT,
  product_family text NOT NULL,
  intelligence_capability text NOT NULL,
  government_role text NOT NULL,
  signal_type text NOT NULL,
  ai_feedback_type text NOT NULL,
  trust_risk text NOT NULL,
  problem_statement text NOT NULL,
  requested_outcome text NOT NULL,
  sentiment text NOT NULL,
  urgency text NOT NULL,
  customer_impact text NOT NULL,
  evidence_spans jsonb NOT NULL DEFAULT '[]'::jsonb,
  sensitivity_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  classification_confidence numeric(5,4),
  rationale text NOT NULL,
  review_status text NOT NULL,
  vector_index_status text NOT NULL DEFAULT 'not_indexed',
  vector_error_class text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signals_id_source_unique UNIQUE (id, source_event_id),
  CONSTRAINT signals_product_family_check CHECK (
    product_family IN (
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
      'unknown'
    )
  ),
  CONSTRAINT signals_intelligence_capability_check CHECK (
    intelligence_capability IN (
      'resident_qa',
      'staff_qa',
      'content_advisor',
      'editing_assistant',
      'category_search',
      'photo_analysis',
      'code_review',
      'none',
      'unknown'
    )
  ),
  CONSTRAINT signals_government_role_check CHECK (
    government_role IN (
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
    )
  ),
  CONSTRAINT signals_signal_type_check CHECK (
    signal_type IN (
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
    )
  ),
  CONSTRAINT signals_ai_feedback_type_check CHECK (
    ai_feedback_type IN (
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
    )
  ),
  CONSTRAINT signals_trust_risk_check
    CHECK (trust_risk IN ('none', 'low', 'medium', 'high', 'unknown')),
  CONSTRAINT signals_sentiment_check
    CHECK (sentiment IN ('positive', 'neutral', 'mixed', 'negative', 'unknown')),
  CONSTRAINT signals_urgency_check
    CHECK (urgency IN ('low', 'medium', 'high', 'critical', 'unknown')),
  CONSTRAINT signals_customer_impact_check CHECK (
    customer_impact IN (
      'single_user',
      'single_department',
      'multiple_departments',
      'resident_facing',
      'government_wide',
      'unknown'
    )
  ),
  CONSTRAINT signals_problem_not_blank_check
    CHECK (btrim(problem_statement) <> ''),
  CONSTRAINT signals_outcome_not_blank_check
    CHECK (btrim(requested_outcome) <> ''),
  CONSTRAINT signals_rationale_not_blank_check CHECK (btrim(rationale) <> ''),
  CONSTRAINT signals_evidence_spans_check
    CHECK (jsonb_typeof(evidence_spans) = 'array'),
  CONSTRAINT signals_sensitivity_flags_check
    CHECK (jsonb_typeof(sensitivity_flags) = 'array'),
  CONSTRAINT signals_confidence_check CHECK (
    classification_confidence IS NULL
    OR classification_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT signals_review_status_check CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'unrelated')
  ),
  CONSTRAINT signals_vector_index_status_check CHECK (
    vector_index_status IN (
      'not_indexed',
      'indexed',
      'pending_retry',
      'not_applicable'
    )
  ),
  CONSTRAINT signals_review_timestamp_check CHECK (
    (review_status = 'pending' AND reviewed_at IS NULL)
    OR (review_status <> 'pending' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT signals_vector_error_check CHECK (
    vector_index_status = 'pending_retry'
    OR vector_error_class IS NULL
  )
);

CREATE TABLE IF NOT EXISTS public.signal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  signal_id uuid,
  source_event_id uuid NOT NULL,
  review_stage text NOT NULL,
  decision text NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  rationale text,
  execution_id text NOT NULL,
  correlation_id text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_reviews_source_fk
    FOREIGN KEY (source_event_id)
    REFERENCES public.source_events(id) ON DELETE RESTRICT,
  CONSTRAINT signal_reviews_signal_source_fk
    FOREIGN KEY (signal_id, source_event_id)
    REFERENCES public.signals(id, source_event_id) ON DELETE RESTRICT,
  CONSTRAINT signal_reviews_stage_check
    CHECK (review_stage IN ('product_ops', 'final_approval')),
  CONSTRAINT signal_reviews_decision_check CHECK (
    (
      review_stage = 'product_ops'
      AND decision IN (
        'approve',
        'approve_with_edits',
        'reject',
        'unrelated'
      )
    )
    OR (
      review_stage = 'final_approval'
      AND decision IN ('approve', 'approve_with_edits', 'reject')
    )
  ),
  CONSTRAINT signal_reviews_json_check CHECK (
    jsonb_typeof(before_data) = 'object'
    AND jsonb_typeof(after_data) = 'object'
  ),
  CONSTRAINT signal_reviews_actor_check
    CHECK (btrim(actor_name) <> '' AND btrim(actor_role) <> ''),
  CONSTRAINT signal_reviews_execution_check CHECK (
    btrim(execution_id) <> '' AND btrim(correlation_id) <> ''
  ),
  CONSTRAINT signal_reviews_required_rationale_check CHECK (
    decision NOT IN ('reject', 'unrelated')
    OR btrim(COALESCE(rationale, '')) <> ''
  ),
  CONSTRAINT signal_reviews_signal_presence_check CHECK (
    (decision = 'unrelated' AND signal_id IS NULL)
    OR (decision <> 'unrelated' AND signal_id IS NOT NULL)
  )
);

ALTER TABLE public.signal_reviews
  ALTER COLUMN signal_id DROP NOT NULL;

ALTER TABLE public.signal_reviews
  DROP CONSTRAINT IF EXISTS signal_reviews_signal_presence_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.signal_reviews
    WHERE (decision = 'unrelated' AND signal_id IS NOT NULL)
       OR (decision <> 'unrelated' AND signal_id IS NULL)
  ) THEN
    ALTER TABLE public.signal_reviews
      ADD CONSTRAINT signal_reviews_signal_presence_check CHECK (
        (decision = 'unrelated' AND signal_id IS NULL)
        OR (decision <> 'unrelated' AND signal_id IS NOT NULL)
      ) NOT VALID;
  ELSE
    ALTER TABLE public.signal_reviews
      ADD CONSTRAINT signal_reviews_signal_presence_check CHECK (
        (decision = 'unrelated' AND signal_id IS NULL)
        OR (decision <> 'unrelated' AND signal_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  definition text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'approved',
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT themes_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT themes_text_check
    CHECK (btrim(label) <> '' AND btrim(definition) <> ''),
  CONSTRAINT themes_approval_actor_check CHECK (btrim(approved_by) <> ''),
  CONSTRAINT themes_lifecycle_check
    CHECK (lifecycle_state IN ('approved', 'retired')),
  CONSTRAINT themes_retirement_check CHECK (
    (lifecycle_state = 'approved' AND retired_at IS NULL)
    OR (lifecycle_state = 'retired' AND retired_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.theme_signals (
  theme_id uuid NOT NULL
    REFERENCES public.themes(id) ON DELETE RESTRICT,
  signal_id uuid NOT NULL
    REFERENCES public.signals(id) ON DELETE RESTRICT,
  evidence_rank integer,
  similarity_score double precision,
  association_provenance jsonb NOT NULL,
  associated_by text NOT NULL,
  associated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (theme_id, signal_id),
  CONSTRAINT theme_signals_rank_check
    CHECK (evidence_rank IS NULL OR evidence_rank > 0),
  CONSTRAINT theme_signals_similarity_check CHECK (
    similarity_score IS NULL
    OR similarity_score BETWEEN -1.0 AND 1.0
  ),
  CONSTRAINT theme_signals_provenance_check
    CHECK (jsonb_typeof(association_provenance) = 'object'),
  CONSTRAINT theme_signals_actor_check CHECK (btrim(associated_by) <> '')
);

CREATE TABLE IF NOT EXISTS public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL
    REFERENCES public.signals(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  schema_version text NOT NULL,
  brief_status text NOT NULL,
  approval_state text NOT NULL,
  brief_json jsonb NOT NULL,
  brief_markdown text NOT NULL,
  provenance jsonb NOT NULL,
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_review_id uuid
    REFERENCES public.signal_reviews(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT artifacts_signal_version_unique UNIQUE (signal_id, version),
  CONSTRAINT artifacts_version_check CHECK (version > 0),
  CONSTRAINT artifacts_schema_version_check
    CHECK (btrim(schema_version) <> ''),
  CONSTRAINT artifacts_brief_status_check
    CHECK (brief_status IN ('generated', 'manual_required')),
  CONSTRAINT artifacts_approval_state_check CHECK (
    approval_state IN (
      'pending_final_approval',
      'completed_approved',
      'completed_rejected'
    )
  ),
  CONSTRAINT artifacts_brief_json_check CHECK (
    jsonb_typeof(brief_json) = 'object'
    AND brief_json ?& ARRAY[
      'title',
      'theme',
      'affected_product_families',
      'affected_government_roles',
      'problem_summary',
      'requested_outcome',
      'evidence_summary',
      'trust_and_uncertainty',
      'reviewer_changes',
      'suggested_discovery_questions',
      'prohibited_roadmap_priority'
    ]
    AND brief_json -> 'prohibited_roadmap_priority' = 'null'::jsonb
  ),
  CONSTRAINT artifacts_markdown_not_blank_check
    CHECK (btrim(brief_markdown) <> ''),
  CONSTRAINT artifacts_metadata_check CHECK (
    jsonb_typeof(provenance) = 'object'
    AND jsonb_typeof(model_metadata) = 'object'
  ),
  CONSTRAINT artifacts_finalization_check CHECK (
    (
      approval_state = 'pending_final_approval'
      AND final_review_id IS NULL
      AND finalized_at IS NULL
    )
    OR (
      approval_state IN ('completed_approved', 'completed_rejected')
      AND final_review_id IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  artifact_id uuid NOT NULL
    REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  signal_id uuid NOT NULL
    REFERENCES public.signals(id) ON DELETE RESTRICT,
  action_type text NOT NULL,
  target text NOT NULL,
  payload jsonb NOT NULL,
  delivery_status text NOT NULL DEFAULT 'stubbed',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_class text,
  last_error_at timestamptz,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outbox_artifact_action_unique
    UNIQUE (artifact_id, action_type, target),
  CONSTRAINT outbox_action_check
    CHECK (action_type = 'create_backlog_candidate'),
  CONSTRAINT outbox_target_check CHECK (target = 'mock_product_backlog'),
  CONSTRAINT outbox_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY[
      'action',
      'target',
      'title',
      'problem_summary',
      'discovery_questions',
      'evidence_source_ids',
      'product_families',
      'theme_slug',
      'artifact_id',
      'correlation_id'
    ]
    AND payload ->> 'action' = 'create_backlog_candidate'
    AND payload ->> 'target' = 'mock_product_backlog'
  ),
  CONSTRAINT outbox_delivery_status_check CHECK (
    delivery_status IN (
      'stubbed',
      'pending',
      'retrying',
      'delivered',
      'failed',
      'dead_letter'
    )
  ),
  CONSTRAINT outbox_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT outbox_error_metadata_check CHECK (
    (
      last_error_class IS NULL
      AND last_error_at IS NULL
    )
    OR (
      last_error_class IS NOT NULL
      AND last_error_at IS NOT NULL
    )
  ),
  CONSTRAINT outbox_delivery_timestamp_check CHECK (
    delivery_status = 'delivered'
    OR delivered_at IS NULL
  )
);

CREATE TABLE IF NOT EXISTS public.workflow_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE,
  correlation_id text NOT NULL,
  execution_id text NOT NULL,
  source_event_id uuid
    REFERENCES public.source_events(id) ON DELETE RESTRICT,
  signal_id uuid
    REFERENCES public.signals(id) ON DELETE RESTRICT,
  artifact_id uuid
    REFERENCES public.artifacts(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_type text NOT NULL,
  actor_name text,
  latency_ms integer,
  estimated_cost_usd numeric(12,6),
  degradation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workflow_audit_identity_check CHECK (
    btrim(correlation_id) <> ''
    AND btrim(execution_id) <> ''
    AND btrim(event_type) <> ''
  ),
  CONSTRAINT workflow_audit_actor_type_check CHECK (
    actor_type IN ('workflow', 'product_ops', 'product_manager', 'system')
  ),
  CONSTRAINT workflow_audit_metrics_check CHECK (
    (latency_ms IS NULL OR latency_ms >= 0)
    AND (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0)
  ),
  CONSTRAINT workflow_audit_json_check CHECK (
    jsonb_typeof(degradation_metadata) = 'object'
    AND jsonb_typeof(details) = 'object'
  )
);

CREATE TABLE IF NOT EXISTS public.signal_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  metadata jsonb NOT NULL,
  embedding vector(1024) NOT NULL,
  signal_id uuid GENERATED ALWAYS AS (
    ((metadata ->> 'signal_id')::uuid)
  ) STORED,
  embedding_model_id text GENERATED ALWAYS AS (
    (metadata ->> 'embedding_model_id')
  ) STORED,
  embedding_dimensions integer GENERATED ALWAYS AS (
    ((metadata ->> 'embedding_dimensions')::integer)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signal_embeddings_signal_fk
    FOREIGN KEY (signal_id)
    REFERENCES public.signals(id) ON DELETE RESTRICT,
  CONSTRAINT signal_embeddings_signal_model_unique
    UNIQUE (signal_id, embedding_model_id),
  CONSTRAINT signal_embeddings_content_check CHECK (btrim(content) <> ''),
  CONSTRAINT signal_embeddings_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND metadata ?& ARRAY[
      'signal_id',
      'source_system',
      'source_event_id',
      'received_at',
      'product_family',
      'government_role',
      'theme_slug',
      'reviewed',
      'embedding_model_id',
      'embedding_dimensions'
    ]
    AND metadata ->> 'reviewed' = 'true'
  ),
  CONSTRAINT signal_embeddings_contract_check CHECK (
    embedding_model_id = 'text-embedding-3-small'
    AND embedding_dimensions = 1024
  )
);

CREATE INDEX IF NOT EXISTS source_events_content_hash_idx
  ON public.source_events (content_hash);
CREATE INDEX IF NOT EXISTS source_events_status_received_idx
  ON public.source_events (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS source_events_last_replayed_idx
  ON public.source_events (last_replayed_at DESC)
  WHERE last_replayed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS signals_review_status_idx
  ON public.signals (review_status, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS signals_classification_idx
  ON public.signals (
    product_family,
    government_role,
    signal_type,
    ai_feedback_type
  );
CREATE INDEX IF NOT EXISTS signal_reviews_signal_stage_idx
  ON public.signal_reviews (signal_id, review_stage, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS signal_reviews_source_idx
  ON public.signal_reviews (source_event_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS themes_lifecycle_idx
  ON public.themes (lifecycle_state, slug);
CREATE INDEX IF NOT EXISTS theme_signals_signal_idx
  ON public.theme_signals (signal_id);
CREATE INDEX IF NOT EXISTS artifacts_state_idx
  ON public.artifacts (approval_state, created_at DESC);
CREATE INDEX IF NOT EXISTS outbox_delivery_idx
  ON public.outbox (delivery_status, next_attempt_at, created_at)
  WHERE delivery_status IN ('stubbed', 'pending', 'retrying', 'failed');
CREATE INDEX IF NOT EXISTS workflow_audit_correlation_idx
  ON public.workflow_audit (correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS workflow_audit_execution_idx
  ON public.workflow_audit (execution_id, occurred_at);
CREATE INDEX IF NOT EXISTS workflow_audit_source_idx
  ON public.workflow_audit (source_event_id, occurred_at)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_audit_signal_idx
  ON public.workflow_audit (signal_id, occurred_at)
  WHERE signal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_audit_artifact_idx
  ON public.workflow_audit (artifact_id, occurred_at)
  WHERE artifact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signal_embeddings_metadata_idx
  ON public.signal_embeddings USING gin (metadata);
CREATE INDEX IF NOT EXISTS signal_embeddings_cosine_hnsw_idx
  ON public.signal_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_source_event_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.processing_status = OLD.processing_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (
      OLD.processing_status = 'received'
      AND NEW.processing_status IN (
        'pending_product_ops_review',
        'failed_closed'
      )
    )
    OR (
      OLD.processing_status = 'pending_product_ops_review'
      AND NEW.processing_status IN (
        'product_ops_rejected',
        'product_ops_unrelated',
        'reviewed_approved',
        'failed_closed'
      )
    )
    OR (
      OLD.processing_status = 'reviewed_approved'
      AND NEW.processing_status = 'pending_final_approval'
    )
    OR (
      OLD.processing_status = 'pending_final_approval'
      AND NEW.processing_status IN (
        'completed_approved',
        'completed_rejected'
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Invalid source event state transition from % to %',
      OLD.processing_status,
      NEW.processing_status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_signal_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'signal_reviews is append-only; % is not permitted',
    TG_OP
    USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_final_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.approval_state IN ('completed_approved', 'completed_rejected')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION
      'Final artifact % version % is immutable',
      OLD.signal_id,
      OLD.version
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_reviewed_theme_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.signals AS s
    JOIN public.themes AS t
      ON t.id = NEW.theme_id
    WHERE s.id = NEW.signal_id
      AND s.review_status = 'approved'
      AND t.lifecycle_state = 'approved'
  ) THEN
    RAISE EXCEPTION
      'Theme membership requires an approved signal and approved theme'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_reviewed_signal_embedding()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_signal_id uuid;
  v_source_system text;
  v_source_event_key text;
  v_product_family text;
  v_government_role text;
  v_review_status text;
BEGIN
  v_signal_id := (NEW.metadata ->> 'signal_id')::uuid;

  SELECT
    se.source_system,
    se.source_event_id,
    s.product_family,
    s.government_role,
    s.review_status
  INTO
    v_source_system,
    v_source_event_key,
    v_product_family,
    v_government_role,
    v_review_status
  FROM public.signals AS s
  JOIN public.source_events AS se
    ON se.id = s.source_event_id
  WHERE s.id = v_signal_id;

  IF NOT FOUND OR v_review_status <> 'approved' THEN
    RAISE EXCEPTION
      'Embedding requires an approved canonical signal'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.metadata ->> 'source_system' IS DISTINCT FROM v_source_system
     OR NEW.metadata ->> 'source_event_id' IS DISTINCT FROM v_source_event_key
     OR NEW.metadata ->> 'product_family' IS DISTINCT FROM v_product_family
     OR NEW.metadata ->> 'government_role' IS DISTINCT FROM v_government_role THEN
    RAISE EXCEPTION
      'Embedding metadata does not match canonical reviewed signal %',
      v_signal_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.theme_signals AS ts
    JOIN public.themes AS t
      ON t.id = ts.theme_id
    WHERE ts.signal_id = v_signal_id
      AND t.slug = NEW.metadata ->> 'theme_slug'
      AND t.lifecycle_state = 'approved'
  ) THEN
    RAISE EXCEPTION
      'Embedding theme is not an approved membership for signal %',
      v_signal_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'source_events_enforce_transition'
      AND tgrelid = 'public.source_events'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER source_events_enforce_transition
      BEFORE UPDATE OF processing_status
      ON public.source_events
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_source_event_transition();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'source_events_set_updated_at'
      AND tgrelid = 'public.source_events'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER source_events_set_updated_at
      BEFORE UPDATE ON public.source_events
      FOR EACH ROW
      EXECUTE FUNCTION public.set_row_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'theme_signals_require_reviewed'
      AND tgrelid = 'public.theme_signals'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER theme_signals_require_reviewed
      BEFORE INSERT OR UPDATE ON public.theme_signals
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_reviewed_theme_membership();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'signal_embeddings_require_reviewed'
      AND tgrelid = 'public.signal_embeddings'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signal_embeddings_require_reviewed
      BEFORE INSERT OR UPDATE ON public.signal_embeddings
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_reviewed_signal_embedding();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'signals_set_updated_at'
      AND tgrelid = 'public.signals'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signals_set_updated_at
      BEFORE UPDATE ON public.signals
      FOR EACH ROW
      EXECUTE FUNCTION public.set_row_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'signal_reviews_append_only'
      AND tgrelid = 'public.signal_reviews'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signal_reviews_append_only
      BEFORE UPDATE OR DELETE ON public.signal_reviews
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_signal_review_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'themes_set_updated_at'
      AND tgrelid = 'public.themes'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER themes_set_updated_at
      BEFORE UPDATE ON public.themes
      FOR EACH ROW
      EXECUTE FUNCTION public.set_row_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'artifacts_prevent_final_mutation'
      AND tgrelid = 'public.artifacts'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER artifacts_prevent_final_mutation
      BEFORE UPDATE ON public.artifacts
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_final_artifact_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'artifacts_set_updated_at'
      AND tgrelid = 'public.artifacts'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER artifacts_set_updated_at
      BEFORE UPDATE ON public.artifacts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_row_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'outbox_set_updated_at'
      AND tgrelid = 'public.outbox'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER outbox_set_updated_at
      BEFORE UPDATE ON public.outbox
      FOR EACH ROW
      EXECUTE FUNCTION public.set_row_updated_at();
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.claim_source_event(
  p_source_system text,
  p_source_event_id text,
  p_content_hash text,
  p_correlation_id text,
  p_execution_id text,
  p_received_at timestamptz,
  p_customer_segment text,
  p_product_hint text,
  p_channel text,
  p_minimized_text text,
  p_sensitivity_flags jsonb,
  p_demo_case_id text DEFAULT NULL,
  p_simulate_embedding_failure boolean DEFAULT false
)
RETURNS TABLE (
  event_id uuid,
  is_new boolean,
  current_status text,
  current_replay_count bigint,
  content_mismatch boolean,
  canonical_correlation_id text
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claim_token uuid := gen_random_uuid();
  v_event_id uuid;
  v_is_new boolean;
  v_status text;
  v_replay_count bigint;
  v_stored_hash text;
  v_correlation_id text;
BEGIN
  INSERT INTO public.source_events AS claimed (
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
    simulate_embedding_failure
  )
  VALUES (
    p_source_system,
    p_source_event_id,
    p_content_hash,
    p_correlation_id,
    v_claim_token,
    p_execution_id,
    p_received_at,
    p_customer_segment,
    COALESCE(p_product_hint, 'unknown'),
    p_channel,
    p_minimized_text,
    COALESCE(p_sensitivity_flags, '{}'::jsonb),
    p_demo_case_id,
    COALESCE(p_simulate_embedding_failure, false)
  )
  ON CONFLICT (source_system, source_event_id) DO UPDATE
  SET
    replay_count = claimed.replay_count + 1,
    replay_content_mismatch_count =
      claimed.replay_content_mismatch_count
      + CASE
          WHEN claimed.content_hash <> EXCLUDED.content_hash THEN 1
          ELSE 0
        END,
    last_replayed_at = clock_timestamp(),
    last_replay_execution_id = EXCLUDED.first_execution_id,
    last_replay_content_hash = EXCLUDED.content_hash
  RETURNING
    claimed.id,
    claimed.claim_token = v_claim_token,
    claimed.processing_status,
    claimed.replay_count,
    claimed.content_hash,
    claimed.correlation_id
  INTO
    v_event_id,
    v_is_new,
    v_status,
    v_replay_count,
    v_stored_hash,
    v_correlation_id;

  INSERT INTO public.workflow_audit (
    idempotency_key,
    correlation_id,
    execution_id,
    source_event_id,
    event_type,
    to_status,
    actor_type,
    details
  )
  VALUES (
    CASE
      WHEN v_is_new THEN 'source_claim:' || v_event_id::text
      ELSE
        'source_replay:' || v_event_id::text || ':' || p_execution_id
    END,
    v_correlation_id,
    p_execution_id,
    v_event_id,
    CASE WHEN v_is_new THEN 'source_claimed' ELSE 'source_replayed' END,
    v_status,
    'workflow',
    jsonb_build_object(
      'is_new',
      v_is_new,
      'replay_count',
      v_replay_count,
      'content_mismatch',
      v_stored_hash <> p_content_hash
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY
  SELECT
    v_event_id,
    v_is_new,
    v_status,
    v_replay_count,
    v_stored_hash <> p_content_hash,
    v_correlation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_artifact_and_outbox(
  p_signal_id uuid,
  p_version integer,
  p_decision text,
  p_actor_name text,
  p_actor_role text,
  p_rationale text,
  p_before_data jsonb,
  p_after_data jsonb,
  p_brief_json jsonb,
  p_brief_markdown text,
  p_schema_version text,
  p_brief_status text,
  p_execution_id text,
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_model_metadata jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL,
  p_estimated_cost_usd numeric DEFAULT NULL
)
RETURNS TABLE (
  artifact_id uuid,
  artifact_version integer,
  final_status text,
  outbox_id uuid,
  idempotent_replay boolean
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source_event_id uuid;
  v_correlation_id text;
  v_current_status text;
  v_final_status text;
  v_review_id uuid;
  v_artifact_id uuid;
  v_outbox_id uuid;
  v_existing_state text;
  v_evidence_source_ids jsonb;
BEGIN
  IF p_decision NOT IN ('approve', 'approve_with_edits', 'reject') THEN
    RAISE EXCEPTION 'Invalid final decision: %', p_decision
      USING ERRCODE = '22023';
  END IF;

  IF p_version <= 0 THEN
    RAISE EXCEPTION 'Artifact version must be positive'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    se.id,
    se.correlation_id,
    se.processing_status
  INTO
    v_source_event_id,
    v_correlation_id,
    v_current_status
  FROM public.signals AS s
  JOIN public.source_events AS se
    ON se.id = s.source_event_id
  WHERE s.id = p_signal_id
    AND s.review_status = 'approved'
  FOR UPDATE OF se;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved signal % does not exist', p_signal_id
      USING ERRCODE = '23503';
  END IF;

  v_final_status :=
    CASE
      WHEN p_decision IN ('approve', 'approve_with_edits')
        THEN 'completed_approved'
      ELSE 'completed_rejected'
    END;

  IF v_current_status = v_final_status THEN
    SELECT a.id, a.approval_state
    INTO v_artifact_id, v_existing_state
    FROM public.artifacts AS a
    WHERE a.signal_id = p_signal_id
      AND a.version = p_version;

    IF v_artifact_id IS NULL OR v_existing_state <> v_final_status THEN
      RAISE EXCEPTION
        'Finalized source event % has inconsistent artifact state',
        v_source_event_id
        USING ERRCODE = '23514';
    END IF;

    SELECT o.id
    INTO v_outbox_id
    FROM public.outbox AS o
    WHERE o.idempotency_key =
      'backlog_candidate:' || v_artifact_id::text || ':' || p_version::text;

    RETURN QUERY
    SELECT v_artifact_id, p_version, v_final_status, v_outbox_id, true;
    RETURN;
  END IF;

  IF v_current_status <> 'pending_final_approval' THEN
    RAISE EXCEPTION
      'Signal % cannot be finalized from source event state %',
      p_signal_id,
      v_current_status
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.signal_reviews (
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
    correlation_id
  )
  VALUES (
    'final_review:' || p_signal_id::text || ':' || p_version::text,
    p_signal_id,
    v_source_event_id,
    'final_approval',
    p_decision,
    p_before_data,
    p_after_data,
    p_actor_name,
    p_actor_role,
    p_rationale,
    p_execution_id,
    v_correlation_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_review_id;

  IF v_review_id IS NULL THEN
    SELECT sr.id
    INTO v_review_id
    FROM public.signal_reviews AS sr
    WHERE sr.idempotency_key =
      'final_review:' || p_signal_id::text || ':' || p_version::text
      AND sr.signal_id = p_signal_id
      AND sr.review_stage = 'final_approval'
      AND sr.decision = p_decision;

    IF v_review_id IS NULL THEN
      RAISE EXCEPTION 'Final review idempotency conflict for signal %', p_signal_id
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.artifacts AS stored (
    signal_id,
    version,
    schema_version,
    brief_status,
    approval_state,
    brief_json,
    brief_markdown,
    provenance,
    model_metadata,
    final_review_id,
    finalized_at
  )
  VALUES (
    p_signal_id,
    p_version,
    p_schema_version,
    p_brief_status,
    v_final_status,
    p_brief_json,
    p_brief_markdown,
    COALESCE(p_provenance, '{}'::jsonb),
    COALESCE(p_model_metadata, '{}'::jsonb),
    v_review_id,
    clock_timestamp()
  )
  ON CONFLICT (signal_id, version) DO UPDATE
  SET
    schema_version = EXCLUDED.schema_version,
    brief_status = EXCLUDED.brief_status,
    approval_state = EXCLUDED.approval_state,
    brief_json = EXCLUDED.brief_json,
    brief_markdown = EXCLUDED.brief_markdown,
    provenance = EXCLUDED.provenance,
    model_metadata = EXCLUDED.model_metadata,
    final_review_id = EXCLUDED.final_review_id,
    finalized_at = EXCLUDED.finalized_at
  WHERE stored.approval_state = 'pending_final_approval'
  RETURNING stored.id INTO v_artifact_id;

  IF v_artifact_id IS NULL THEN
    RAISE EXCEPTION
      'Artifact version % for signal % is already final',
      p_version,
      p_signal_id
      USING ERRCODE = '23505';
  END IF;

  IF v_final_status = 'completed_approved' THEN
    v_evidence_source_ids :=
      COALESCE(p_provenance -> 'evidence_source_ids', '[]'::jsonb);

    IF jsonb_typeof(v_evidence_source_ids) <> 'array' THEN
      RAISE EXCEPTION 'provenance.evidence_source_ids must be an array'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.outbox (
      idempotency_key,
      artifact_id,
      signal_id,
      action_type,
      target,
      payload,
      delivery_status,
      attempt_count
    )
    VALUES (
      'backlog_candidate:' || v_artifact_id::text || ':' || p_version::text,
      v_artifact_id,
      p_signal_id,
      'create_backlog_candidate',
      'mock_product_backlog',
      jsonb_build_object(
        'action',
        'create_backlog_candidate',
        'target',
        'mock_product_backlog',
        'title',
        p_brief_json ->> 'title',
        'problem_summary',
        p_brief_json ->> 'problem_summary',
        'discovery_questions',
        COALESCE(
          p_brief_json -> 'suggested_discovery_questions',
          '[]'::jsonb
        ),
        'evidence_source_ids',
        v_evidence_source_ids,
        'product_families',
        COALESCE(
          p_brief_json -> 'affected_product_families',
          '[]'::jsonb
        ),
        'theme_slug',
        p_brief_json #>> '{theme,slug}',
        'artifact_id',
        v_artifact_id::text,
        'correlation_id',
        v_correlation_id
      ),
      'stubbed',
      0
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_outbox_id;

    IF v_outbox_id IS NULL THEN
      SELECT o.id
      INTO v_outbox_id
      FROM public.outbox AS o
      WHERE o.idempotency_key =
        'backlog_candidate:' || v_artifact_id::text || ':' || p_version::text;
    END IF;
  END IF;

  UPDATE public.source_events
  SET processing_status = v_final_status
  WHERE id = v_source_event_id;

  INSERT INTO public.workflow_audit (
    idempotency_key,
    correlation_id,
    execution_id,
    source_event_id,
    signal_id,
    artifact_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_name,
    latency_ms,
    estimated_cost_usd,
    degradation_metadata,
    details
  )
  VALUES (
    'finalize:' || p_signal_id::text || ':' || p_version::text,
    v_correlation_id,
    p_execution_id,
    v_source_event_id,
    p_signal_id,
    v_artifact_id,
    'artifact_finalized',
    v_current_status,
    v_final_status,
    'product_manager',
    p_actor_name,
    p_latency_ms,
    p_estimated_cost_usd,
    COALESCE(p_provenance -> 'degradation_metadata', '{}'::jsonb),
    jsonb_build_object(
      'decision',
      p_decision,
      'artifact_version',
      p_version,
      'outbox_created',
      v_outbox_id IS NOT NULL
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY
  SELECT v_artifact_id, p_version, v_final_status, v_outbox_id, false;
END;
$function$;

COMMENT ON FUNCTION public.claim_source_event(
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  boolean
) IS
  'Atomically claims a source key or records replay metadata without changing canonical intake.';

COMMENT ON FUNCTION public.finalize_artifact_and_outbox(
  uuid,
  integer,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer,
  numeric
) IS
  'Atomically persists the final human review, versioned brief, optional idempotent backlog outbox item, source state, and audit event.';

GRANT USAGE ON SCHEMA public TO signal_app;
GRANT SELECT ON public.taxonomy_terms TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.source_events TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.signals TO signal_app;
GRANT SELECT, INSERT ON public.signal_reviews TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.themes TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.theme_signals TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.artifacts TO signal_app;
GRANT SELECT, INSERT, UPDATE ON public.outbox TO signal_app;
GRANT SELECT, INSERT ON public.workflow_audit TO signal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_embeddings
  TO signal_app;

REVOKE EXECUTE ON FUNCTION public.claim_source_event(
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_source_event(
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  boolean
) TO signal_app;

REVOKE EXECUTE ON FUNCTION public.finalize_artifact_and_outbox(
  uuid,
  integer,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer,
  numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_artifact_and_outbox(
  uuid,
  integer,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer,
  numeric
) TO signal_app;

COMMIT;
