# Security policy

## Supported code

Security fixes target the current `main` branch and the latest 2.x release. Older .NET prototypes are not part of this repository and are not maintained here. This is a community project with no guaranteed response time or security-audit claim.

## Report privately

Please do not open a public issue containing an exploit, confidential PDF, signature, credential, or personal profile data. Use **Security > Advisories > Report a vulnerability** if private reporting is enabled for this repository. If it is unavailable, open a minimal issue asking for a private reporting channel without disclosing the vulnerability itself.

Include the affected release, Windows and WebView2 versions, impact, reproduction steps, and a minimal synthetic sample. Avoid real personal documents.

## Scope and assumptions

Folio handles potentially untrusted PDF and image data through PDF.js and WebView2. It restricts the native message bridge to its local viewer origin, serves documents through opaque IDs, blocks external viewer resources, and confirms external links. These measures do not make it a hardened document sandbox. Keep Windows and WebView2 updated.

Saved signature images and recent paths are stored in your Windows user profile; Folio does not provide its own encryption or vault. A visual image signature does not cryptographically authenticate a document. Release binaries are currently unsigned.
