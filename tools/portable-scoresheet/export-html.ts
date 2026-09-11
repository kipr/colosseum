#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateScoresheetSchema,
  type ScoresheetSchema,
  type ScoresheetField,
} from '../../src/shared/scoresheetSchema';

interface PortableTemplate {
  name: string;
  description: string;
  schema: ScoresheetSchema;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SUPPORTED_FIELD_TYPES = new Set([
  'text',
  'number',
  'dropdown',
  'buttons',
  'checkbox',
  'calculated',
  'section_header',
  'group_header',
]);

function parseArgs(argv: string[]) {
  const args = { input: '', output: '' };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[i + 1] || '';
    if (arg === '--output') args.output = argv[i + 1] || '';
  }

  if (!args.input || !args.output) {
    throw new Error(
      'Usage: npm run export:scoresheet -- --input <template.json> --output <portable.html>',
    );
  }

  return args;
}

function normalizeInput(rawInput: unknown): PortableTemplate {
  if (Array.isArray(rawInput)) {
    return {
      name: 'Portable Scoresheet',
      description: '',
      schema: {
        title: 'Portable Scoresheet',
        layout: 'two-column',
        fields: rawInput,
      },
    };
  }

  if (isObject(rawInput) && isObject(rawInput.schema)) {
    return {
      name: String(
        rawInput.name || rawInput.schema.title || 'Portable Scoresheet',
      ),
      description: String(rawInput.description || ''),
      schema: rawInput.schema,
    };
  }

  if (isObject(rawInput) && Array.isArray(rawInput.fields)) {
    return {
      name: String(rawInput.name || rawInput.title || 'Portable Scoresheet'),
      description: String(rawInput.description || ''),
      schema: rawInput,
    };
  }

  throw new Error(
    'Input must be either { name, description, schema } or a schema object { title, layout, fields }.',
  );
}

function validateSchema(template: PortableTemplate) {
  const errors: string[] = [];
  const schema = template.schema;

  if (!schema || typeof schema !== 'object') {
    errors.push('Missing schema object.');
    return errors;
  }

  if (!Array.isArray(schema.fields)) {
    errors.push('schema.fields must be an array.');
    return errors;
  }

  if (schema.mode === 'head-to-head') {
    errors.push('Unsupported schema.mode "head-to-head".');
  }

  if (schema.layout && schema.layout !== 'two-column') {
    errors.push(
      `Unsupported schema.layout "${schema.layout}". V1 only supports "two-column".`,
    );
  }

  if (schema.scoreDestination === 'db') {
    errors.push(
      'Unsupported schema.scoreDestination "db" for portable export.',
    );
  }

  if (schema.queueConfig || schema.useQueueForSeeding) {
    errors.push('Queue-based schema features are unsupported in portable V1.');
  }

  for (const field of schema.fields) {
    if (!field || typeof field !== 'object') continue;
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      errors.push(
        `Unsupported field type "${field.type}" for field "${field.id || '(missing id)'}".`,
      );
    }

    if (field.type === 'winner-select') {
      errors.push('Unsupported field type "winner-select".');
    }

    if (
      !field.id &&
      field.type !== 'section_header' &&
      field.type !== 'group_header'
    ) {
      errors.push('All non-header fields must include an "id".');
    }

    if (
      field.type === 'dropdown' &&
      (field.dataSource?.type === 'db' || field.dataSource?.type === 'bracket')
    ) {
      errors.push(
        `Unsupported dataSource.type "${field.dataSource.type}" on field "${field.id}".`,
      );
    }

    if (field.id === 'game_queue_id') {
      errors.push(
        'Queue-specific field "game_queue_id" is unsupported in portable V1.',
      );
    }
  }

  errors.push(...validateScoresheetSchema(schema).errors);
  return errors;
}

function injectTeamInitialsFields(fields: ScoresheetField[] | undefined) {
  const next = Array.isArray(fields) ? [...fields] : [];
  const ids = new Set(next.map((field) => field?.id).filter(Boolean));
  if (ids.has('side_a_team_initials') || ids.has('team_a_team_initials')) {
    return next;
  }
  next.push({
    id: 'side_a_team_initials',
    label: 'Team Initials',
    type: 'text',
    required: true,
    column: 'left',
    placeholder: 'Initials of team representative',
  });
  return next;
}

function normalizeSchemaShape(template: PortableTemplate) {
  const schema = template.schema;
  const fields =
    schema.requireTeamInitials === true
      ? injectTeamInitialsFields(schema.fields)
      : schema.fields;

  return {
    name: template.name,
    description: template.description,
    schema: {
      title: schema.title || template.name || 'Portable Scoresheet',
      description: schema.description || template.description || '',
      layout: schema.layout || 'two-column',
      gameAreasImage: schema.gameAreasImage || null,
      requireTeamInitials: schema.requireTeamInitials === true,
      fields,
    },
  };
}

function escapeForScriptTag(json: string) {
  return json.replace(/<\//g, '<\\/');
}

async function inlineGameAreasImage(
  value: unknown,
  inputPath: string,
): Promise<string | null> {
  if (!value) return null;
  if (typeof value !== 'string')
    throw new Error('gameAreasImage must be an image URL or file path.');
  if (value.startsWith('data:image/')) return value;
  let bytes: Buffer;
  let mime: string;
  if (/^https?:\/\//.test(value)) {
    const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
    if (!response.ok)
      throw new Error(
        `Could not embed gameAreasImage (HTTP ${response.status}).`,
      );
    mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!mime.startsWith('image/'))
      throw new Error('gameAreasImage URL must return an image.');
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    const imagePath = path.resolve(path.dirname(inputPath), value);
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.avif': 'image/avif',
    };
    mime = types[path.extname(imagePath).toLowerCase()];
    if (!mime)
      throw new Error(
        'Unsupported gameAreasImage extension. Use PNG, JPEG, GIF, WebP, SVG, or AVIF.',
      );
    bytes = await readFile(imagePath);
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function buildHtml({
  normalizedTemplate,
}: {
  normalizedTemplate: ReturnType<typeof normalizeSchemaShape>;
}) {
  const { build } = await import('vite');
  const [bundle, stylesCss, templateHtml] = await Promise.all([
    build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        target: 'es2020',
        lib: {
          entry: path.join(__dirname, 'runtime.js'),
          name: 'PortableScoresheet',
          formats: ['iife'],
        },
      },
    }),
    readFile(path.join(__dirname, 'styles.css'), 'utf8'),
    readFile(path.join(__dirname, 'template.html'), 'utf8'),
  ]);

  const bundles = Array.isArray(bundle) ? bundle : [bundle];
  const runtimeJs = bundles
    .flatMap((result) => {
      if (!('output' in result))
        throw new Error('Unexpected runtime bundle output.');
      return result.output
        .filter((chunk) => chunk.type === 'chunk')
        .map((chunk) => chunk.code);
    })
    .join('\n');
  const schemaJson = escapeForScriptTag(
    JSON.stringify(normalizedTemplate, null, 2),
  );

  return templateHtml
    .replace('/*__INLINE_STYLES__*/', () => stylesCss)
    .replace('//__INLINE_RUNTIME__', () => escapeForScriptTag(runtimeJs))
    .replace('__EMBEDDED_TEMPLATE_JSON__', () => schemaJson);
}

async function main() {
  try {
    const { input, output } = parseArgs(process.argv.slice(2));
    const rawJson = await readFile(input, 'utf8');
    const rawInput = JSON.parse(rawJson);

    const template = normalizeInput(rawInput);
    if (
      template.schema.requireTeamInitials === true &&
      Array.isArray(template.schema.fields)
    ) {
      template.schema = {
        ...template.schema,
        fields: injectTeamInitialsFields(template.schema.fields),
      };
    }
    const validationErrors = validateSchema(template);

    if (validationErrors.length > 0) {
      const details = validationErrors
        .map((error) => `  - ${error}`)
        .join('\n');
      throw new Error(`Unsupported schema for portable V1:\n${details}`);
    }

    const normalizedTemplate = normalizeSchemaShape(template);
    normalizedTemplate.schema.gameAreasImage = await inlineGameAreasImage(
      template.schema.gameAreasImage,
      input,
    );
    const html = await buildHtml({ normalizedTemplate });

    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, html, 'utf8');

    console.log(
      `Portable scoresheet exported:\n  input: ${input}\n  output: ${output}`,
    );
  } catch (error) {
    console.error(
      `[export:scoresheet] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

void main();
