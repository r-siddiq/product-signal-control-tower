BEGIN;

ALTER TABLE public.source_events
  ADD COLUMN IF NOT EXISTS simulate_provider_failure boolean NOT NULL DEFAULT false;

ALTER TABLE public.source_events
  DROP CONSTRAINT IF EXISTS source_events_processing_status_check;

ALTER TABLE public.source_events
  ADD CONSTRAINT source_events_processing_status_check CHECK (
    processing_status IN (
      'received',
      'pending_product_ops_review',
      'product_ops_rejected',
      'product_ops_unrelated',
      'reviewed_approved',
      'reviewed_no_action',
      'pending_final_approval',
      'completed_approved',
      'completed_rejected',
      'failed_closed'
    )
  );

ALTER TABLE public.signal_reviews
  DROP CONSTRAINT IF EXISTS signal_reviews_decision_check;

ALTER TABLE public.signal_reviews
  ADD CONSTRAINT signal_reviews_decision_check CHECK (
    (
      review_stage = 'product_ops'
      AND decision IN (
        'approve',
        'approve_with_edits',
        'reject',
        'unrelated',
        'approve_backlog_candidate',
        'save_reviewed_insight'
      )
    )
    OR (
      review_stage = 'final_approval'
      AND decision IN ('approve', 'approve_with_edits', 'reject')
    )
  );

ALTER TABLE public.signal_reviews
  DROP CONSTRAINT IF EXISTS signal_reviews_required_rationale_check;

ALTER TABLE public.signal_reviews
  ADD CONSTRAINT signal_reviews_required_rationale_check CHECK (
    decision NOT IN ('reject', 'unrelated', 'save_reviewed_insight')
    OR btrim(COALESCE(rationale, '')) <> ''
  );

ALTER TABLE public.signal_reviews
  DROP CONSTRAINT IF EXISTS signal_reviews_signal_presence_check;

ALTER TABLE public.signal_reviews
  ADD CONSTRAINT signal_reviews_signal_presence_check CHECK (
    (decision = 'unrelated' AND signal_id IS NULL)
    OR decision <> 'unrelated'
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_source_event_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.processing_status = OLD.processing_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.processing_status = 'received'
      AND NEW.processing_status IN (
        'pending_product_ops_review',
        'reviewed_approved',
        'reviewed_no_action',
        'completed_rejected',
        'failed_closed'
      ))
    OR (OLD.processing_status = 'pending_product_ops_review'
      AND NEW.processing_status IN (
        'product_ops_rejected',
        'product_ops_unrelated',
        'reviewed_approved',
        'reviewed_no_action',
        'completed_rejected',
        'failed_closed'
      ))
    OR (OLD.processing_status = 'reviewed_approved'
      AND NEW.processing_status IN (
        'pending_final_approval',
        'completed_approved',
        'failed_closed'
      ))
    OR (OLD.processing_status = 'pending_final_approval'
      AND NEW.processing_status IN (
        'completed_approved',
        'completed_rejected',
        'failed_closed'
      ))
  ) THEN
    RAISE EXCEPTION
      'Invalid source event transition from % to %',
      OLD.processing_status,
      NEW.processing_status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_source_event_lean(
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
  p_simulate_provider_failure boolean DEFAULT false
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
    simulate_provider_failure
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
    COALESCE(p_simulate_provider_failure, false)
  )
  ON CONFLICT (source_system, source_event_id) DO UPDATE
  SET
    replay_count = claimed.replay_count + 1,
    replay_content_mismatch_count =
      claimed.replay_content_mismatch_count
      + CASE WHEN claimed.content_hash <> EXCLUDED.content_hash THEN 1 ELSE 0 END,
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
      WHEN v_is_new THEN 'source_claim_lean:' || v_event_id::text
      ELSE 'source_replay_lean:' || v_event_id::text || ':' || p_execution_id
    END,
    v_correlation_id,
    p_execution_id,
    v_event_id,
    CASE WHEN v_is_new THEN 'source_claimed' ELSE 'source_replayed' END,
    v_status,
    'workflow',
    jsonb_build_object(
      'is_new', v_is_new,
      'replay_count', v_replay_count,
      'content_mismatch', v_stored_hash <> p_content_hash
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

CREATE OR REPLACE FUNCTION public.persist_product_ops_decision_lean(
  p_source_event_id uuid,
  p_decision text,
  p_rationale text,
  p_packet jsonb,
  p_execution_id text,
  p_edited_product_family text DEFAULT NULL,
  p_edited_brief_summary text DEFAULT NULL
)
RETURNS TABLE (
  signal_id uuid,
  review_id uuid,
  source_event_uuid uuid,
  decision text,
  processing_status text,
  canonical_signal jsonb,
  brief_json jsonb,
  brief_markdown text,
  degradation_flags jsonb
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.source_events%ROWTYPE;
  v_signal_id uuid;
  v_review_id uuid;
  v_status text;
  v_extraction jsonb;
  v_brief jsonb;
  v_canonical jsonb;
  v_product_family text;
  v_markdown text;
  v_existing_decision text;
BEGIN
  IF p_decision NOT IN (
    'approve_backlog_candidate',
    'save_reviewed_insight',
    'reject'
  ) THEN
    RAISE EXCEPTION 'Invalid Product Operations decision'
      USING ERRCODE = '22023';
  END IF;

  IF btrim(COALESCE(p_rationale, '')) = '' THEN
    RAISE EXCEPTION 'Reviewer rationale is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_event
  FROM public.source_events
  WHERE id = p_source_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source event does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_event.processing_status NOT IN (
    'received',
    'reviewed_approved',
    'reviewed_no_action',
    'completed_rejected'
  ) THEN
    RAISE EXCEPTION 'Source event is not reviewable from its current state'
      USING ERRCODE = '23514';
  END IF;

  SELECT sr.decision
  INTO v_existing_decision
  FROM public.signal_reviews AS sr
  WHERE sr.idempotency_key = 'product_ops_review_lean:' || p_source_event_id::text;

  IF v_existing_decision IS NOT NULL AND v_existing_decision <> p_decision THEN
    RAISE EXCEPTION 'Review idempotency conflict'
      USING ERRCODE = '23505';
  END IF;

  v_extraction := COALESCE(p_packet -> 'extraction', '{}'::jsonb);
  v_brief := COALESCE(p_packet -> 'brief', '{}'::jsonb);
  v_product_family := COALESCE(
    NULLIF(btrim(p_edited_product_family), ''),
    v_extraction ->> 'product_family',
    'unknown'
  );

  IF p_edited_brief_summary IS NOT NULL AND btrim(p_edited_brief_summary) <> '' THEN
    v_brief := jsonb_set(
      v_brief,
      '{problem_summary}',
      to_jsonb(left(btrim(p_edited_brief_summary), 1600)),
      true
    );
  END IF;

  v_brief := jsonb_set(
    v_brief,
    '{reviewer_changes}',
    CASE
      WHEN v_product_family IS DISTINCT FROM (v_extraction ->> 'product_family')
        OR (
          p_edited_brief_summary IS NOT NULL
          AND btrim(p_edited_brief_summary) <> ''
        )
      THEN jsonb_build_array('Product Operations applied a controlled edit.')
      ELSE '[]'::jsonb
    END,
    true
  );

  IF p_decision IN ('approve_backlog_candidate', 'save_reviewed_insight') THEN
    INSERT INTO public.signals AS stored (
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
      reviewed_at
    )
    VALUES (
      p_source_event_id,
      v_product_family,
      COALESCE(v_extraction ->> 'intelligence_capability', 'unknown'),
      COALESCE(v_extraction ->> 'government_role', 'unknown'),
      COALESCE(v_extraction ->> 'signal_type', 'unknown'),
      COALESCE(v_extraction ->> 'ai_feedback_type', 'unknown'),
      COALESCE(v_extraction ->> 'trust_risk', 'unknown'),
      COALESCE(NULLIF(v_extraction ->> 'problem_statement', ''), 'Manual review required.'),
      COALESCE(NULLIF(v_extraction ->> 'requested_outcome', ''), 'Confirm the appropriate discovery follow-up.'),
      COALESCE(v_extraction ->> 'sentiment', 'unknown'),
      COALESCE(v_extraction ->> 'urgency', 'unknown'),
      COALESCE(v_extraction ->> 'customer_impact', 'unknown'),
      COALESCE(v_extraction -> 'evidence_spans', '[]'::jsonb),
      COALESCE(v_extraction -> 'sensitivity_flags', '[]'::jsonb),
      NULLIF(v_extraction ->> 'classification_confidence', '')::numeric,
      COALESCE(NULLIF(v_extraction ->> 'rationale', ''), 'Reviewed by Product Operations.'),
      'approved',
      'not_applicable',
      clock_timestamp()
    )
    ON CONFLICT (source_event_id) DO UPDATE SET
      product_family = EXCLUDED.product_family,
      intelligence_capability = EXCLUDED.intelligence_capability,
      government_role = EXCLUDED.government_role,
      signal_type = EXCLUDED.signal_type,
      ai_feedback_type = EXCLUDED.ai_feedback_type,
      trust_risk = EXCLUDED.trust_risk,
      problem_statement = EXCLUDED.problem_statement,
      requested_outcome = EXCLUDED.requested_outcome,
      sentiment = EXCLUDED.sentiment,
      urgency = EXCLUDED.urgency,
      customer_impact = EXCLUDED.customer_impact,
      evidence_spans = EXCLUDED.evidence_spans,
      sensitivity_flags = EXCLUDED.sensitivity_flags,
      classification_confidence = EXCLUDED.classification_confidence,
      rationale = EXCLUDED.rationale,
      review_status = EXCLUDED.review_status,
      vector_index_status = EXCLUDED.vector_index_status,
      reviewed_at = EXCLUDED.reviewed_at
    RETURNING stored.id INTO v_signal_id;
  END IF;

  v_canonical := CASE
    WHEN v_signal_id IS NULL THEN v_extraction
    ELSE (
      SELECT to_jsonb(s) - 'id' - 'source_event_id' - 'created_at' - 'updated_at'
      FROM public.signals AS s
      WHERE s.id = v_signal_id
    )
  END;

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
    'product_ops_review_lean:' || p_source_event_id::text,
    v_signal_id,
    p_source_event_id,
    'product_ops',
    p_decision,
    p_packet,
    jsonb_build_object(
      'canonical_signal', v_canonical,
      'brief', v_brief,
      'disposition', p_decision
    ),
    'Synthetic Product Ops Reviewer',
    'product_ops_reviewer',
    p_rationale,
    p_execution_id,
    v_event.correlation_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_review_id;

  IF v_review_id IS NULL THEN
    SELECT id
    INTO v_review_id
    FROM public.signal_reviews
    WHERE idempotency_key = 'product_ops_review_lean:' || p_source_event_id::text;
  END IF;

  v_status := CASE p_decision
    WHEN 'approve_backlog_candidate' THEN 'reviewed_approved'
    WHEN 'save_reviewed_insight' THEN 'reviewed_no_action'
    ELSE 'completed_rejected'
  END;

  UPDATE public.source_events
  SET
    processing_status = v_status,
    extraction_status = CASE
      WHEN v_extraction ->> 'extraction_status' = 'succeeded' THEN 'succeeded'
      ELSE 'degraded'
    END,
    retrieval_status = CASE
      WHEN p_packet -> 'evidence' ->> 'status' = 'ok' THEN 'succeeded'
      ELSE 'degraded'
    END,
    extraction_payload = v_extraction,
    retrieval_payload = COALESCE(p_packet -> 'evidence', '{}'::jsonb),
    degradation_flags = COALESCE(p_packet -> 'degradation_flags', '[]'::jsonb),
    extraction_model_id = COALESCE(
      p_packet -> 'model_metadata' -> 'extraction' ->> 'extraction_model',
      'glm-5.2'
    ),
    embedding_model_id = NULL,
    embedding_dimensions = NULL
  WHERE id = p_source_event_id;

  INSERT INTO public.workflow_audit (
    idempotency_key,
    correlation_id,
    execution_id,
    source_event_id,
    signal_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_name,
    degradation_metadata,
    details
  )
  VALUES (
    'product_ops_decision_lean:' || p_source_event_id::text,
    v_event.correlation_id,
    p_execution_id,
    p_source_event_id,
    v_signal_id,
    'product_ops_decision_persisted',
    v_event.processing_status,
    v_status,
    'product_ops',
    'Synthetic Product Ops Reviewer',
    jsonb_build_object(
      'extraction_status', v_extraction ->> 'extraction_status',
      'evidence_status', p_packet -> 'evidence' ->> 'status',
      'brief_status', v_brief ->> 'brief_status'
    ),
    jsonb_build_object(
      'decision', p_decision,
      'review_id', v_review_id,
      'signal_persisted', v_signal_id IS NOT NULL
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  v_markdown :=
    '# ' || COALESCE(v_brief ->> 'title', 'Product Signal Brief')
    || E'\n\n## Problem\n' || COALESCE(v_brief ->> 'problem_summary', '')
    || E'\n\n## Requested outcome\n' || COALESCE(v_brief ->> 'requested_outcome', '')
    || E'\n\n## Discovery questions\n'
    || COALESCE((
      SELECT string_agg('- ' || value, E'\n')
      FROM jsonb_array_elements_text(
        COALESCE(v_brief -> 'suggested_discovery_questions', '[]'::jsonb)
      )
    ), '- Product Operations follow-up required.');

  RETURN QUERY
  SELECT
    v_signal_id,
    v_review_id,
    p_source_event_id,
    p_decision,
    v_status,
    v_canonical,
    v_brief,
    v_markdown,
    COALESCE(p_packet -> 'degradation_flags', '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_approved_artifact_lean(
  p_source_event_id uuid,
  p_brief_json jsonb,
  p_brief_markdown text,
  p_packet jsonb,
  p_execution_id text
)
RETURNS TABLE (
  outcome text,
  source_event_uuid uuid,
  signal_id uuid,
  artifact_id uuid,
  artifact_version integer,
  outbox_id uuid,
  mock_action_status text,
  idempotent_replay boolean,
  degradation_flags jsonb
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.source_events%ROWTYPE;
  v_signal_id uuid;
  v_review_id uuid;
  v_artifact_id uuid;
  v_outbox_id uuid;
  v_replay boolean := false;
  v_evidence_source_ids jsonb;
BEGIN
  SELECT *
  INTO v_event
  FROM public.source_events
  WHERE id = p_source_event_id
  FOR UPDATE;

  SELECT s.id
  INTO v_signal_id
  FROM public.signals AS s
  WHERE s.source_event_id = p_source_event_id
    AND s.review_status = 'approved';

  SELECT sr.id
  INTO v_review_id
  FROM public.signal_reviews AS sr
  WHERE sr.idempotency_key = 'product_ops_review_lean:' || p_source_event_id::text
    AND sr.decision = 'approve_backlog_candidate';

  IF v_event.id IS NULL OR v_signal_id IS NULL OR v_review_id IS NULL THEN
    RAISE EXCEPTION 'Approved Product Operations state is incomplete'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.processing_status = 'completed_approved' THEN
    v_replay := true;
  ELSIF v_event.processing_status <> 'reviewed_approved' THEN
    RAISE EXCEPTION 'Artifact cannot be created from the current state'
      USING ERRCODE = '23514';
  END IF;

  v_evidence_source_ids := COALESCE((
    SELECT jsonb_agg(item ->> 'source_event_id')
    FROM jsonb_array_elements(
      COALESCE(
        p_brief_json -> 'evidence_summary' -> 'representative_evidence',
        '[]'::jsonb
      )
    ) AS item
    WHERE NULLIF(item ->> 'source_event_id', '') IS NOT NULL
  ), '[]'::jsonb);

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
    v_signal_id,
    1,
    '2.0.0',
    'generated',
    'completed_approved',
    p_brief_json,
    p_brief_markdown,
    jsonb_build_object(
      'evidence_source_ids', v_evidence_source_ids,
      'provider_mode',
      COALESCE(
        p_packet -> 'model_metadata' -> 'evidence_brief' ->> 'provider_mode',
        'glm_bounded_selection_and_synthesis'
      )
    ),
    COALESCE(p_packet -> 'model_metadata', '{}'::jsonb),
    v_review_id,
    clock_timestamp()
  )
  ON CONFLICT ON CONSTRAINT artifacts_signal_version_unique DO NOTHING
  RETURNING stored.id INTO v_artifact_id;

  IF v_artifact_id IS NULL THEN
    SELECT a.id
    INTO v_artifact_id
    FROM public.artifacts AS a
    WHERE a.signal_id = v_signal_id
      AND a.version = 1
      AND a.approval_state = 'completed_approved';
    v_replay := true;
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
    'backlog_candidate:' || v_artifact_id::text || ':1',
    v_artifact_id,
    v_signal_id,
    'create_backlog_candidate',
    'mock_product_backlog',
    jsonb_build_object(
      'action', 'create_backlog_candidate',
      'target', 'mock_product_backlog',
      'title', p_brief_json ->> 'title',
      'problem_summary', p_brief_json ->> 'problem_summary',
      'discovery_questions',
        COALESCE(p_brief_json -> 'suggested_discovery_questions', '[]'::jsonb),
      'evidence_source_ids', v_evidence_source_ids,
      'product_families',
        COALESCE(p_brief_json -> 'affected_product_families', '[]'::jsonb),
      'theme_slug', p_brief_json #>> '{theme,slug}',
      'artifact_id', v_artifact_id::text,
      'correlation_id', v_event.correlation_id
    ),
    'stubbed',
    0
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    SELECT id
    INTO v_outbox_id
    FROM public.outbox
    WHERE idempotency_key = 'backlog_candidate:' || v_artifact_id::text || ':1';
  END IF;

  UPDATE public.source_events
  SET processing_status = 'completed_approved'
  WHERE id = p_source_event_id
    AND processing_status IN ('reviewed_approved', 'completed_approved');

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
    degradation_metadata,
    details
  )
  VALUES (
    'artifact_finalize_lean:' || p_source_event_id::text,
    v_event.correlation_id,
    p_execution_id,
    p_source_event_id,
    v_signal_id,
    v_artifact_id,
    'artifact_finalized',
    v_event.processing_status,
    'completed_approved',
    'product_ops',
    'Synthetic Product Ops Reviewer',
    jsonb_build_object(
      'extraction_status', p_packet -> 'extraction' ->> 'extraction_status',
      'evidence_status', p_packet -> 'evidence' ->> 'status',
      'brief_status', p_brief_json ->> 'brief_status'
    ),
    jsonb_build_object(
      'outbox_created', v_outbox_id IS NOT NULL,
      'idempotent_replay', v_replay
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY
  SELECT
    'completed_approved'::text,
    p_source_event_id,
    v_signal_id,
    v_artifact_id,
    1,
    v_outbox_id,
    'stubbed'::text,
    v_replay,
    COALESCE(p_packet -> 'degradation_flags', '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.claim_source_event_lean(
  text, text, text, text, text, timestamptz, text, text, text, text, jsonb, text, boolean
) IS
  'Lean demo source claim: stable source identity, replay metadata, and hidden provider-failure control.';

COMMENT ON FUNCTION public.persist_product_ops_decision_lean(
  uuid, text, text, jsonb, text, text, text
) IS
  'Persists the single Product Operations review and controlled edits without an inline theme-administration or second approval step.';

COMMENT ON FUNCTION public.finalize_approved_artifact_lean(
  uuid, jsonb, text, jsonb, text
) IS
  'Atomically creates the approved versioned brief and one idempotent stubbed outbox action from the Product Operations decision.';

REVOKE ALL ON FUNCTION public.claim_source_event_lean(
  text, text, text, text, text, timestamptz, text, text, text, text, jsonb, text, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_product_ops_decision_lean(
  uuid, text, text, jsonb, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_approved_artifact_lean(
  uuid, jsonb, text, jsonb, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_source_event_lean(
  text, text, text, text, text, timestamptz, text, text, text, text, jsonb, text, boolean
) TO signal_app;
GRANT EXECUTE ON FUNCTION public.persist_product_ops_decision_lean(
  uuid, text, text, jsonb, text, text, text
) TO signal_app;
GRANT EXECUTE ON FUNCTION public.finalize_approved_artifact_lean(
  uuid, jsonb, text, jsonb, text
) TO signal_app;

COMMIT;
