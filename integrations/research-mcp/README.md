# Lingbi research MCP integration

The application connects to five private services: LabMate, PubCrawl, PRISMA,
Giiisp paper search, and PaperCheck. Existing commercial SCI/OneKey services are
not changed. Private services reuse the installed SCI runtime and expose only a
curated tool allowlist; arbitrary commands and tool installation are unavailable.

## Deployment

Run `prepare_services.py` with the existing SCI Python virtual environment on the
server. Keep credentials in server-only files under the integrations directory,
mode 0600. Never copy them into this repository. The application systemd service
must load `research-mcp.env`; restart it after deploying the built application.
The helper generates separate localhost-only systemd services and workspaces.
Its private PRISMA adapter records manual decisions without claiming an AI review.
Do not replace the commercial services' environment or upstream runtime.

The Giiisp credential belongs in the server-only `giiisp.env` file as
`GIIISP_AUTH_TOKEN`. Application clients never receive this credential or the MCP
transport secret. Authentication and notebook ownership are checked before calls.
Workspace namespaces hash tenant, member and notebook IDs. Currently these MCP
workspaces are personal notebook workspaces; they do not represent shared team
review state. Catalog health and historical verification are distinct fields.

## User entry points

- Literature search: switch from multi-database search to Giiisp and select OA or
  an arXiv query mode. Results use the common relevance/year filtering and signed
  literature import pipeline. An empty or failed upstream response is not demo data.
- Product center: Research MCP opens a dialog for all five services. Execution is
  explicit. PRISMA keyword screening is preliminary; researchers must review
  inclusion/exclusion decisions. The flow diagram is not proof of PRISMA compliance.
- PaperCheck accepts DOCX, text-layer PDF and UTF-8 text. Scanned PDFs require OCR;
  conversion preserves the original hash and PDF page markers. Candidate title
  matching checks bibliographic metadata, not whether a cited claim is supported.

## Bounds and billing

Requests are stream bounded (100KB JSON, 7MB multipart). Citation files are capped
at 6MB; private uploads check 30 files/50MB per workspace before accepting a file.
PDF conversion is capped at 200 pages and 1M text characters. Service concurrency
is bounded globally and per service/workspace. Upstream timeouts are reported;
there is no silent model/provider substitution. Persistent upstream work may
continue after a client disconnect, so check progress before starting again.

No new research-point charge is enabled. Enforced commerce mode blocks unpriced
Giiisp calls and candidate audits until pricing/payment acceptance is complete.
Commercial SPI/OneKey live metering remains disabled for these private services.
These integration checks do not validate payment, cost acceptance, full-text
claim entailment, all 37 tool combinations, or end-to-end team collaboration.

## Verification recorded on 2026-10-13

Run Python checks using the SCI virtual environment; `verify_workflows.py` and
`verify_conversion.py` import `verify_live.py`, so keep the files together.

- Real initialize/tool listing for all five servers.
- LabMate 0.01 mol / 100 mL yields 0.1 M.
- PubCrawl returns real Europe PMC records for CRISPR.
- Giiisp arXiv ID 1706.03762 returns Attention Is All You Need.
- PRISMA real three-paper pipeline, reports and separate caller configuration.
- DOCX evidence extraction, real candidate audit, PDF/text extraction and blank
  PDF rejection with OCR guidance. Upstream candidate retrieval can be unavailable;
  this is shown as pending verification rather than a false citation verdict.
- Isolated application accounts: unauthorized calls, forbidden tools, foreign
  notebooks, notebook separation, actual DOCX upload/extraction, signed Giiisp
  results, year exclusion and successful import into an isolated notebook.
- Desktop and 390px browser checks: real calculation output, no dialog horizontal
  overflow, and embedded Giiisp search. Production Next build, TypeScript and
  changed-file ESLint passed.

LabMate, PubCrawl and PRISMA are small MIT-licensed upstream repositories. The
integration reuses installed sources rather than automatically upgrading them;
dependency/runtime upgrades require new protocol and behavior checks.
