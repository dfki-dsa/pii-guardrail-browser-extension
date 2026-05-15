# Releasing

This guide describes the intended public beta release workflow for `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`. The first public beta is version `0.2.0` and should be published as a GitHub pre-release before the same reviewed artifact is uploaded manually to the Chrome Web Store.

## Release Invariants

- Keep `package.json`, `package-lock.json`, `manifest.json`, Git tag, release zip name, release checksum, and changelog aligned on the same version.
- Publish from a curated fresh public history, not this local repository's existing private history.
- Keep `.private-docs/`, `docs/issues/`, local fixtures, generated corpora, and raw build outputs out of the public initial commit.
- Keep the Chrome Web Store upload manual for the first public beta.
- Do not publish source maps in the official extension package.
- Attach the exact Chrome package zip and SHA-256 checksum to the GitHub pre-release.

The official package builder creates the reviewed Chrome Web Store upload artifact from `dist/` and writes the checksum that must be attached to the GitHub pre-release.

## Prepare The Tree

1. Confirm the public source boundary:

   ```bash
   git check-ignore .private-docs/public-beta-launch-plan.md dist/manifest.json generated/models/ner/example/manifest.json
   git ls-files .private-docs tests-local dist generated crate/pkg crate/target .model-sources .venv coverage node_modules
   git ls-files docs/issues
   ```

2. Confirm the public repo target is `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.
3. Confirm all public docs use beta wording and avoid guarantees of perfect detection, prevention, or regulatory compliance.

See `docs/release/public-source-boundary.md` and `docs/release/public-initial-commit.md`.

## Align Version

For the first public beta, align:

- `package.json`
- `package-lock.json`
- `manifest.json`
- `CHANGELOG.md`
- release zip name
- Git tag `v0.2.0`
- GitHub Release title

To set the first public beta version:

```bash
npm run version:set -- 0.2.0
```

Before packaging, verify aligned release metadata:

```bash
npm run version:check -- 0.2.0
```

After creating the final release tag, require the expected Git tag as part of the final check:

```bash
npm run version:check -- 0.2.0 --require-tag
```

The version check validates `package.json`, `package-lock.json`, `manifest.json`, the `CHANGELOG.md` release heading, release archive/checksum naming when files exist under `release/`, and the expected Git tag `v0.2.0` when `--require-tag` is passed.

## Validate

Model-free CI checks:

```bash
npm run validate:ci
```

This path is safe for GitHub Actions and pull requests. It runs Jest, Svelte checks, version alignment, Chrome permission checks, the privacy-boundary scan, Rust tests, and a model-free extension build. It does not download, prepare, or require large model assets. The current tree does not have a healthy ESLint setup, so lint is not part of CI yet.

Release-strict checks with prepared BardsAI assets:

```bash
npm run validate:release-strict
```

This path runs the same release metadata and privacy-boundary checks, builds the WASM package, and then builds the extension with `NER_MODEL_ASSETS_REQUIRED=1`. It fails if the prepared BardsAI files are missing from `generated/models/ner/bardsai-eu-pii-anonimization-multilang/`.

Run the manual smoke checklist in `docs/release/smoke-test-checklist.md` against:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

Before packaging, review `docs/release/chrome-permissions.md` and `docs/release/privacy-boundary.md`. Reuse the permission justifications for the Chrome Web Store listing, and keep the privacy-boundary check green before creating release artifacts.

## Package

After release-strict validation and manual smoke testing are green, create the official Chrome extension package:

```bash
npm run package:release -- --version 0.2.0
```

The command:

- requires a clean Git worktree before building
- verifies release metadata with `version:check`
- requires prepared BardsAI model assets and ONNX Runtime Web assets
- runs the WASM release build and the extension build with `NER_MODEL_ASSETS_REQUIRED=1`
- zips only runtime files from `dist/`
- excludes source maps and private/source-only/generated-local paths
- writes `release/privacy-guardrail-0.2.0.zip`
- writes `release/privacy-guardrail-0.2.0.sha256` for the exact zip

For local package-content checks against an existing `dist/` tree without the clean-worktree guard or build step, run:

```bash
npm run package:dry-run -- --version 0.2.0
```

The dry run is not a release artifact. It exists to verify include/exclude behavior while local changes are still in progress.

## GitHub Pre-Release

For the public beta:

1. Create the fresh public initial commit from the curated tree.
2. Push to `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.
3. Tag the release version, for example `v0.2.0`.
4. Create a GitHub Release marked as a pre-release.
5. Attach the exact Chrome extension zip and checksum.
6. Link the release notes to `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md`, and support docs.

## Chrome Web Store Handoff

Chrome Web Store upload is manual for the first public beta. Upload the same reviewed zip that was attached to the GitHub pre-release. Use the listing copy and permission justifications prepared in the Chrome Web Store launch docs, and link to the GitHub-hosted privacy policy and support material.
