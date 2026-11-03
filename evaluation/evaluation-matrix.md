# Evaluation matrix

These 21 gates define checks for a synthetic prototype. They are evaluation objectives, not a claim that all gates or an end-to-end run have passed. Record the environment, command, evidence and outcome whenever a gate is run.

| # | Gate | Intended evidence |
|---|---|---|
| 1 | Intake structure | Validate accepted and rejected inputs. |
| 2 | Input minimization | Confirm only required fields are collected. |
| 3 | Normalization | Check normalization of synthetic signals. |
| 4 | Sensitive-data handling | Check minimization and safe logging. |
| 5 | Signal identity | Verify deterministic identifiers. |
| 6 | Replay protection | Verify repeated events do not duplicate work. |
| 7 | Extraction request | Inspect the first model request. |
| 8 | Extraction validation | Reject malformed structured responses. |
| 9 | Extraction degradation | Exercise unavailable or invalid model responses. |
| 10 | Evidence retrieval | Inspect reviewed evidence selection. |
| 11 | Evidence-brief request | Inspect the second model request. |
| 12 | Evidence-brief validation | Reject malformed or unsupported output. |
| 13 | Unsupported assertions | Check that a brief remains evidence-backed. |
| 14 | Human-review gate | Confirm execution pauses for a reviewer. |
| 15 | Rejection | Confirm rejected work is not routed as approved. |
| 16 | Approval | Confirm approval records the decision. |
| 17 | Approved routing | Check the approved artifact and outbox. |
| 18 | Persistence | Verify expected database state changes. |
| 19 | Error sanitization | Check that failure events do not leak secrets. |
| 20 | Observability | Check traces and correlations where configured. |
| 21 | Browser acceptance | Exercise the supported Playwright scenarios. |
