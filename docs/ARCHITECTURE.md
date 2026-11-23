# Architecture

Folio is a Windows desktop application with a native host and a local web interface.

```text
Win32 window (folio.cpp)
  WebView2 controller
    https://folio.local -> bundled Assets directory
      PDF.js viewer + Folio shell and signature editing
    https://documents.folio.local/document/<opaque-id>/file.pdf
      native IStream -> user-selected PDF
```

## Native host

`folio.cpp` creates the window and STA COM environment, owns the WebView2 controller, routes messages, tracks recent files, and opens system file dialogs. Modal actions are posted to the Win32 message queue outside WebView2 event callbacks.

`native_support.hpp` contains small COM ownership/callback helpers, UTF-8/UTF-16 conversion, file helpers, and the read-only document `IStream`. The stream opens files with delete sharing so a saved PDF can atomically replace an open source file.

The viewer sends JSON messages through `chrome.webview`. Only messages from the local viewer origin are accepted. The host maps opaque document tokens to explicitly opened paths. Files are not exposed through arbitrary URL paths. Other viewer resource origins are rejected; HTTP, HTTPS, and mail links require confirmation before opening in another app.

Save operations use `saveStart`, base64 `saveChunk` messages, and `saveEnd`. The host writes a temporary file beside the destination, flushes it, then replaces the destination. Cancellation cleans up the temporary file. Recent-file and window preferences use an atomic temporary-file replacement as well.

## Viewer

`Assets/folio.js` connects the shell, document lifecycle, unsaved-change handling, forms, and save bridge. `Assets/folio-signatures.js` handles imported image processing, reusable templates, placement, and instance metadata. `Assets/folio-signature-inline.js` adds live per-instance controls, serialized preview updates, undo/redo integration, and save-time flushing. `Assets/folio.css` styles the shell and editing interface.

PDF.js is vendored under `Assets/pdfjs`. Folio's patched `viewer.html` loads the shell scripts and declares the local content security policy. The renderer, fonts, CMaps, and other upstream resources remain bundled for offline operation. Integration with editor internals is version-sensitive; dependency updates must run the signature tests.

## State and tests

Normal profiles live in `%LOCALAPPDATA%\Folio`. Self-tests use a separate profile below the report directory. `native_tests.hpp` orchestrates browser test modules, native saving, PDF reopening, and host checks; `test.ps1` launches that mode and checks its report. Test fixture PDFs are synthetic.

The release uses the Windows GUI subsystem and statically links the C++ runtime. WebView2 remains a separate, shared runtime dependency. There is no background service, document upload endpoint, or application updater.
