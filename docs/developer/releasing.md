# Releasing

This guide describes the intended public beta release workflow for `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`. Public beta releases should be published as GitHub pre-releases before the same reviewed artifact is uploaded manually to the Chrome Web Store.

## Release Invariants

- Keep `package.json`, `package-lock.json`, `manifest.json`, Git tag, release zip name, release checksum, and changelog aligned on the same version.
- Publish from a curated fresh public history, not this local repository's existing private history.
- Keep `.private-docs/`, `docs/issues/`, local fixtures, generated corpora, and raw build outputs out of the public initial commit.
- Keep the Chrome Web Store upload manual for the first public beta.
- Do not publish source maps in the official extension package.
- Include `LICENSE`, `NOTICE`, `TERMS.md`, and `THIRD_PARTY_NOTICES.md` in every official release package.
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

For each public beta, align:

- `package.json`
- `package-lock.json`
- `manifest.json`
- `CHANGELOG.md`
- release zip name
- Git tag `v<version>`
- GitHub Release title

To set the release version:

```bash
npm run version:set -- <version>
```

Before packaging, verify aligned release metadata:

```bash
npm run version:check
```

After creating the final release tag, require the expected Git tag as part of the final check:

```bash
npm run version:check -- --require-tag
```

The version check validates `package.json`, `package-lock.json`, `manifest.json`, the `CHANGELOG.md` release heading, release archive/checksum naming when files exist under `release/`, and the expected Git tag `v<version>` when `--require-tag` is passed. Without an explicit version argument, it uses the version from `package.json`.

## Validate

Model-free CI checks:

```bash
npm run validate:ci
```

This path is safe for pull requests and local pre-release checks. It runs Jest, Svelte checks, version alignment, Chrome permission checks, the privacy-boundary scan, Rust tests, and a model-free extension build. It does not download, prepare, or require large model assets. The current tree does not have a healthy ESLint setup, so lint is not part of this path yet.

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

## Legal And License Review

Before publishing a release, confirm the Apache-2.0 redistribution duties:

- `LICENSE`, `NOTICE`, `TERMS.md`, and `THIRD_PARTY_NOTICES.md` are present in the repository and in the package dry-run output.
- Webpack-generated `*.LICENSE.txt` sidecar files for bundled third-party code remain in `dist/` and are not excluded from the release ZIP.
- Existing copyright, patent, trademark, and attribution notices in third-party source or assets remain intact.
- If a third-party source file is modified and redistributed, that file carries a prominent change notice naming Privacy Guardrail/DFKI as the modifier and describing that the file was changed.
- Any upstream third-party `NOTICE` file for redistributed code or model assets is carried forward readably, either as a `NOTICE` file, source/documentation notice, or customary generated display.
- The supplementary Terms of Use still match the intended release train and the distribution remains unentgeltlich; paid or project-specific distribution needs a fresh legal review.

## Package

After release-strict validation and manual smoke testing are green, create the official Chrome extension package:

```bash
npm run package:release
```

The command:

- requires a clean Git worktree before building
- verifies release metadata with `version:check`
- requires prepared BardsAI model assets and ONNX Runtime Web assets
- runs the WASM release build and the extension build with `NER_MODEL_ASSETS_REQUIRED=1`
- zips only runtime files from `dist/`
- requires the legal files `LICENSE`, `NOTICE`, `TERMS.md`, and `THIRD_PARTY_NOTICES.md`
- excludes source maps and private/source-only/generated-local paths
- writes `release/privacy-guardrail-<version>.zip`
- writes `release/privacy-guardrail-<version>.sha256` for the exact zip

For local package-content checks against an existing `dist/` tree without the clean-worktree guard or build step, run:

```bash
npm run package:dry-run
```

The dry run is not a release artifact. It exists to verify include/exclude behavior while local changes are still in progress.

## GitHub Pre-Release

For the public beta:

1. Create the fresh public initial commit from the curated tree.
2. Push to `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.
3. Tag the release version, for example `v0.3.1`.
4. Create a GitHub Release marked as a pre-release.
5. Attach the exact Chrome extension zip and checksum.
6. Link the release notes to `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md`, and support docs.

## Chrome Web Store Handoff

Chrome Web Store upload is manual for the first public beta. Upload the same reviewed zip that was attached to the GitHub pre-release. Use the listing copy and permission justifications prepared in the Chrome Web Store launch docs, and link to the GitHub-hosted privacy policy and support material.
