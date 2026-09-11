import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runExporter(inputPath: string, outputPath: string) {
  return execFileSync(
    'node',
    [
      '-r',
      'ts-node/register',
      'tools/portable-scoresheet/export-html.ts',
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
  it('embeds local reference images and safely quotes closing script text', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'portable-assets-'));
    const input = path.join(dir, 'input.json');
    const output = path.join(dir, 'sheet.html');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    writeFileSync(path.join(dir, 'reference.svg'), svg);
    writeFileSync(
      input,
      JSON.stringify({
        title: '</script><script>throw 1</script>',
        gameAreasImage: 'reference.svg',
        fields: [],
      }),
    );
    runExporter(input, output);
    const html = readFileSync(output, 'utf8');
    expect(html).toContain(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    );
    expect(html).not.toContain('</script><script>throw 1</script>');
  });

  it.each(['missing+1', '1+', 'total+1'])(
    'rejects invalid formulas before export: %s',
    (formula) => {
      const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-formula-'));
      const input = path.join(tempDir, 'input.json');
      writeFileSync(
        input,
        JSON.stringify({
          fields: [{ id: 'total', type: 'calculated', formula }],
        }),
      );
      expect(() =>
        runExporter(input, path.join(tempDir, 'sheet.html')),
      ).toThrow(/total/);
    },
  );

  it('produces a single HTML file with inline assets and embedded schema data', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const outputPath = path.join(tempDir, 'simple.html');

    runExporter('templates/test-simple-fields.json', outputPath);

    const html = readFileSync(outputPath, 'utf8');

    expect(html).toContain('<style>');
    expect(html).not.toMatch(/\b(?:eval|Function)\s*\(/);
    expect(html).not.toMatch(/<script[^>]+src=/);
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

  it('injects team initials when requireTeamInitials is set', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-scoresheet-'));
    const inputPath = path.join(tempDir, 'initials.json');
    const outputPath = path.join(tempDir, 'initials.html');

    writeFileSync(
      inputPath,
      JSON.stringify({
        schema: {
          title: 'Initials',
          layout: 'two-column',
          requireTeamInitials: true,
          fields: [
            {
              id: 'side_a_score',
              label: 'Side A Score',
              type: 'number',
              column: 'left',
            },
          ],
        },
      }),
    );

    runExporter(inputPath, outputPath);
    const html = readFileSync(outputPath, 'utf8');
    expect(html).toContain('"id": "side_a_team_initials"');
    expect(html).toContain('Team Initials');
  });
});
