import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('portable scoresheet exporter', () => {
  it('produces a single HTML file with inline assets and embedded schema data', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const outputPath = path.join(tempDir, 'simple.html');

    execFileSync(
      'node',
      [
        'tools/portable-scoresheet/export-html.mjs',
        '--input',
        'templates/test-simple-fields.json',
        '--output',
        outputPath,
      ],
      {
        cwd: path.resolve(process.cwd()),
        stdio: 'pipe',
      },
    );

    const html = readFileSync(outputPath, 'utf8');

    expect(html).toContain('<style>');
    expect(html).toContain('<script id="portable-template-data" type="application/json">');
    expect(html).toContain('<script>');
    expect(html).toContain('Portable Scoresheet');
    expect(html).toContain('side_a_score + side_b_score');
  });
});
