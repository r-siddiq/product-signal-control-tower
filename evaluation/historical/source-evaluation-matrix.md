> Historical source matrix: it combines static, manual, and test statuses and does not establish one twenty-one-gate end-to-end pass.

# Product Signal Control Tower Evaluation Matrix

All cases and identities are synthetic. `captured-results.json` is a credential-free contract baseline; `provider-captured-results.json` is the live GLM 5.2 execution ledger; `otel-captured-results.json` is native n8n trace evidence.

| Gate | Fixture or inspection | Pass condition | Captured evidence | Status |
|---|---|---|---|---|
| Migration rerun | Apply 001–004 twice | Both applications succeed without duplicate state | Transactional rerun completed; 004 replaces the old two-review transition safely | Passed |
| Fixture integrity | All fixture files | Exactly 16 mandatory synthetic IDs and seven reviewed seeds | `validate-fixtures.mjs`: 16/16; no vectors or scores included | Passed |
| Three-field intake | Production Form Trigger | Only signal text, product area, and source context are visible; metadata is generated | `test-minimization.mjs`: 16/16 plus form-generated source/correlation IDs | Passed |
| Data minimization | `CASE-PII-01` | Email/phone values do not cross persistence or model boundaries | Redaction contract and provider execution inspection | Passed |
| Deterministic AI contracts | Local validator tests | Invalid enums/providers degrade; fabricated IDs/excerpts and priority are rejected | `test-deterministic-stubs.mjs` | Passed |
| Clean export and import | Both workflow JSON files | No credentials, instance IDs, or machine paths; inactive probe imports preserve nodes/connections | `clean-import-captured-results.json`: 2/2 imported intact and only the two probes were removed | Passed |
| Node validation | Main and companion | Zero validation errors or warnings | Static and live n8n MCP validation | Passed |
| Graph scope and readability | Main workflow | Exactly 20 functional nodes, four non-overlapping groups, two HTTP model calls, one Wait, no collisions/backward edges | `workflow-layout-captured-results.json` plus generator/static verifier | Passed |
| Known-good E2E | `CASE-FRESH-02` | Two calls, one review, one artifact, one stubbed outbox row | Final provider capture and exact database deltas | Passed |
| Exact replay | `CASE-REPLAY-01A/B` | Existing state returned; both calls/review bypassed; no duplicate side effects | Final provider capture; replay has zero provider calls | Passed |
| Controlled evidence | Related/forbidden fixture pairs | Only supplied reviewed IDs with exact excerpts survive; no numeric score | Provider capture plus deterministic fabricated-ID test | Passed |
| Provider degradation | `CASE-DEGRADE-01` | No match claim; fallback brief; mandatory elevated review | Final provider capture and native trace | Passed |
| Save without artifact | `CASE-UNREL-01` / urgent insight | Review persists; artifact/outbox remain zero | Final provider capture and database deltas | Passed |
| Rejection | `CASE-REJECT-01` | Review persists; signal/artifact/outbox remain constrained by policy | Final provider capture and database deltas | Passed |
| Human hold | Wait node inspection | No timeout or auto-approval route | Workflow JSON and live node configuration | Passed |
| SQL safety | Four PostgreSQL nodes | Parameterized values, retry policy, wired failure outputs | Workflow inspection and live validation | Passed |
| Unexpected failure | Companion Error Trigger | Sanitized audit write; no notification side effect | Companion workflow validation and local audit test | Passed |
| OpenTelemetry | Normal/replay/degraded/reject | Workflow and node spans; Wait resume link; branch-specific node paths | `otel-captured-results.json` | Passed |
| Secrets and paths | Whole package | No key, password, credential ID, real data, or machine path | `verify-project-static.mjs` and submission safety scan | Passed |
| Portability | Fresh local instance | Pinned runtime, rerunnable migrations, clean import, selectable credentials | Docker/runtime docs plus clean import probe | Passed |
| Presentation parity | HTML/PDF vs workflow | Five ranks, two architectures, exact 20-node path, two calls, one review, OTel | `presentation-qa-captured-results.json`: file-mode browser QA at 1366×768 and 1920×1080 plus 15-page rendered PDF inspection | Passed |

## Required metrics

- deterministic validation, minimization, and replay pass rates;
- per-field extraction agreement and Product Operations override rate;
- decision and elevated-review reason distribution;
- end-to-end and per-model-call latency/tokens;
- provider error and safe-degradation rate;
- Wait/review duration and abandonment;
- artifacts/outbox rows per accepted source event;
- trace coverage and error visibility.

These are prototype measurements over synthetic data. They are not production accuracy, customer impact, or realized savings.
