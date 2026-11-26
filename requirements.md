# Submission Requirements Checklist: Multi-Document Intelligence Workbench

Target: a good-quality app built in **about 1–2 hours** (see `plan.md` §13). Tick every box before you share the repository.
Section numbers like "plan §7" point to `plan.md`. `plan-full.md` is the longer roadmap and is used for the README productionisation section.

---

## A. Before you start

- [ ] Node 22, pnpm 10, git, and `gh auth status` all work. Docker is not needed.
- [ ] Ollama is running, `qwen3.5:9b` is loaded, and the structured-output (`format`) smoke test returns valid JSON.
- [ ] The tesseract `eng` data is cached, and the heavy packages are pre-warmed (optional).
- [ ] The GitHub repo is created **first** (in the first 10 minutes), and screen and AI-tool records are shared if required.

## B. Mandatory technology

| ✓ | Requirement | Evidence |
|---|---|---|
| [ ] | React | `web/` (React 19 + Vite) |
| [ ] | Node.js | `server/` (Express 5) |
| [ ] | TypeScript on both sides | `tsconfig.base.json` with `strict: true`; `pnpm typecheck` passes |
| [ ] | Relational DB | SQLite (`better-sqlite3`), `server/src/db/schema.sql` |
| [ ] | Document / PDF / OCR library | `pdf-parse`, `tesseract.js`, `papaparse` |
| [ ] | LLM or mock | `server/src/llm/ollama.ts` and `mock.ts` |

## C. Functional requirements

| ✓ | Requirement | How to verify |
|---|---|---|
| [ ] | Upload multiple documents | Drop all of the samples at once |
| [ ] | ≥2 formats (we support PDF, PNG/JPG, CSV, TXT, MD) | Each sample is `ready` (the PNG shows method `ocr`) |
| [ ] | Content extracted per document | The evidence drawer shows page text, and cards show pages and method |
| [ ] | User-defined prompt | Free-text composer plus the 5 template chips |
| [ ] | Analysed independently | Per-document map stage and the "Per document" tab |
| [ ] | Analysed collectively | Compare and synthesise stages, with the Comparison, Discrepancies, and Overview tabs |
| [ ] | Comparison table | Matrix of attributes × documents with match / ≈ / mismatch / missing |
| [ ] | Consolidated summary | Overview tab |
| [ ] | Discrepancies list | Discrepancies tab (severity, rule, verdict) |
| [ ] | Missing-information report | Missing info tab |
| [ ] | Key-value extraction | Key values tab |
| [ ] | Source shown for every finding | Evidence chips `D2 · p1 · E7 ✓`; clicking one opens the drawer with the quote highlighted |
| [ ] | Copy output | Copy as Markdown or JSON (per tab and for everything) and paste into an editor |
| [ ] | Invalid files handled gracefully | Each `samples/invalid/*` file shows its specific reason, the rest of the batch still succeeds, and nothing crashes |
| [ ] | Synthetic data only | `scripts/generate-samples.ts` and `samples/README.md` |

**Golden findings detected** (`samples/expected.json`):
- [ ] Jonathan A. Smith vs Jonathon Smith (`name.spelling_variant`)
- [ ] 14 vs 41 Harbour Road (`address.house_number`)
- [ ] LIC-48213 vs LIC-48231 (`identifier.transposition`)
- [ ] £1,250,000 vs £1.18m / 1,180,000 (letter ≈ CSV, both ≠ form)
- [ ] Licence expired 31/03/2026 (`date.expired`)
- [ ] Missing signature and signature date
- [ ] Postcode BS1 4QA vs BS1 4QB (`address.postcode`)
- [ ] "Northwind Fabrications Limited" ≈ "Northwind Fabrication Ltd" (equivalent, not a discrepancy)
- [ ] The injection letter raises a warning and the results are unaffected

**The 5 example instructions all complete** (mock always; Ollama for at least 2):
- [ ] Compare across all documents
- [ ] Inconsistencies between the form and supporting docs
- [ ] Key dates, obligations, financial values, missing info
- [ ] Financial position of the companies
- [ ] Discrepancies in names, addresses, licences, revenue

## D. Engineering expectations

| ✓ | Expectation | Where |
|---|---|---|
| [ ] | Strong TypeScript | `strict`, zod schemas with `z.infer` in `shared/`, typed stage outputs, no `any` |
| [ ] | Frontend/backend separation | `web/` and `server/` share only `shared/`, over a REST boundary |
| [ ] | Modular processing pipeline | `ingestion/{guard, extractors/*, chunker, facts}` and `analysis/{plan, map, verify, compare, synthesise, assemble}` |
| [ ] | Structured AI output | Ollama `format` JSON schema, zod validation, repair retry, deterministic fallback |
| [ ] | Provenance preserved | Aliases, chunk refs, verified quotes, evidence handles; synthesis cites handles only; ≥1 evidence item per finding |
| [ ] | Input and file validation | zod everywhere; allowlist, magic bytes, limits, UTF-8 checks |
| [ ] | Secure file handling | UUID storage, mode `0600`, sanitised names, rejected bytes never stored, delete removes the file |
| [ ] | Error handling | Central middleware, per-file isolation, `failed` analysis with a reason, Ollama-offline 503 and banner |
| [ ] | Large documents | Caps, page-bounded chunks, windowed per-document map, compact synthesis input, cache |
| [ ] | Facts vs AI interpretation | Tiers `extracted` / `derived` / `interpretation`, set by code, with badges and a legend in the UI |
| [ ] | No single merged prompt | One map call per document; synthesis gets structured, alias-labelled data, never raw text |

## E. Tests

- [ ] `normalize.test.ts`, `compare.test.ts`, `verify.test.ts` (pure pipeline logic)
- [ ] `guard.test.ts` (file validation)
- [ ] `api.test.ts` (end-to-end with the mock: golden findings and 100% valid evidence)
- [ ] `pnpm test` passes offline, with no Ollama needed

## F. Repository deliverables

- [ ] Complete source pushed, `git status` clean
- [ ] Setup instructions in the README
- [ ] `.env.example` (plan §14); no real `.env` committed
- [ ] `samples/` (valid, invalid, `expected.json`, README) plus the generator script
- [ ] `server/src/db/schema.sql` (applied automatically at boot)
- [ ] At least one meaningful automated test, passing
- [ ] Clear commit history, one commit per phase (plan §13), Conventional Commits
- [ ] `.gitignore` covers `node_modules`, `.env`, `var/`, and `dist/`
- [ ] No real data, no secrets

## G. README sections

- [ ] Overview, with a screenshot
- [ ] Architecture (diagram plus the plan → map → verify → compare → synthesise pipeline, and how provenance is guaranteed)
- [ ] Setup (`pnpm i`, `cp .env.example .env`, `ollama pull`, `pnpm samples`, `pnpm dev`, `pnpm test`, mock mode)
- [ ] Assumptions
- [ ] Completed functionality
- [ ] Known limitations (including every item cut from plan §1 and §13)
- [ ] Security considerations
- [ ] How it would be productionised (from `plan-full.md`)
- [ ] AI tools disclosure and the decisions you made personally (§H)

## H. Disclosure

- [ ] **Tools**: Claude Code (Claude Opus 5.5) for planning and implementation; runtime Ollama `qwen3.5:9b`; any others actually used.
- [ ] **How they were used**: phase-by-phase prompting, with every diff reviewed, run, and committed by you.
- [ ] **Decisions made personally.** Keep only the true ones and add your own:
  - [ ] Evidence-handle-only citations
  - [ ] Three-tier findings
  - [ ] Deterministic compare before LLM synthesis
  - [ ] Templates for the plan, plus an LLM plan for custom instructions
  - [ ] SQLite for zero setup, with Postgres as the production path
  - [ ] Mock provider for offline tests
  - [ ] Deviations from `plan.md`
- [ ] Optionally commit `plan.md` and `requirements.md` under `docs/prep/`, labelled as AI-assisted planning.

## I. Final check (last 5 minutes)

- [ ] Clean clone → `pnpm i` → `cp .env.example .env` → `pnpm test` passes → `pnpm dev` runs
- [ ] Upload the valid and invalid samples: statuses and reasons are correct
- [ ] Run a template with Ollama: findings show evidence chips, and the drawer highlights the quote
- [ ] Copy works as both Markdown and JSON
- [ ] Stop Ollama: you get a clear offline message, not a crash
- [ ] `git log --oneline` is readable, and the final push is done and the link shared
