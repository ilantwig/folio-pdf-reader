# Third-party notices

Folio's MIT license applies to its original code, not to third-party components. Their licenses and copyright notices remain in the distribution.

| Component | Version | Source | License / included notice |
| --- | --- | --- | --- |
| PDF.js | 6.5.438 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438) | Apache 2.0; `Assets/pdfjs/LICENSE` and per-resource notices |
| WebView2 SDK header and x64 loader | 1.0.4314.35 | [Microsoft.Web.WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35) | Microsoft; `ThirdPartyLicenses/WebView2-LICENSE.txt` and `WebView2-NOTICE.txt` |
| nlohmann JSON | 3.12.0 | [nlohmann/json](https://github.com/nlohmann/json/releases/tag/v3.12.0) | MIT; `ThirdPartyLicenses/nlohmann-json-LICENSE.txt` |
| LLVM native runtime | LLVM-MinGW 20261117 toolchain | [mstorsjo/llvm-mingw](https://github.com/mstorsjo/llvm-mingw/releases/tag/20261117) | Apache 2.0 with LLVM exceptions; `ThirdPartyLicenses/LLVM-LICENSE.txt` |
| MinGW-w64 runtime | From the pinned toolchain | [MinGW-w64](https://www.mingw-w64.org/) | `ThirdPartyLicenses/MinGW-w64-runtime-LICENSE.txt` |
| winpthreads runtime | From the pinned toolchain | [MinGW-w64](https://www.mingw-w64.org/) | `ThirdPartyLicenses/Winpthreads-LICENSE.txt` |

PDF.js bundles fonts, CMaps, color profiles, and WebAssembly resources with their own included notices. Preserve all of `Assets/pdfjs`, including license files, when redistributing. Folio customizes `Assets/pdfjs/web/viewer.html` to connect its local shell and styling; the upstream rendering modules are bundled separately from Folio's original scripts.

The Microsoft Edge WebView2 **Runtime** is installed separately and is not included in Folio's portable ZIP. Its installer and runtime are governed by Microsoft's terms.
