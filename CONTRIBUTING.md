# Contributing to Folio

Thank you for helping make Folio useful and dependable.

## Report a problem

Search existing issues first, then use the bug report template. Include your Windows and WebView2 versions, the Folio release, exact steps, and expected versus actual behavior. For PDF-specific problems, prefer a small synthetic or redacted document. Never post private PDFs, signatures, account information, or your Folio profile directory.

## Propose a change

For substantial changes, open an issue first so we can agree on scope. For a focused fix, fork the repository, create a branch, and open a pull request against `main`. Explain the user-visible problem, the solution, and how you checked it. Include screenshots when the interface changes.

Build with `./scripts/setup-toolchain.ps1` and `./build.ps1`; run `./scripts/check-native.ps1` and `./test.ps1`. The integration suite opens a Windows test window. If a test cannot run in your environment, say so in the PR rather than claiming it passed.

## Code and dependencies

- Follow the surrounding C++ and JavaScript style. Keep native file operations in the host and PDF editing in the viewer integration.
- Add meaningful regression coverage for changed behavior. Avoid tests that only repeat implementation details.
- Keep third-party assets separate. Updating PDF.js also requires checking Folio's viewer HTML and signature integrations against the new version.
- Preserve license notices. Record dependency versions and upstream sources in `THIRD_PARTY_NOTICES.md`.
- Keep generated builds, personal paths, PDFs used for private testing, credentials, and WebView2 profile data out of commits.

By submitting a contribution, you agree to license your original contribution under this project's MIT license. No contributor license agreement is required. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.
