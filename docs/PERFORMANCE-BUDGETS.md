# Performance verification and change boundaries

The application remains a single school application with two storage adapters. There is no measured need for microservices, Redis, framework replacement, a larger database plan or extra preview pages.

Proposed budgets, to be confirmed on a representative school phone and network: interactive route within 2 seconds after authentication; diary save/review within 2 seconds at p95 excluding network loss; single A4 diary export within 15 seconds; no unbounded image canvas. These are acceptance targets, not measured production claims.

Current safeguards: SQL filtering/count/paging for modern teacher submissions, consolidated groups and audit; bounded family-date lookup; indexed report lookups; asynchronous request password hashing; coalesced render requests; composed API cancellation/deadline signals; provider deadlines; early backup row-byte and attachment estimates; bounded PDF page rasterization and PNG/JPG canvas size; a single lazily loaded export bundle; and read-only setup diagnostics.

Record cold/warm route load, save and review latency with the same class fixtures, subject counts, homework length, fonts, device, browser and throttling. Record export elapsed time, resulting bytes and peak process/device memory. Compare p50 and p95 across at least 20 repeated operations. Do not include school passwords or private homework in telemetry. Monitor errors by operation ID without logging request bodies or authorization headers.

Future work is measurement-gated: lazy-load further page modules only when route profiles show a benefit; migrate campus settings to a relational table only when contention/scale warrants a verified additive backfill; use chunked/native operator archives when the bounded backup estimate requires it; and evaluate text-searchable PDFs only after proving Urdu shaping, text retention, layout and device parity. These optional alternatives must not replace approved behavior without a demonstrated need.
