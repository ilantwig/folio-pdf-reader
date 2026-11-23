# Development

## Toolchain

Use Windows x64 and PowerShell. `scripts/setup-toolchain.ps1` downloads LLVM-MinGW **20261117**, the Windows x64 UCRT toolchain, and checks SHA-256:

```text
4d002e330a0f703625aa5ccbc37e96f8f824413e163bfc7336774aabd2c3a412
```

The upstream archive is `llvm-mingw-20261117-ucrt-x86_64.zip` from [the upstream release](https://github.com/mstorsjo/llvm-mingw/releases/tag/20261117). It is extracted under ignored `.tools/`. The compiler and resource compiler are invoked directly; CMake, npm, Visual Studio, and .NET SDKs are not required.

```powershell
.\scripts\setup-toolchain.ps1
.\build.ps1
.\scripts\check-native.ps1
.\test.ps1
```

`build.ps1 -Toolchain 'C:\tools\llvm-mingw\bin'` uses an existing installation. The default output is `dist/Folio-Win32-2.0-x64`. To build elsewhere, pass `-Destination`.

## Layout

| Path | Purpose |
| --- | --- |
| `folio.cpp` | Native window, WebView2 lifecycle, bridge, file dialogs, save, preferences |
| `native_support.hpp` | COM and file-stream support |
| `native_tests.hpp` | Native integration orchestration |
| `Assets/folio*.js`, `folio.css` | Local shell and signature features |
| `Assets/*tests.js`, `test-fixtures/` | Synthetic browser/native tests |
| `Assets/pdfjs/` | Vendored PDF.js distribution and patched viewer HTML |
| `vendor/` | WebView2 SDK header/loader and JSON header |
| `ThirdPartyLicenses/` | Redistributed dependency licenses |
| `docs/` | Project docs and static download-page source |

## Validation

`test.ps1` opens a test window and writes a JSON report and PNG previews into a unique `test-results` directory. It uses its own WebView2 profile and never the normal user profile. Full tests require a Windows desktop session and WebView2. Do not run against a production document or claim the GUI tests ran on a headless environment where they could not start.

`scripts/check-native.ps1` inspects the built PE header for x64, Windows GUI subsystem, and absence of a CLR header. It also checks the portable bundle for the required viewer, loader, and license files.

## Release

Run `./scripts/package-release.ps1` after a successful build and test. This produces the portable ZIP and `SHA256SUMS.txt` under `artifacts/`. The GitHub workflow performs the same checks on pushes and pull requests. Publishing a GitHub release triggers a fresh build and test run; only a passing run attaches its ZIP and checksums to that release. The release workflow requires the tag version to match the application version. Wait for the release workflow to finish before sharing the download link.

Update the resource version, `VERSION` constant, default distribution name, viewer cache keys/footer, README, packaging script, and changelog together when bumping the app version.

Keep the PDF.js resource tree intact when packaging. Do not commit generated executables, user preferences, WebView2 profile data, private samples, or test output. The static download page links to GitHub release assets; it can be hosted from `main:/docs` with GitHub Pages.
