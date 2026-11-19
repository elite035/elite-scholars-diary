# Selected diary exports

The shared selected-diary export action downloads one ZIP for PDF, PNG or JPG. Each rendered diary page is a separate file in the requested format. Individual diary exports and bulk printing retain their existing behavior.

ZIP entries use the diary's saved class, section and ISO date, for example `Grade_8_Section_B_2026-11-07.pdf`. Multi-page diaries receive `_Page_1`, `_Page_2`, etc. Duplicate names receive numeric suffixes rather than replacing entries. Names are sanitized before packaging.

The existing renderer, branding, one-page fit checks, approval checks, per-diary access restrictions and export permission are reused. All selected diaries must pass backend authorization. No database migration is required.

To bound browser memory, archives allow up to 200 rendered pages and 64 MiB of encoded content (the existing backend selection limit is 30 diaries). A rendering or size failure produces an error before downloading a partial archive. Android APK 1.0.4 adds ZIP support using the existing acknowledged file-save bridge; its ZIP limit is 19 MiB. Older APKs display an update/Chrome instruction rather than silently failing. Physical-device acceptance remains a release check.

Verification: `tests/bulk-archive.test.mjs`, the shared local/cloud school suite, direct-action/preview tests, and native-download tests cover naming, separate file bytes, independent PDF pages, duplicate names, size/layout failures, permissions, print and preview preservation. Browser acceptance on 12 November 2026 downloaded PDF, PNG and JPG ZIPs from two different-content diaries and independently verified both entries, their CRCs and file signatures. Each PDF member contains one page.

Overview monitoring remains on Overview in place of Today's Class Diaries. The standalone Class Diaries route and page remain available.
