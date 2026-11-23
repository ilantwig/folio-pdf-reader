FOLIO 2.0 - NATIVE WIN32 EDITION (Windows x64)
===========================================

RUN / SHARE FOLIO
1. Send Folio-Win32-2.0-x64.zip to your friend.
2. They should right-click the ZIP and choose Extract All.
3. Open the extracted folder and double-click Folio.exe.
Keep the Assets folder and WebView2Loader.dll beside Folio.exe.
There is no installer and no .NET runtime to install.

Requirements: Windows 10 version 1607 or later / Windows 11, x64,
and Microsoft Edge WebView2 Runtime 145 or newer. If it is missing or too old, Folio
offers to open Microsoft's download page:
https://developer.microsoft.com/microsoft-edge/webview2/
Choose the Evergreen Standalone Installer for x64 if needed.

This build is not code-signed, so Windows may show an unknown
publisher notice. The ZIP includes app files and the bundled sample only;
it does not include your personal PDFs, saved signatures, or reading history.

WHAT IS NATIVE
Folio.exe is compiled C++ using the Win32 API. Window management, file
dialogs, preferences, document streaming, and PDF file writes run in the
native process. The local PDF.js interface and PDF renderer run inside
WebView2. This is a native Windows host with a web-based viewer UI.
It is not a .NET application and does not contain WinForms, WPF, or a CLR.
The C++ runtime is statically linked; no separate VC++ runtime is needed.

READING AND SIGNATURES
Open PDFs from the library, by dropping a file on the reader, or by passing
a PDF path on the command line. Search, select/copy text, use bookmarks and
thumbnails, rotate, zoom, fill forms, annotate, print, and save a PDF copy.
Password-protected PDFs prompt for the document password.

Use the signature tool to import an image. Place it, drag it, and resize it.
Selecting a placed signature shows its inline Color and Thickness controls.
Changes apply to that instance; other placed signatures keep their styles.
Use the signature library for reusable templates and additional settings.
Save a PDF copy to embed forms, annotations, and signatures in the PDF.
An image signature is a visual mark, not a certificate-based digital signature.

YOUR DATA
Folio works locally. Viewer assets are bundled and external viewer network
requests are blocked. Opening a document link in another app asks first.
Preferences, recents, and the WebView2 signature library live in:
%LOCALAPPDATA%\Folio
The native edition reuses the previous Folio profile when upgrading.
Your friend's copy starts with their own empty profile.
Save and close an older Folio window before switching to the native edition.

BUILD FROM SOURCE
The source package contains C++ source, viewer assets, the WebView2 SDK
header/loader, JSON header, test fixtures, and licenses. No .NET tools are used.

Use LLVM-MinGW's Windows x64 UCRT toolchain. The tested version is 20261117:
https://github.com/mstorsjo/llvm-mingw/releases/tag/20261117
Archive: llvm-mingw-20261117-ucrt-x86_64.zip
SHA-256: 4d002e330a0f703625aa5ccbc37e96f8f824413e163bfc7336774aabd2c3a412

In PowerShell, from the source directory:
  .\build.ps1 -Toolchain 'C:\path\to\llvm-mingw\bin'
Output: dist\Folio-Win32-2.0-x64

Run the integration suite (opens and closes a separate test window):
  .\test.ps1 -Executable '.\dist\Folio-Win32-2.0-x64\Folio.exe'
The suite uses an isolated profile and produces a JSON report and previews.
It covers reading, forms, annotations, inline signature color/thickness,
undo/redo, cancellation, native save/reopen, encryption, malformed files,
recents, native window creation, and absence of the CLR.

THIRD-PARTY COMPONENTS
PDF.js 6.5.438 (Apache 2.0), WebView2 SDK 1.0.4314.35 (Microsoft),
nlohmann JSON 3.12.0 (MIT), LLVM runtimes (Apache 2.0 with LLVM exceptions),
and MinGW-w64 native runtime. See the included license files.
