# V1 check scope: which checks block, which only advise

The full JS-ecosystem check set falls into two groups: the **critical**
group whose findings block merge, and the **advisory** group that only
nudges via the PR comment.

## Critical (workflow fails → merge blocked)

| check_id | What it enforces |
|---|---|
| `packagemanager-pinned` | `package.json` declares `packageManager:` at org-policy versions. Required as the gate — without it, the manager-specific checks skip on repos that don't declare a manager. |
| `lockfile-committed` | The lockfile for the declared manager exists and is tracked by git. |
| `lockfile-conflict` | A root contains at most one lockfile (no half-finished migrations). |
| `npmrc-correct` | `.npmrc` contains `ignore-scripts=true`, `allow-git=none`, `min-release-age=3`. |
| `pnpm-workspace-correct` | `pnpm-workspace.yaml` contains `minimumReleaseAge: 4320`, `strictDepBuilds: true`, `blockExoticSubdeps: true`. |
| `yarnrc-correct` | `.yarnrc.yml` contains `enableScripts: false`, `enableImmutableInstalls: true`, `npmMinimalAgeGate: 4320`; **not** `approvedGitRepositories`. |

## Advisory (PR comment only, never blocks merge)

| check_id | What it surfaces |
|---|---|
| `install-not-ci` | Install commands across workflows / Dockerfiles / shell scripts use the lockfile-strict variant. |
| `npx-confusion` | `npx <name>` invocations are scoped or `--package`-qualified to avoid name-confusion attacks. |
| `oidc-publishing` | Publishing workflows use OIDC trusted publishing instead of long-lived tokens. |
| `cache-poisoning-publish` | Publishing workflows disable `actions/setup-node`'s package-manager cache. |
| `registry-audit` | High/critical advisories from `npm/pnpm/yarn audit`. |

## Why the split

The critical set is restricted to checks whose findings are unambiguous:
read one well-known file, compare to an expected value, pass or fail with
no judgement call. The advisory set is heuristic — scanning workflows,
Dockerfiles, shell scripts, parsing audit output — where a false-positive
rate at org scale would push teams to build escape hatches. Surfacing
those as advisory while the signal stabilises means we get the org-wide
visibility without the merge-blocking blast radius.

## Rollout split

The full set landed across three PRs to keep each review tractable:

- **PR1**: post-install-script enforcement only — `packagemanager-pinned`
  plus the single `ignore-scripts=true` / `strictDepBuilds: true` /
  `enableScripts: false` keys.
- **PR2** (this one): the remaining JS checks above — full
  `.npmrc` / `.yarnrc.yml` / `pnpm-workspace.yaml` keysets, the lockfile
  pair, the heuristic advisory set, and `registry-audit`.
- **PR3**: Go-ecosystem support (`gosum-committed`, `toolchain-pinned`,
  `govulncheck-clean`) plus the structural split into `src/js/` + `src/go/`.

## Considered

- **All checks critical from v1.** Rejected: a required check that fires
  false positives 5% of the time will get every team building escape
  hatches within a week. Start advisory, graduate individual checks to
  critical after we have real-world FP signal.
- **Ship everything at once.** Rejected: the unified PR was ~3kLOC of
  net-new code, which is harder to review and harder to roll back if any
  single check turns out to be a source of false positives at org scale.

## Consequences

- The CLI's check registry stores severity per check (not derived).
  Promoting an advisory check to critical is a one-line change, but it
  is a deliberate org-wide event with a grace period (see README rollout
  section).
- Minimum version constants (npm ≥ 11.10, pnpm ≥ 11, yarn ≥ 4.14.0) live
  in source as named constants; bumping them is the same kind of
  deliberate event.
