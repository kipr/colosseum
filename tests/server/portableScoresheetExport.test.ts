import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runExporter(inputPath: string, outputPath: string) {
  return execFileSync(
    'node',
    [
      'tools/portable-scoresheet/export-html.mjs',
      '--input',
      inputPath,
      '--output',
      outputPath,
    ],
    {
      cwd: path.resolve(process.cwd()),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

describe('portable scoresheet exporter', () => {
  it('produces a single HTML file with inline assets and embedded schema data', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const outputPath = path.join(tempDir, 'simple.html');

    runExporter('templates/test-simple-fields.json', outputPath);

    const html = readFileSync(outputPath, 'utf8');

    expect(html).toContain('<style>');
    expect(html).toContain(
      '<script id="portable-template-data" type="application/json">',
    );
    expect(html).toContain('<script>');
    expect(html).toContain('Portable Scoresheet');
    expect(html).toContain('side_a_score + side_b_score');
  });

  it('embeds defaultValue fields for interactive controls', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const outputPath = path.join(tempDir, 'defaults.html');

    runExporter('templates/test-default-values.json', outputPath);

    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('"defaultValue": "Ada Lovelace"');
    expect(html).toContain('"defaultValue": 12.5');
    expect(html).toContain('"defaultValue": "senior"');
    expect(html).toContain('"defaultValue": "4"');
    expect(html).toContain('"defaultValue": true');
  });

  it('rejects invalid defaultValue at export time', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const inputPath = path.join(tempDir, 'bad-defaults.json');
    const outputPath = path.join(tempDir, 'bad.html');

    writeFileSync(
      inputPath,
      JSON.stringify({
        schema: {
          title: 'Bad',
          layout: 'two-column',
          fields: [
            {
              id: 'score',
              label: 'Score',
              type: 'number',
              min: 0,
              max: 5,
              defaultValue: 99,
            },
          ],
        },
      }),
    );

    expect(() => runExporter(inputPath, outputPath)).toThrow(/above max/);
  });

  it('rejects legacy startValue at export time', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const inputPath = path.join(tempDir, 'legacy.json');
    const outputPath = path.join(tempDir, 'legacy.html');

    writeFileSync(
      inputPath,
      JSON.stringify({
        schema: {
          title: 'Legacy',
          layout: 'two-column',
          fields: [
            {
              id: 'name',
              label: 'Name',
              type: 'text',
              startValue: 'Ada',
            },
          ],
        },
      }),
    );

    expect(() => runExporter(inputPath, outputPath)).toThrow(/startValue/);
  });

  it('rejects canonical bracket and double-seeding kinds', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const outputPath = path.join(tempDir, 'rejected.html');

    const bracketPath = path.join(tempDir, 'bracket.json');
    writeFileSync(
      bracketPath,
      JSON.stringify({
        schema: {
          kind: 'bracket',
          title: 'DE',
          layout: 'two-column',
          fields: [{ id: 'score', label: 'Score', type: 'number' }],
        },
      }),
    );
    expect(() => runExporter(bracketPath, outputPath)).toThrow(
      /Unsupported schema.kind "bracket"/,
    );

    const doublePath = path.join(tempDir, 'double.json');
    writeFileSync(
      doublePath,
      JSON.stringify({
        schema: {
          kind: 'double_seeding',
          title: 'DS',
          layout: 'two-column',
          fields: [{ id: 'score', label: 'Score', type: 'number' }],
        },
      }),
    );
    expect(() => runExporter(doublePath, outputPath)).toThrow(
      /Unsupported schema.kind "double_seeding"/,
    );
  });
});
