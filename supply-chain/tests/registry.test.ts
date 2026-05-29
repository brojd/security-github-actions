// Guards the static/audit split. If a new check is exported from `src/js/`
// or `src/go/` but forgotten in one of the registry arrays, CI would
// silently never run it — these tests fail loudly instead.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { STATIC_CHECKS, AUDIT_CHECKS, ALL_CHECKS } from '../src/registry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECOSYSTEM_DIRS = [
  join(__dirname, '..', 'src', 'js'),
  join(__dirname, '..', 'src', 'go'),
];

test('STATIC_CHECKS and AUDIT_CHECKS are disjoint', () => {
  const staticIds = new Set(STATIC_CHECKS.map((c) => c.id));
  const overlap = AUDIT_CHECKS.filter((c) => staticIds.has(c.id)).map((c) => c.id);
  assert.deepEqual(overlap, [], `checks appear in both arrays: ${overlap.join(', ')}`);
});

test('ALL_CHECKS has unique ids', () => {
  const ids = ALL_CHECKS.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate check ids: ${dupes.join(', ')}`);
});

test('every check module under src/{js,go}/ is registered exactly once', async () => {
  // Discover every check module on disk. Anything that starts with `_` (e.g.
  // `_audit-parse.ts`, `_govulncheck-parse.ts`) is a helper, not a check.
  // Same for `scanner.ts` / `walk.ts` (walkers, not checks).
  const HELPERS = new Set(['scanner.ts', 'walk.ts']);
  const registered = new Set(ALL_CHECKS.map((c) => c.id));
  const missing: string[] = [];

  for (const dir of ECOSYSTEM_DIRS) {
    const candidates = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !f.startsWith('_'))
      .filter((f) => !HELPERS.has(f));

    for (const file of candidates) {
      const mod = (await import(join(dir, file))) as { check?: { id?: string } };
      const id = mod.check?.id;
      if (typeof id !== 'string') {
        throw new Error(`${file} does not export a \`check\` with a string \`id\` — add it to scanner/walker helpers, or fix the export.`);
      }
      if (!registered.has(id)) missing.push(`${dir}/${file} (id="${id}")`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `check modules missing from STATIC_CHECKS or AUDIT_CHECKS: ${missing.join(', ')}. Add to src/registry.ts.`,
  );
});
