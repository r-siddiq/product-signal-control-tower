# Historical synthetic evidence

These edited artifacts preserve structured results from synthetic runs of the earlier prototype. They are **not** results for the current sanitized project and do not establish that all 21 gates passed end to end.

The JSON captures retain the original object and array structure, numeric and boolean outcomes, selected status values, and recorded timestamps. Free text, URLs, local paths, runtime identifiers, credentials, and employer-specific labels have been removed or replaced with stable synthetic aliases. The source screenshots are not included. The redactions mean these files are evidence summaries, not executable replay inputs.

- `contract-capture.redacted.json` records the earlier 16-case deterministic contract capture.
- `provider-capture.redacted.json` records an earlier provider-backed synthetic capture. Its 16 operational cases and 109 of 135 matching label fields do not establish real-world accuracy; vector similarity was not evaluated.
- `observability-capture.redacted.json` records four earlier synthetic trace cases.
- `clean-import-capture.redacted.json`, `workflow-layout-capture.redacted.json`, and `presentation-qa-capture.redacted.json` preserve other earlier checks. The original presentation is not included.
- `playwright-2026-07-31.redacted.json` records four passing headless scenarios. `playwright-2026-08-04.redacted.json` records the later headed run, including failures in reject and approve at the wait/resume trace-link check.
- `original-gate-matrix.md` preserves the earlier matrix's reported mixed-check statuses, with its original undated provenance.
- `pre-remap-mock-run.json` and `pre-transport-hardening-mock-run.json` preserve earlier isolated mock rehearsals; they precede the current validated changes.

The current isolated local-mock run is recorded in [`../current-mock-run.json`](../current-mock-run.json). Its four passing browser scenarios do not constitute a real-provider test or a full 21-gate run.
