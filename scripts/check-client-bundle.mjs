/**
 * Fails the client build if the Zod runtime reaches a browser chunk.
 *
 * Zod is a server-side dependency. The client consumes inferred types from
 * `src/shared/scoresheetSchema.ts` through type-only imports, which are erased,
 * and Zod-free helpers from `src/shared/scoresheetDocument.ts`. A single value
 * import re-adds roughly 24 kB gzipped, and nothing else in the build reports
 * that. The lint rule in `eslint.config.mjs` catches the common cases; this
 * checks the emitted output, so re-entry through a transitive dependency or an
 * `eslint-disable` still fails.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ASSETS_DIR = 'dist/client/assets';

// Identifiers Zod 4 emits into bundled output. Minification renames locals but
// leaves these, since they are string literals or exported core symbols.
const ZOD_MARKERS = ['$ZodError', '$ZodType', '$ZodCheck', '_zod'];

function main() {
  let entries;
  try {
    entries = readdirSync(ASSETS_DIR);
  } catch {
    console.error(
      `check-client-bundle: ${ASSETS_DIR} not found. Run the client build first.`,
    );
    process.exit(1);
  }

  const chunks = entries.filter((name) => name.endsWith('.js'));
  if (chunks.length === 0) {
    console.error(
      `check-client-bundle: no JavaScript chunks in ${ASSETS_DIR}.`,
    );
    process.exit(1);
  }

  const offenders = [];
  for (const name of chunks) {
    const path = join(ASSETS_DIR, name);
    const source = readFileSync(path, 'utf8');
    const markers = ZOD_MARKERS.filter((marker) => source.includes(marker));
    if (markers.length > 0) {
      offenders.push({
        name,
        kb: (statSync(path).size / 1024).toFixed(1),
        markers,
      });
    }
  }

  if (offenders.length > 0) {
    console.error('check-client-bundle: Zod runtime found in client chunks:');
    for (const { name, kb, markers } of offenders) {
      console.error(`  ${name} (${kb} kB) matched ${markers.join(', ')}`);
    }
    console.error(
      '\nThe client must not bundle Zod. Use type-only imports for schema-inferred\n' +
        'types and src/shared/scoresheetDocument.ts for runtime helpers. See\n' +
        'ZOD_ROLLOUT.md section 9.',
    );
    process.exit(1);
  }

  console.log(
    `check-client-bundle: ${chunks.length} chunks clean, no Zod runtime.`,
  );
}

main();
