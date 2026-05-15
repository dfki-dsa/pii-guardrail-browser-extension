# Public Source Boundary

Use this checklist before creating the fresh public initial commit. The public
repository must be built from the curated working tree, not by pushing this
repository's existing local Git history.

## Include In Public Source

- `src/**` extension TypeScript, Svelte UI, content scripts, background worker,
  offscreen runtime, and shared browser code.
- `crate/**` Rust/WASM source, Cargo manifests, and lockfile, excluding generated
  build output.
- `scripts/**` build, model-prep, packaging, and benchmark helper scripts that
  are safe to publish.
- `tests/**` public unit and integration tests that run without local-only model
  corpora or private account state.
- Public documentation under `docs/**`, excluding local issue-planning drafts.
- CI configuration, GitHub issue templates, package manifests, TypeScript,
  Svelte, Webpack, Jest, and extension manifest configuration.

## Exclude From Public Source

- `.private-docs/**` local launch plans, PRDs, research drafts, and issue
  planning that should not enter the public initial commit.
- `docs/issues/**` local implementation planning drafts.
- `tests-local/**` local model regression fixtures and smoke-test harnesses.
- `dist/**`, `generated/**`, `crate/pkg/**`, `crate/target/**`, `coverage/**`,
  `.venv/**`, `.model-sources/**`, and `node_modules/**`.
- Raw release archives and checksums until they are produced by the official
  release packaging flow and attached to a reviewed release.
- Generated benchmark corpora, downloaded benchmark caches, result JSON files,
  and comparison reports.

## Verification Commands

Run these checks before the public initial commit:

```bash
git check-ignore \
  .private-docs/public-beta-launch-plan.md \
  dist/manifest.json \
  generated/models/ner/example/manifest.json \
  crate/pkg/privacy_guardrail_wasm.js \
  crate/target/CACHEDIR.TAG \
  .model-sources/example/config.json \
  .venv/pyvenv.cfg \
  coverage/lcov.info \
  node_modules/.package-lock.json \
  privacy-guardrail-0.2.0.zip \
  release/privacy-guardrail-0.2.0.zip \
  release/privacy-guardrail-0.2.0.sha256 \
  benchmarks/cache/openpii/manifest.json \
  benchmarks/corpora/openpii-generated.jsonl \
  benchmarks/results.bardsai.json \
  benchmarks/comparison.md \
  tests-local/ner-regression-corpus.json
```

Expected result: every path is printed.

```bash
git ls-files \
  .private-docs \
  tests-local \
  dist \
  generated \
  crate/pkg \
  crate/target \
  .model-sources \
  .venv \
  coverage \
  node_modules \
  benchmarks/cache \
  benchmarks/corpora \
  'benchmarks/results*.json' \
  'benchmarks/comparison*.md' \
  'privacy-guardrail-*.zip' \
  'release/*.zip' \
  'release/*.sha256'
```

Expected result: no output.

```bash
git ls-files docs/issues
```

Expected result: no output in the fresh public initial commit. Local issue drafts
may remain in this working repository until the public tree is curated.
