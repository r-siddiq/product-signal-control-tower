import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  BRIEF_NODE,
  EXTRACTION_NODE,
  REVIEW_NODE,
  WORKFLOW_NAME,
  assert,
  createN8nClient,
  databaseSnapshot,
  executionIdFromFormBody,
  formFieldIndex,
  generateRunId,
  localRuntimeConfig,
  nodeByName,
  resumeFormUrl,
  safeRunId,
  safeSourceIdentifier,
  scenarioChecks,
  summarizeExecution,
  waitForJaegerExecution,
} from './lib/demo-runtime.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
const fixtureDirectory = resolve(projectRoot, 'fixtures');
const localEvidenceRoot = resolve(projectRoot, 'evaluation', 'local', 'playwright-demo');

function parseArguments(argv) {
  const result = {
    mode: 'headless',
    scenarios: null,
    runId: null,
    captureVideo: false,
    pauseMilliseconds: 900,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') result.mode = argv[++index];
    else if (argument === '--scenarios') result.scenarios = argv[++index]?.split(',').filter(Boolean);
    else if (argument === '--run-id') result.runId = argv[++index];
    else if (argument === '--capture-video') result.captureVideo = true;
    else if (argument === '--pause-ms') result.pauseMilliseconds = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  assert(['headless', 'headed', 'dry-run'].includes(result.mode), '--mode must be headless, headed, or dry-run.');
  assert(Number.isInteger(result.pauseMilliseconds) && result.pauseMilliseconds >= 0 && result.pauseMilliseconds <= 10_000, '--pause-ms must be an integer from 0 to 10000.');
  result.runId = result.runId ? safeRunId(result.runId) : generateRunId();
  return result;
}

function readJson(name) {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8'));
}

const arguments_ = parseArguments(process.argv.slice(2));
const scenarioDocument = readJson('playwright-demo-scenarios.json');
const signalDocument = readJson('synthetic-signals.json');
const signalById = new Map(signalDocument.cases.map((entry) => [entry.demo_case_id, entry]));
const selectedNames = arguments_.scenarios ?? scenarioDocument.default_order;
assert(selectedNames.length > 0, 'Select at least one demo scenario.');
assert(new Set(selectedNames).size === selectedNames.length, 'Demo scenario names must be unique.');
const selectedScenarios = selectedNames.map((name) => {
  const scenario = scenarioDocument.scenarios[name];
  assert(scenario, `Unknown demo scenario: ${name}`);
  return { name, ...scenario };
});

const config = localRuntimeConfig(projectRoot);
const n8n = createN8nClient(config);
const workflow = await n8n.findWorkflow(WORKFLOW_NAME);
const trigger = nodeByName(workflow, 'Submit Product Signal');
const reviewWait = nodeByName(workflow, REVIEW_NODE);
const formUrl = `${config.apiBase}/form/${trigger.webhookId}`;
const functionalNodes = workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote');

function fixtureForScenario(scenario) {
  if (!scenario.fixture_ref) {
    return {
      demo_case_id: scenario.scenario_id,
      source_system: scenario.source_context,
      source_event_id: scenario.scenario_id,
      product_hint: scenario.product_hint,
      raw_text: scenario.signal_text,
      simulate_provider_failure: false,
    };
  }
  const fixture = signalById.get(scenario.fixture_ref);
  assert(fixture, `Fixture not found: ${scenario.fixture_ref}`);
  return fixture;
}

function sourceEventIdFor(fixture, scenario) {
  const rootFixture = scenario.preparation_fixture_ref
    ? signalById.get(scenario.preparation_fixture_ref)
    : fixture;
  assert(rootFixture, `Preparation fixture not found: ${scenario.preparation_fixture_ref}`);
  return safeSourceIdentifier(`${rootFixture.source_event_id}-${arguments_.runId}`);
}

async function preflight() {
  assert(workflow.active === true, 'The main workflow is not active.');
  assert(functionalNodes.length === 20, `Expected 20 functional nodes, found ${functionalNodes.length}.`);
  assert(trigger.type === 'n8n-nodes-base.formTrigger' && trigger.webhookId, 'The active Form Trigger webhook is unavailable.');
  assert(reviewWait.type === 'n8n-nodes-base.wait' && reviewWait.webhookId, 'The review Wait form is unavailable.');
  const configuredFields = trigger.parameters?.formFields?.values ?? [];
  const visibleFields = configuredFields.filter((field) => field.fieldType !== 'hiddenField');
  assert(visibleFields.length === 3, `Expected three visible intake fields, found ${visibleFields.length}.`);
  for (const fieldName of ['signal_text', 'product_hint', 'source_context', 'source_event_id', 'demo_case_id', 'simulate_provider_failure']) {
    formFieldIndex(trigger, fieldName);
  }
  for (const name of [
    'Claim Event and Check Replay',
    'Load Reviewed Evidence Candidates',
    'Persist Review Decision',
    'Finalize Approved Artifact and Outbox',
    EXTRACTION_NODE,
    BRIEF_NODE,
  ]) {
    const node = nodeByName(workflow, name);
    assert(Object.keys(node.credentials ?? {}).length > 0, `Encrypted credential assignment is missing on ${name}.`);
  }
  const [n8nReady, jaegerReady, formReady] = await Promise.all([
    fetch(`${config.apiBase}/healthz/readiness`),
    fetch(`${config.jaegerBase}/`),
    fetch(formUrl),
  ]);
  assert(n8nReady.ok, `n8n readiness returned HTTP ${n8nReady.status}.`);
  assert(jaegerReady.ok, `Jaeger returned HTTP ${jaegerReady.status}.`);
  assert(formReady.ok, `The production intake form returned HTTP ${formReady.status}.`);
  assert(existsSync(browserExecutable), 'The Playwright Chromium executable is unavailable.');
  if (arguments_.mode === 'headed') {
    assert(config.owner.N8N_OWNER_EMAIL && config.owner.N8N_OWNER_PASSWORD, 'The ignored local owner login is unavailable for execution-graph viewing.');
  }
  for (const scenario of selectedScenarios) {
    const fixture = fixtureForScenario(scenario);
    const sourceEventId = sourceEventIdFor(fixture, scenario);
    const snapshot = databaseSnapshot(projectRoot, fixture.source_system, sourceEventId);
    assert(Number(snapshot.source_events) === 0, `Run namespace already exists for ${scenario.name}; use a new run ID.`);
  }
  return {
    workflow_active: workflow.active,
    functional_nodes: functionalNodes.length,
    visible_intake_fields: visibleFields.length,
    form_ready: true,
    jaeger_ready: true,
    chromium_ready: true,
    run_namespace_unused: true,
  };
}

const preflightResult = await preflight();
if (arguments_.mode === 'dry-run') {
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    synthetic: true,
    run_id: arguments_.runId,
    scenarios: selectedNames,
    preflight: preflightResult,
    mutations: 0,
  }, null, 2)}\n`);
  process.exit(0);
}

const runDirectory = resolve(localEvidenceRoot, arguments_.runId);
const screenshotDirectory = resolve(runDirectory, 'screenshots');
const videoDirectory = resolve(runDirectory, 'video');
const profileDirectory = resolve(projectRoot, 'evaluation', 'local', 'playwright-profile');
mkdirSync(screenshotDirectory, { recursive: true });
if (arguments_.captureVideo) mkdirSync(videoDirectory, { recursive: true });
mkdirSync(profileDirectory, { recursive: true });

const context = await chromium.launchPersistentContext(profileDirectory, {
  executablePath: browserExecutable,
  headless: arguments_.mode === 'headless',
  viewport: { width: 1366, height: 768 },
  ...(arguments_.captureVideo ? { recordVideo: { dir: videoDirectory, size: { width: 1366, height: 768 } } } : {}),
});
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(30_000);
const composeText = readFileSync(resolve(projectRoot, 'runtime', 'compose.yaml'), 'utf8');
const playwrightPackage = JSON.parse(readFileSync(resolve(projectRoot, 'node_modules', 'playwright', 'package.json'), 'utf8'));
const workflowExport = readFileSync(
  resolve(projectRoot, 'workflows', 'product-signal-control-tower.json'),
  'utf8',
);
const versionEvidence = {
  n8n_image: /docker\.n8n\.io\/n8nio\/n8n:([^@\s]+)/.exec(composeText)?.[1] ?? null,
  postgres_image: /pgvector\/pgvector:([^@\s]+)/.exec(composeText)?.[1] ?? null,
  postgres_client: execFileSync(
    'docker',
    [
      'compose', '--project-directory', resolve(projectRoot, 'runtime'),
      'exec', '-T', 'postgres', 'psql', '--version',
    ],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
  ).trim(),
  playwright: playwrightPackage.version,
  chromium: context.browser()?.version() ?? null,
  workflow_export_sha256: createHash('sha256').update(workflowExport).digest('hex'),
};

const pause = async () => {
  if (arguments_.mode === 'headed' && arguments_.pauseMilliseconds > 0) {
    await page.waitForTimeout(arguments_.pauseMilliseconds);
  }
};

async function setHiddenField(fieldName, value) {
  const index = formFieldIndex(trigger, fieldName);
  const locator = page.locator(`#field-${index}`);
  await locator.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  assert(await locator.inputValue() === String(value), `Hidden form field was not set: ${fieldName}`);
}

async function submitIntake(fixture, sourceEventId, scenarioName, capture = true) {
  await page.goto(formUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Product signal or feedback', { exact: true }).fill(fixture.raw_text);
  await pause();
  await page.getByLabel('Product area, if known').selectOption(fixture.product_hint ?? 'unknown');
  await pause();
  await page.getByLabel('Source context').selectOption(fixture.source_system ?? 'product_feedback');
  await setHiddenField('source_event_id', sourceEventId);
  await setHiddenField('demo_case_id', fixture.demo_case_id);
  await setHiddenField('simulate_provider_failure', String(Boolean(fixture.simulate_provider_failure)));
  await page.locator('#useResponseData').evaluate((element) => { element.value = 'true'; });
  const visibleBusinessFields = await page.locator('[name^="field-"]:visible').count();
  assert(visibleBusinessFields === 3, `Expected three visible business fields, found ${visibleBusinessFields}.`);
  if (capture) await page.screenshot({ path: resolve(screenshotDirectory, `${scenarioName}-01-intake.png`) });
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && response.url().startsWith(formUrl)
  ));
  await page.getByRole('button', { name: 'Submit' }).click();
  const response = await responsePromise;
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  assert(response.ok(), `Intake form submission failed with HTTP ${response.status()}.`);
  return executionIdFromFormBody(body);
}

async function waitForReviewOrTerminal(executionId) {
  return n8n.pollExecution(
    executionId,
    (candidate) => (
      candidate.status !== 'running'
      && (
        candidate.status !== 'waiting'
        || candidate.data?.resultData?.lastNodeExecuted === REVIEW_NODE
      )
    ),
  );
}

async function submitReview(execution, decision, rationale, scenarioName, capture = true) {
  const url = resumeFormUrl(execution);
  assert(url?.startsWith(`${config.apiBase}/`), 'The review resume URL is missing or not loopback-local.');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Decision', { exact: true }).selectOption(decision);
  await page.getByLabel('Reviewer rationale', { exact: true }).fill(rationale);
  if (capture) await page.screenshot({ path: resolve(screenshotDirectory, `${scenarioName}-03-review.png`) });
  await pause();
  await page.getByRole('button', { name: 'Submit' }).click();
  return n8n.pollExecution(
    execution.id,
    (candidate) => candidate.status !== 'waiting' && candidate.status !== 'running',
    60_000,
  );
}

async function ensureEditorLogin() {
  await page.goto(config.apiBase, { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/signin')) return;
  assert(config.owner.N8N_OWNER_EMAIL && config.owner.N8N_OWNER_PASSWORD, 'Local owner login is unavailable.');
  await page.locator('input[type="email"]').fill(config.owner.N8N_OWNER_EMAIL);
  await page.locator('input[type="password"]').fill(config.owner.N8N_OWNER_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 30_000 });
}

async function showExecutionGraph(executionId, scenarioName, capture = true) {
  await ensureEditorLogin();
  await page.goto(`${config.apiBase}/workflow/${workflow.id}/executions/${executionId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);
  if (capture) await page.screenshot({ path: resolve(screenshotDirectory, `${scenarioName}-04-terminal.png`) });
  await pause();
}

async function executePreparedFixture(fixture, sourceEventId, decision, rationale) {
  const before = databaseSnapshot(projectRoot, fixture.source_system, sourceEventId);
  const executionId = await submitIntake(fixture, sourceEventId, 'replay-preparation', false);
  let execution = await waitForReviewOrTerminal(executionId);
  assert(execution.status === 'waiting', 'Replay preparation did not reach Product Operations review.');
  execution = await submitReview(execution, decision, rationale, 'replay-preparation', false);
  const after = databaseSnapshot(projectRoot, fixture.source_system, sourceEventId);
  const summary = summarizeExecution(execution, before, after);
  assert(summary.execution_status === 'success', 'Replay preparation did not complete successfully.');
  assert(summary.provider_calls.length === 2, 'Replay preparation did not execute both bounded provider calls.');
  assert(summary.database_delta.artifacts === 1 && summary.database_delta.outbox_rows === 1, 'Replay preparation did not create exactly one local artifact and outbox item.');
  await waitForJaegerExecution(config, executionId);
  return summary;
}

const results = [];
let approvedResult = null;
let replayResult = null;

try {
  for (const scenario of selectedScenarios) {
    const fixture = fixtureForScenario(scenario);
    const sourceEventId = sourceEventIdFor(fixture, scenario);
    if (scenario.preparation_fixture_ref) {
      const preparationFixture = signalById.get(scenario.preparation_fixture_ref);
      await executePreparedFixture(
        preparationFixture,
        sourceEventId,
        'approve_backlog_candidate',
        `Synthetic ${scenario.preparation_fixture_ref} approval to establish the canonical replay record.`,
      );
    }

    process.stdout.write(`${JSON.stringify({ checkpoint: 'scenario_start', scenario: scenario.name })}\n`);
    const before = databaseSnapshot(projectRoot, fixture.source_system, sourceEventId);
    const executionId = await submitIntake(fixture, sourceEventId, scenario.name, true);
    let execution = await waitForReviewOrTerminal(executionId);
    if (scenario.review_decision) {
      assert(execution.status === 'waiting', `${scenario.name} did not reach Product Operations review.`);
      await showExecutionGraph(executionId, scenario.name, false);
      execution = await submitReview(
        execution,
        scenario.review_decision,
        scenario.review_rationale,
        scenario.name,
        true,
      );
    }
    const after = databaseSnapshot(projectRoot, fixture.source_system, sourceEventId);
    const summary = summarizeExecution(execution, before, after);
    const checks = scenarioChecks(summary, scenario.expected);
    const trace = await waitForJaegerExecution(config, executionId);
    checks.trace_present = trace.trace_count > 0;
    checks.workflow_spans_present = trace.workflow_spans > 0;
    checks.node_spans_present = trace.node_spans > 0;
    checks.wait_resume_link_present = scenario.review_decision ? trace.follows_from > 0 : true;
    checks.replay_trace_omits_provider_nodes = scenario.name !== 'replay'
      || (!trace.node_names.includes(EXTRACTION_NODE) && !trace.node_names.includes(BRIEF_NODE));
    await showExecutionGraph(executionId, scenario.name, true);
    const result = {
      synthetic: true,
      scenario: scenario.name,
      scenario_id: scenario.scenario_id,
      execution_id: summary.execution_id,
      source_event_id: sourceEventId,
      ...summary,
      trace,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
    writeFileSync(
      resolve(runDirectory, `${scenario.name}-05-assertions.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    results.push(result);
    if (scenario.name === 'approve') approvedResult = result;
    if (scenario.name === 'replay') replayResult = result;
    process.stdout.write(`${JSON.stringify({
      checkpoint: 'scenario_complete',
      scenario: scenario.name,
      execution_id: summary.execution_id,
      passed: result.passed,
    })}\n`);
  }

  if (approvedResult) {
    const approvalTrace = approvedResult.trace.trace_ids.at(-1);
    await page.goto(`${config.jaegerBase}/trace/${approvalTrace}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: resolve(screenshotDirectory, 'jaeger-approval-trace.png') });
  }
  if (replayResult) {
    const replayTrace = replayResult.trace.trace_ids[0];
    await page.goto(`${config.jaegerBase}/trace/${replayTrace}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: resolve(screenshotDirectory, 'jaeger-replay-trace.png') });
  }
  if (approvedResult) await showExecutionGraph(approvedResult.execution_id, 'approved-finale', false);
} finally {
  await context.close();
}

const document = {
  schema_version: '1.0.0',
  synthetic: true,
  captured_at: new Date().toISOString(),
  run_id: arguments_.runId,
  mode: arguments_.mode,
  status: results.length === selectedScenarios.length && results.every((result) => result.passed)
    ? 'playwright_demo_passed'
    : 'playwright_demo_has_failures',
  preflight: preflightResult,
  versions: versionEvidence,
  scenarios: results,
  interpretation: [
    'Every case used synthetic browser input against the loopback-only published n8n Form Trigger.',
    'Human decisions were submitted through the public Wait resume form; no roadmap priority was automated.',
    'The approved action is one local idempotent outbox stub, not a real Signal backlog item.',
    'Trace checks cover native n8n workflow and node spans; no custom business telemetry is claimed.',
  ],
};
writeFileSync(resolve(runDirectory, 'results.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  output: `evaluation/local/playwright-demo/${arguments_.runId}/results.json`,
  status: document.status,
  scenarios: results.length,
  passed: results.filter((result) => result.passed).length,
})}\n`);
if (document.status !== 'playwright_demo_passed') process.exitCode = 1;
