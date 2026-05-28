import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { listScannedFiles, isWorkflowFile, type ScannedFile } from './scanner.ts';

export const CHECK_ID = 'cache-poisoning-publish';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/cache-poisoning-publish.md';

const PUBLISH_RE = /\b(npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/;

// Match `uses: actions/setup-node@…` to find each setup-node step.
const SETUP_NODE_RE = /uses\s*:\s*actions\/setup-node@/;
const PACKAGE_MANAGER_CACHE_FALSE = /package-manager-cache\s*:\s*false/;
const CACHE_KEY = /\bcache\s*:/;

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.path !== '.') return [];

    const files = (await listScannedFiles(ctx.repoRoot)).filter((f) => isWorkflowFile(f.path));
    const findings: Finding[] = [];
    for (const file of files) {
      if (!hasPublishCall(file)) continue;
      // For publishing workflows: every setup-node step should either explicitly
      // disable the package-manager-cache, or have no `cache:` input at all.
      const stepReports = analyseSetupNodeSteps(file);
      for (const step of stepReports) {
        if (!step.cacheDisabled) {
          findings.push({
            check_id: CHECK_ID,
            severity: 'advisory',
            root: '.',
            title: `Publishing workflow ${file.path} uses cached setup-node at line ${step.line}`,
            detail: `Publishing workflows should not consume the shared package-manager cache. Lower-trust CI jobs can poison it.`,
            fix: 'Add `package-manager-cache: false` to the `actions/setup-node` step in the publishing job.',
            doc_link: DOC_LINK,
          });
        }
      }
    }
    return findings;
  },
};

function hasPublishCall(file: ScannedFile): boolean {
  return file.lines.some((l) => PUBLISH_RE.test(l.replace(/#.*$/, '')));
}

type StepReport = { line: number; cacheDisabled: boolean };

// Find each setup-node use site and examine the `with:` block belonging to
// the enclosing step. We bound the scan by indent: the step starts at column
// `stepCol` (the column of `-` on the step's first line, or the column of
// `uses:` if it's the first key of the step), and the step's body is every
// following line whose indent is strictly greater than `stepCol`. We stop at
// the first sibling — a line starting with `-` at column `<= stepCol` — or
// at a top-level key. Nested lists and multi-line scalars inside `with:`
// keep going because their indent stays deeper than `stepCol`.
function analyseSetupNodeSteps(file: ScannedFile): StepReport[] {
  const reports: StepReport[] = [];
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i]!;
    if (!SETUP_NODE_RE.test(line)) continue;
    const stepCol = findStepCol(file.lines, i);
    let cacheDisabled = true; // default: no `cache:` at all => OK
    for (let j = i + 1; j < file.lines.length; j++) {
      const inner = file.lines[j]!;
      if (inner.trim() === '' || /^\s*#/.test(inner)) continue;
      const col = leadingSpaces(inner);
      // Stop at a sibling step (`-` at same-or-lower indent) or a dedent
      // past the step entirely (any non-list line at `<= stepCol`).
      if (col <= stepCol) break;
      if (PACKAGE_MANAGER_CACHE_FALSE.test(inner)) {
        cacheDisabled = true;
        break;
      }
      if (CACHE_KEY.test(inner)) {
        // A cache: input is present without an explicit disable below it.
        // The order of inputs doesn't actually matter to setup-node, but we
        // can't distinguish "cache: true" from "cache: npm" cheaply; treat
        // any `cache:` mention as enabled unless we *also* see the explicit
        // disable.
        cacheDisabled = false;
      }
    }
    reports.push({ line: i + 1, cacheDisabled });
  }
  return reports;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// The "step column" is the indent of the `-` that introduces this step. If
// the matched line already begins with `- ` (one-line step `- uses: …`), use
// its own indent. Otherwise walk back to the closest preceding `- …` line.
function findStepCol(lines: readonly string[], i: number): number {
  const own = lines[i]!.match(/^(\s*)-\s/);
  if (own) return own[1]!.length;
  for (let k = i - 1; k >= 0; k--) {
    const m = lines[k]!.match(/^(\s*)-\s/);
    if (m) return m[1]!.length;
  }
  return 0;
}
