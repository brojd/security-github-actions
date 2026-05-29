# Comparison: `supply-chain` vs `ai-kit` `security-hardening` skill

> **Cross-reference**
> - This tool: `grafana/security-github-actions/supply-chain` (this repo, final state after PR1 + PR2 + PR3)
> - The other tool: [`grafana/ai-kit#585`](https://github.com/grafana/ai-kit/pull/585) — `security-hardening` skill under `plugins/grafana-engineering/skills/`, authored by @zeitlinger
> - Read alongside: the ai-kit [`references/design.md`](https://github.com/grafana/ai-kit/blob/codex/security-hardening-skill/plugins/grafana-engineering/skills/security-hardening/references/design.md) is the authoritative design doc for that project.

Both tools react to the same Security Hardening Week pressure and land in the same problem space — making Grafana repositories safer against supply-chain compromise. They make almost-opposite architectural choices, so this doc compares them dimension-by-dimension and then identifies where they can reinforce rather than overlap.

## TL;DR

|  | `supply-chain` (this repo) | `ai-kit / security-hardening` |
|---|---|---|
| Primary surface | **Org-required GitHub Actions workflow** referenced by a Ruleset | **Claude Code skill** + Python CLI run per-repo by humans/agents |
| Enforcement | Critical findings **block merge**; advisory findings nudge via sticky PR comment | Review/report only by default; `package-management` has safe-fix autofix |
| Coverage breadth | Narrow (~14 checks): Node.js + Go supply-chain hardening | Wide (~13 modules): supply-chain **plus** cloud creds, container publishing, artifact provenance, dependency reduction, shared-workflows inventory |
| Output to humans | Sticky PR comment + Step Summary + HTML report (local) | JSONL (canonical) + TSV for Google Sheets + `summary.md` |
| Fix model | None in CI; agent-driven fixes via `mitigate-supply-chain` skill (local) | Deterministic safe-fix CLI (`fix --safe-only`); only `package-management` shipped |
| Scale model | Every PR in every repo runs the check (Ruleset broadcast) | Per-team self-service today; **fleet scan via GitHub tree-fetch on the roadmap (P3)** |
| Tech stack | TypeScript on Node ≥ 24.5, zero runtime deps (`--experimental-strip-types`) | Python 3, zero third-party deps |
| Suppressions | `.github/supply-chain.yml` in target repo, auditable in git | None today (state derivation across reruns is on the roadmap) |
| Maturity | POC PR (#182) being split into PR1/PR2/PR3 | Prototype PR with canaries; only `package-management` has merged safe-fix PRs |

The clearest way to summarise: **`supply-chain` is an enforcement engine, `ai-kit/security-hardening` is a visibility engine.** They overlap heavily on what they *can* see, but they answer different questions. The first asks "did this PR introduce a regression?" — the second asks "how is the fleet doing right now and where should we focus this week?"

## What `ai-kit / security-hardening` does

A Claude Code skill registered as `grafana-engineering/security-hardening`. A bundled Python harness (`security_hardening.py`) exposes a few commands:

- `detect` — emits canonical JSONL findings + a derived TSV for Google Sheets review.
- `repo` — wraps `detect` + summary generation + a `safe-fixes.patch` dry-run for one-step team self-service.
- `doctor` — preflight (Python, repo path, git, output dir, optional GitHub auth).
- `export-tsv` — flatten an existing JSONL.
- `fix --safe-only [--dry-run | --apply]` — deterministic, idempotent patches; only `package-management` is currently wired through.

Findings live in one canonical JSONL per scan run. Every row carries `record_type`, `module_id`, `module_version`, and (for findings) `check_id` and a stable `fingerprint` so reruns can derive state (`new`, `open`, `fixed`, `stale`, `suppressed`, `not-scanned`).

Modules shipped today:

| Module | Purpose |
|---|---|
| `package-management` | npm/yarn/pnpm hardening — the only autofix-enabled module |
| `renovate-dependabot` | dependency update policy coverage |
| `publishing` | npm publishing provenance/OIDC / long-lived token signals |
| `cache-security` | GitHub Actions cache key/restore-key risks |
| `go-modules` | Go `replace` directives, pseudo-versions, risky replacement sources |
| `github-actions` | workflow hardening complementary to zizmor |
| `github-actions-inventory` | third-party / deprecated / replaceable actions, `grafana/shared-workflows` adoption candidates |
| `static-cloud-credentials` | AWS/GCP/GAR static credential patterns + OIDC migration cues |
| `container-publishing` | DockerHub tokens, legacy GCR, raw `docker push`, GAR separation |
| `artifact-provenance` | missing image attestations / signing / provenance |
| `version-pinning` | `package.json` ranges and wildcards |
| `package-manager-migration` | npm-to-pnpm migration candidates |
| `dependency-reduction` | large dep surfaces; likely dev-only tooling in runtime deps |

The roadmap (P0–P7) extends to a central GitHub tree-fetch fleet scanner, GitHub org/API inventory modules (`github-access`, `github-protections`, `github-apps`, `repo-hygiene`), a local **workstation** checker mode, platform-backed inventories (Vault `ci/common`, GATB scope, private npm registry), and audit-log/secure-design review integration.

## What `supply-chain` does (full set after PR3)

A path-stable GitHub Actions workflow (`.github/workflows/supply-chain.yaml`) referenced by an organization Ruleset. The workflow runs three real jobs (`static` + `audit` + `report`) gated by a cheap `detect` activation gate. The CLI driving all three jobs (`supply-chain/src/check.ts`) is also runnable locally via `npm run check` or through the `mitigate-supply-chain` skill.

Checks shipped across the three PRs:

| Check | Severity | Ecosystem | Where it runs |
|---|---|---|---|
| `packagemanager-pinned` | critical | js | static |
| `lockfile-committed` | critical | js | static |
| `lockfile-conflict` | critical | js | static |
| `npmrc-correct` | critical | js | static |
| `pnpm-workspace-correct` | critical | js | static |
| `yarnrc-correct` | critical | js | static |
| `install-not-ci` | advisory | js | static |
| `npx-confusion` | advisory | js | static |
| `oidc-publishing` | advisory | js | static |
| `cache-poisoning-publish` | advisory | js | static |
| `registry-audit` | advisory | js | audit |
| `gosum-committed` | critical | go | static |
| `go-toolchain-pinned` | critical | go | static |
| `govulncheck-clean` | advisory | go | audit |

A failing critical check exits the `static` job non-zero, which fails the workflow, which the org Ruleset converts into a merge block. The `report` job downloads both JSON payloads, renders one unified markdown body, and updates the sticky PR comment (`<!-- supply-chain-report-v1 -->`). Suppressions live in the target repo at `.github/supply-chain.yml` and are audited via git history.

## Dimension-by-dimension comparison

### 1. Deployment / activation model

| | `supply-chain` | `ai-kit/security-hardening` |
|---|---|---|
| Primary trigger | Every push / PR / merge group on every repo in the org (Ruleset) | A human or agent running the skill against `--repo .` |
| Per-repo opt-in cost | Zero (Ruleset broadcasts) | Non-zero (each team runs the skill; centralised fleet mode is P3) |
| Activation gate | Cheap `detect` job that early-exits non-Node repos | Skill is only invoked when invoked |

`supply-chain` trades initial setup (the Ruleset, the workflow's bootstrap shape) for **zero per-team adoption cost**. `ai-kit` is the opposite: nothing changes for teams unless they actively run it, but each team can run it without coordination.

### 2. Enforcement strength

This is the biggest single difference. `supply-chain`'s critical checks **fail the GitHub workflow**, which the Ruleset converts into a hard merge block. `ai-kit/security-hardening` produces JSONL/TSV; nothing is blocked downstream. Even `package-management` autofix is opt-in via canary PRs created by the skill's author.

The implication: any check `supply-chain` ships as critical needs a much higher false-positive bar. That's why its "advisory" set (heuristic checks like `install-not-ci`, `npx-confusion`, `oidc-publishing`) deliberately doesn't block, and why suppressions are first-class. `ai-kit` can afford to be noisier because nothing it surfaces blocks merge by default.

### 3. Output for humans

| Surface | `supply-chain` | `ai-kit` |
|---|---|---|
| Sticky PR comment | ✅ auto-updates per push | ❌ |
| GitHub Step Summary | ✅ same body | ❌ |
| Local HTML report (auto-open) | ✅ | ❌ |
| ANSI-coloured terminal text | ✅ | ✅ (status output to stderr) |
| Canonical JSONL for aggregation | ✅ (CI artifact, per job) | ✅ (canonical) |
| Google-Sheets-friendly TSV | ❌ | ✅ |
| `summary.md` for issue attachment | ❌ | ✅ |
| `safe-fixes.patch` dry-run | ❌ | ✅ |

`supply-chain` optimises for **the PR reviewer's eyeballs in this exact PR**: rendered markdown + collapsed sections + per-check doc links. `ai-kit` optimises for **fleet triage in a Google Sheet**: flat TSV rows, stable fingerprints across reruns, observation rows that prove which modules actually ran.

### 4. Fix model

`ai-kit` has a deterministic, idempotent fix path (`fix --safe-only`) and proves it with merged canary PRs. The boundary is explicit in the design doc: only mechanical edits to `.npmrc` / `.yarnrc.yml` / `pnpm-workspace.yaml` / `package.json`'s `packageManager` field, gated on an approved-target npm version. `--from-jsonl` + `--finding <fingerprint>` lets you replay a reviewed report.

`supply-chain` has no fixer in CI by design. The agent-driven `mitigate-supply-chain` skill applies fixes interactively against a target repo (asking the human for judgement on lockfile-conflict, npx-confusion, oidc-publishing). The per-check `docs/checks/js/<id>.md` is the canonical fix recipe; the JSON `fix:` field is just the one-liner.

### 5. Coverage breadth

`ai-kit` is broader by intent — the design's "Security Hardening Week guidance mapping" table aims to cover the whole guide, including non-supply-chain concerns (cloud creds, container publishing, artifact provenance, GitHub access / protections / apps). `supply-chain` deliberately scopes to the Node.js + Go supply-chain subset of the same guide and treats everything else as out-of-scope (those belong to zizmor / GATB / repo-hygiene tooling).

### 6. Coverage where both overlap

| Concern | `supply-chain` | `ai-kit` |
|---|---|---|
| `.npmrc` keys (`ignore-scripts`, `allow-git`, `min-release-age`) | `npmrc-correct` (critical, hard-blocks) | `package-management` (safe-fix when npm pin is approved) |
| `.yarnrc.yml` (`enableScripts: false`, `enableImmutableInstalls`, `npmMinimalAgeGate`, forbidden `approvedGitRepositories`) | `yarnrc-correct` (critical, includes forbidden-key rule) | `package-management` (covers `enableScripts: false`, `npmMinimalAgeGate: 4320`) |
| `pnpm-workspace.yaml` (`minimumReleaseAge`, `strictDepBuilds`, `blockExoticSubdeps`) | `pnpm-workspace-correct` (critical) | `package-management` (covers `minimumReleaseAge`, `strictDepBuilds`, also tracks `dangerouslyAllowAllBuilds`) |
| `packageManager:` pinned + at minimum version | `packagemanager-pinned` (critical; minimum version) | `package-management` (exact pin to approved-target version) |
| Lockfile committed | `lockfile-committed` (critical) | implicit via `package-management` (npm `save-exact=true`) |
| npm publishing OIDC | `oidc-publishing` (advisory) | `publishing` (review-only signal) |
| Cache poisoning in publishing workflows | `cache-poisoning-publish` (advisory) | `cache-security` (review-only signal) |
| `npm audit` advisories | `registry-audit` (advisory, in `audit` job) | not covered directly |
| `npx <name>` confusion | `npx-confusion` (advisory) | not covered |
| `install` not strict (`npm ci`, `--immutable`, `--frozen-lockfile`) | `install-not-ci` (advisory) | not covered |
| GitHub Actions hardening | small surface (`cache-poisoning-publish`) | `github-actions` (broader; complementary to zizmor) |
| Go `go.sum` committed | `gosum-committed` (critical) | not covered directly (`go-modules` covers a different angle) |
| Go toolchain pinned | `go-toolchain-pinned` (critical) | not covered |
| Go vulnerability scan | `govulncheck-clean` (advisory, call-reachable only) | not covered |
| Go `replace` / pseudo-versions | not covered | `go-modules` (signal) |
| Renovate / Dependabot policy coverage | not covered | `renovate-dependabot` (signal) |
| Static cloud credentials (AWS/GCP/GAR) | not covered | `static-cloud-credentials` (canary signal) |
| Container publishing (DockerHub token, legacy GCR, raw `docker push`) | not covered | `container-publishing` (canary signal) |
| Artifact provenance / image attestations / signing | not covered | `artifact-provenance` (canary signal) |
| `package.json` version-pinning (ranges/wildcards) | not covered | `version-pinning` (report-only) |
| Dependency reduction | not covered | `dependency-reduction` (review-only inventory) |
| npm → pnpm migration suggestion | not covered | `package-manager-migration` (review-only) |
| Shared-workflows adoption candidates | not covered | `github-actions-inventory` |

In overlap zones, the **rules of the road differ**: `supply-chain`'s `npmrc-correct` insists on `min-release-age=3` regardless of npm version, while `ai-kit`'s `package-management` will only add it once the package root pins an approved-target npm version (avoiding the case where an old npm silently ignores the key). `ai-kit`'s nuance here — *"do not add `allow-git` or `min-release-age` by themselves to repositories where the npm version is old or unknown"* — is a real correctness improvement worth folding into `supply-chain` (see Complementarity below).

### 7. Scale + state model

`supply-chain` has no notion of "state across runs" — each PR run is a snapshot, and the sticky comment is overwritten on every push. That's appropriate because the workflow runs continuously on every PR; nobody needs to "rerun" it.

`ai-kit` is designed for periodic fleet sweeps. JSONL fingerprints across runs give it `new` / `open` / `fixed` / `stale` / `not-scanned` derivation, observation rows distinguish "module ran and found nothing" from "module skipped", and rerun targeting by module/owner/team is on the P3 roadmap. The P0–P7 roadmap is fundamentally a fleet-observation-and-rollout plan, not a per-PR enforcement plan.

### 8. Suppression / exception handling

| | `supply-chain` | `ai-kit` |
|---|---|---|
| Per-check exception file | `.github/supply-chain.yml` in target repo; auditable in git history | Implicit via fingerprint state ("suppressed" is a derivable state, not a primary input today) |
| Expiry | Optional ISO `expires:` per entry; past expiry → suppression ignored | N/A |
| What appears in the report | Suppressed findings render in a "Suppressed" section (never silent) | Observations track the suppression state |

`supply-chain`'s suppressions are forced into the open: every suppressed finding is still visible in the comment. `ai-kit` hasn't needed a suppression file yet because its findings are themselves advisory.

## Gaps

### Things `ai-kit` covers that `supply-chain` doesn't

These are good candidates to either (a) port into `supply-chain` as **advisory** checks once a team agrees the false-positive rate is acceptable, or (b) leave as `ai-kit`'s territory:

1. **Static cloud credentials** (AWS/GCP/GAR) — would only ever be advisory in supply-chain; arguably outside its supply-chain scope.
2. **Container publishing patterns** (DockerHub tokens, legacy GCR, raw `docker push`) — same.
3. **Artifact provenance / image attestations** — same; could become an advisory check on publishing workflows.
4. **Renovate/Dependabot policy coverage** — small, deterministic, fits naturally as an advisory check.
5. **Version-pinning** of dependencies — overlaps conceptually with `min-release-age` but at the manifest level rather than the registry level.
6. **Package-manager migration** (npm → pnpm) — explicitly a judgement call; better as a skill recommendation than an org-required signal.
7. **Dependency-reduction** inventory — same.
8. **Shared-workflows adoption inventory** — squarely an `ai-kit` concern; not a supply-chain risk per se.
9. **Future: workstation checker** — `ai-kit`'s P5; `supply-chain` has no client-side component.
10. **Future: GitHub org/API inventory** — `ai-kit`'s P4; `supply-chain` is repo-tree-only.

### Things `supply-chain` covers that `ai-kit` doesn't

1. **Hard merge-blocking enforcement** via workflow + Ruleset. `ai-kit` is review-only by design; nothing it surfaces fails a PR.
2. **Per-PR sticky comment + Step Summary** that updates automatically. Teams don't need to *do* anything to see findings.
3. **Workspace-aware walk** (`npm`/`yarn` `workspaces`, `pnpm-workspace.yaml`, `go.work`) — `supply-chain` discovers roots vs. members. `ai-kit`'s `component_path` is closer to per-package-root identity than to workspace classification.
4. **Suppressions as an in-repo first-class concern** with optional expiry and auditable git history.
5. **HTML report renderer** with auto-open and `prefers-color-scheme` — purely a local DX win.
6. **`govulncheck` call-reachable Go vulnerability scan** — much less noisy than graph-level scanning. `ai-kit`'s `go-modules` is a different angle (replace directives + pseudo-versions).
7. **`registry-audit`** running `npm/pnpm/yarn audit` directly — `ai-kit` doesn't shell out to package managers.
8. **`lockfile-conflict`** — detects half-finished migrations (two lockfiles in one root).
9. **`npx-confusion`** + **`install-not-ci`** — heuristic checks specifically catching the npx name-confusion and "no `--immutable` / `npm ci`" attack vectors.

### Things neither covers yet

- Linux dev-machine `npm`/`pnpm` config drift (ai-kit roadmaps it as P5).
- Renovate/Dependabot **action** posture — they cover *coverage* (does the repo have one?), not *configuration* (is the cooldown set correctly in Renovate's own config?).
- Trusted-publishing **registry-side** state (the npm registry's trusted-publisher config) — both stop at "the workflow looks like it would use OIDC".
- Cross-ecosystem polyglot patterns (e.g. a Node CLI shipping a precompiled native module).

## Complementarity — how they can reinforce each other

The clearest reading of the two designs together: **`ai-kit` is the survey layer, `supply-chain` is the gate layer.** They aren't competing for the same job once you accept that. A few concrete ways to make them work together:

### 1. Use `ai-kit`'s rollout discipline to graduate `supply-chain`'s critical-vs-advisory line

`ai-kit`'s P2 modules deliberately stay review-only "until owner/platform migration patterns are agreed." Treat that as the on-ramp: once an `ai-kit` review-only check has run in canary mode and the FP rate is acceptable, port it into `supply-chain` as an **advisory** check (gets onto every PR, doesn't block). After more org-wide signal, graduate to **critical**.

Concrete near-term candidates to port from `ai-kit` → `supply-chain` advisory:

- `renovate-dependabot` coverage (small, deterministic, low FP risk)
- A `version-pinning` advisory on `package.json` ranges (complements `min-release-age`)
- Maybe one of the canary publishing/container detectors once owners review noise

### 2. Cross-feed the `package-management` correctness nuance the other direction

`ai-kit` learned the hard way (canary review) that `npmrc-correct` needs to **co-pin npm to an approved target version** before adding `allow-git=none` / `min-release-age=3`, because old npm versions silently ignore those keys. `supply-chain`'s `npmrc-correct` currently treats them as independent. The fix is small: `npmrc-correct` could either downgrade those specific keys to advisory when `packageManager:` isn't pinned to a high-enough npm, or emit a more pointed remediation hint.

Same nuance for `dangerouslyAllowAllBuilds: false` in pnpm — `ai-kit` enforces it; `supply-chain` doesn't yet.

### 3. Share a finding fingerprint scheme so the two outputs are joinable

`ai-kit`'s `fingerprint` is the natural join key for cross-tool aggregation. If `supply-chain`'s JSON payload (`SUPPLY_CHAIN_FINDINGS_OUT`) emitted a compatible fingerprint per finding (`sha256(check_id + root + offending-content)` or similar), a single Google Sheet could merge:

- per-PR `supply-chain` findings (what's failing right now on this branch)
- weekly `ai-kit` sweeps (what's open across the fleet)

…by `check_id`, and a "fixed in PR #X" row from `supply-chain` would naturally close out the matching `ai-kit` open finding. The TSV column already exists in `ai-kit`; `supply-chain` would only need to add the field at JSON-write time.

### 4. Suppressions: one file, two readers

Both tools should read `.github/supply-chain.yml` (or a renamed `.github/security-hardening.yml`) if it exists. `supply-chain` already does. `ai-kit` could honour it by filtering findings whose `check_id` matches an unexpired suppression entry, turning "this is intentionally not fixed" into a single point of truth instead of duplicating annotations in JSONL state.

### 5. `ai-kit`'s `fix --from-jsonl` ↔ `supply-chain`'s JSON artifact

`supply-chain` already writes `static-findings.json` and `audit-findings.json` to CI artifacts. If those JSONs were shaped to be readable by `ai-kit`'s `fix --safe-only --from-jsonl --finding <fingerprint>`, a workflow run on a feature branch could attach a "click to autofix" artifact that a maintainer pulls down + `ai-kit fix`es locally. That's a reasonable lighter-weight alternative to bots opening fix-PRs.

### 6. Different surfaces, different audiences

- **PR author**: sees `supply-chain`'s sticky comment, fixes the critical findings, ignores advisory until they have time. Win.
- **Security weekly triage**: pulls `ai-kit`'s TSV into Sheets, sorts by team/module, looks at "open for >30 days" rows, drafts canary fix PRs.
- **Org-wide rollout owner**: uses `ai-kit`'s observation rows + state transitions to decide when an advisory check is mature enough to flip to critical in `supply-chain`.

That mapping is what justifies running both rather than picking one. The cost is real (two configs, two tools, two doc trees), but each tool keeps its strengths instead of compromising toward the other.

## Areas to align early (low cost, high payoff)

1. **`check_id` namespace.** If a check exists in both tools (e.g. "npm `ignore-scripts=true`"), make sure the `check_id` string matches verbatim. That's the cheapest possible join key.
2. **Severity vocabulary.** `supply-chain` uses `critical` / `advisory`. `ai-kit` uses module-level rollout status (`default-self-service` / `canary` / `report-only`). Adding a `severity` field to `ai-kit`'s JSONL (or a `rollout_status` field to `supply-chain`'s JSON) would make them comparable.
3. **The approved-target npm version.** `ai-kit` runs `scripts/refresh_npm_target.py` after security review of the current `latest` dist-tag. `supply-chain`'s `packagemanager-pinned` hard-codes a minimum version. If both tools deferred to the same checked-in constant (`TARGET_NPM_VERSION`), bumping it once would update both.

## What this comparison does **not** recommend

- **Merging the codebases.** They're written in different languages on different release cadences for different audiences. The right shape is two well-defined tools sharing a few small contracts (fingerprint, suppression file, target-version constant), not one bigger tool.
- **Picking one as "the" hardening surface.** Both are load-bearing; treating one as redundant gives up either fleet visibility or merge-time enforcement. The cost of running both is small once the join keys exist.
- **Moving `supply-chain`'s critical checks into `ai-kit`'s `fix --safe-only` autofixer.** That would be tempting (one autofix path), but `ai-kit`'s safe-fix boundary is intentionally narrower than what `supply-chain`'s critical checks demand. Better: keep `supply-chain` blocking, and let `ai-kit` autofix the cases where the safe-fix boundary actually applies (npm pin co-located with `.npmrc` keys, etc.).

## Open questions worth a follow-up

1. **Where should the JSON contract live?** If both tools agree on `check_id` + `fingerprint`, the schema needs an owner. Most natural place is here (`supply-chain/src/io.ts`) since the format is already exported as a TypeScript type and consumed by both `check.ts` and `render-cli.ts`. `ai-kit` would import the same schema in spirit.
2. **Should `supply-chain` expose its findings via TSV too?** Low cost, would feed `ai-kit`'s Sheet without a second scan. The JSON is already there; a TSV converter is ~30 lines.
3. **Do we want a shared `.github/security.yml` instead of `.github/supply-chain.yml`?** The latter is supply-chain-specific. If both tools end up reading the same file, the name should reflect that.
4. **Who owns the rollout calendar?** `supply-chain` is gated by the org Ruleset (single org-level switch). `ai-kit`'s rollout is per-team. If a check is in both, which tool's signal is "ready to graduate to critical"?
