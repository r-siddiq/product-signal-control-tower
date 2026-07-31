const input = $input.first()?.json ?? {};
const execution = input.execution ?? {};
const error = execution.error ?? input.error ?? {};
const rawMessage = String(error.message ?? 'Unexpected workflow failure');

const classify = (message) => {
  if (/postgres|database|connection|sql/i.test(message)) return 'database_failure';
  if (/rate.?limit|429/i.test(message)) return 'provider_rate_limit';
  if (/timeout/i.test(message)) return 'timeout';
  if (/schema|parse|json/i.test(message)) return 'schema_failure';
  if (/embedding|vector/i.test(message)) return 'retrieval_failure';
  return 'unexpected_failure';
};

return [{
  json: {
    synthetic: true,
    captured_at: new Date().toISOString(),
    workflow_id: String(input.workflow?.id ?? ''),
    workflow_name: String(input.workflow?.name ?? 'Product Signal Control Tower'),
    execution_id: String(execution.id ?? ''),
    last_node: String(execution.lastNodeExecuted ?? ''),
    error_class: classify(rawMessage),
    sanitized_message: 'The local synthetic workflow encountered an unexpected failure. Inspect the n8n execution using the recorded identifiers.',
    degradation_status: 'failed_closed',
  },
}];
