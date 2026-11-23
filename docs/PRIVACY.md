# Privacy and local data

Folio has no application account system, analytics SDK, or document-upload service. It reads PDFs from files you select and renders them locally in WebView2 using bundled PDF.js assets.

## Stored on your device

`%LOCALAPPDATA%\Folio` contains recent document paths and reading positions, window/theme preferences, and WebView2 user data. The signature library is stored in that WebView2 profile. Folio does not encrypt this data independently of Windows. Anyone with access to your Windows account or profile backups may be able to read it.

Saving writes a PDF to the location you choose and can include form values, annotations, and signature images. Check the saved PDF before sharing it. The app's portable ZIP contains the program and sample document, not your personal profile.

## Network access

Folio serves its interface from a virtual local origin and blocks external viewer resource requests. A document link can open in your default application after confirmation. WebView2 installation, runtime updates, and Microsoft's underlying runtime behavior are governed by Microsoft's policies; an installed runtime can perform its own maintenance outside Folio's document handling.

The project download page adds no analytics scripts or tracking cookies. GitHub and any hosting provider process downloads and page requests under their own policies.

## Reporting issues

Issue reports, screenshots, and attachments posted on GitHub may be public. Redact paths and personal information; prefer synthetic PDFs. Do not upload your signature library or Windows profile directory.
