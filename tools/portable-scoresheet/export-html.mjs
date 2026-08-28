#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function parseArgs(argv) {
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

function normalizeInput(rawInput) {
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

  if (rawInput?.schema && typeof rawInput.schema === 'object') {
    return {
      name: rawInput.name || rawInput.schema.title || 'Portable Scoresheet',
      description: rawInput.description || '',
      schema: rawInput.schema,
    };
  }

  if (rawInput?.fields && typeof rawInput === 'object') {
    return {
      name: rawInput.name || rawInput.title || 'Portable Scoresheet',
      description: rawInput.description || '',
      schema: rawInput,
    };
  }

  throw new Error(
    'Input must be either { name, description, schema } or a schema object { title, layout, fields }.',
  );
}

function validateSchema(template) {
  const errors = [];
  const schema = template.schema;

  if (!schema || typeof schema !== 'object') {
    errors.push('Missing schema object.');
    return errors;
  }

  if (!Array.isArray(schema.fields)) {
    errors.push('schema.fields must be an array.');
    return errors;
  }

  if (schema.kind === 'bracket') {
    errors.push('Unsupported schema.kind "bracket". Portable V1 is seeding-only.');
  }

  if (schema.kind === 'double_seeding') {
    errors.push(
      'Unsupported schema.kind "double_seeding". Portable V1 is seeding-only.',
    );
  }

  if (schema.layout && schema.layout !== 'two-column') {
    errors.push(
      `Unsupported schema.layout "${schema.layout}". V1 only supports "two-column".`,
    );
  }

  if (schema.scoreDestination === 'db') {
    errors.push('Unsupported schema.scoreDestination "db" for portable export.');
  }

  if (schema.queueConfig || schema.useQueueForSeeding) {
    errors.push('Queue-based schema features are unsupported in portable V1.');
  }

  for (const field of schema.fields) {
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) {
      errors.push(
        `Unsupported field type "${field.type}" for field "${field.id || '(missing id)'}".`,
      );
    }

    if (field.type === 'winner-select') {
      errors.push('Unsupported field type "winner-select".');
    }

    if (!field.id && field.type !== 'section_header' && field.type !== 'group_header') {
      errors.push('All non-header fields must include an "id".');
    }

    if (field.dataSource?.type === 'db' || field.dataSource?.type === 'bracket') {
      errors.push(
        `Unsupported dataSource.type "${field.dataSource.type}" on field "${field.id}".`,
      );
    }

    if (field.id === 'game_queue_id') {
      errors.push('Queue-specific field "game_queue_id" is unsupported in portable V1.');
    }

    errors.push(...validateFieldDefaultValue(field));
  }

  return errors;
}

function fieldLabel(field) {
  return field.id || field.label || field.type || '(unknown field)';
}

function optionMatches(optionValue, defaultValue) {
  return Object.is(optionValue, defaultValue);
}

function validateFieldDefaultValue(field, path = '') {
  const errors = [];
  const label = path || `field "${fieldLabel(field)}"`;

  if (field && Object.prototype.hasOwnProperty.call(field, 'startValue') && field.startValue !== undefined) {
    errors.push(
      `${label}: "startValue" is no longer supported; use "defaultValue" instead.`,
    );
  }

  if (!field || field.defaultValue === undefined) {
    return errors;
  }

  const { type, defaultValue } = field;

  if (
    type === 'calculated' ||
    type === 'section_header' ||
    type === 'group_header' ||
    type === 'winner-select'
  ) {
    errors.push(`${label}: field type "${type}" does not support defaultValue.`);
    return errors;
  }

  switch (type) {
    case 'text':
      if (typeof defaultValue !== 'string') {
        errors.push(`${label}: defaultValue must be a string for text fields.`);
      }
      break;
    case 'number':
      if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
        errors.push(
          `${label}: defaultValue must be a finite number for number fields.`,
        );
        break;
      }
      if (typeof field.min === 'number' && defaultValue < field.min) {
        errors.push(
          `${label}: defaultValue ${defaultValue} is below min ${field.min}.`,
        );
      }
      if (typeof field.max === 'number' && defaultValue > field.max) {
        errors.push(
          `${label}: defaultValue ${defaultValue} is above max ${field.max}.`,
        );
      }
      break;
    case 'checkbox':
      if (typeof defaultValue !== 'boolean') {
        errors.push(
          `${label}: defaultValue must be a boolean for checkbox fields.`,
        );
      }
      break;
    case 'dropdown':
    case 'buttons': {
      const primitiveOk =
        typeof defaultValue === 'string' ||
        typeof defaultValue === 'number' ||
        typeof defaultValue === 'boolean';
      if (!primitiveOk) {
        errors.push(
          `${label}: defaultValue must be a string, number, or boolean for ${type} fields.`,
        );
        break;
      }
      if (Array.isArray(field.options)) {
        const match = field.options.some((opt) =>
          optionMatches(opt?.value, defaultValue),
        );
        if (!match) {
          errors.push(
            `${label}: defaultValue must match one of the declared options.`,
          );
        }
      } else if (type === 'buttons') {
        errors.push(
          `${label}: buttons fields with defaultValue require an options array.`,
        );
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

function normalizeSchemaShape(template) {
  const schema = template.schema;

  return {
    name: template.name,
    description: template.description,
    schema: {
      title: schema.title || template.name || 'Portable Scoresheet',
      description: schema.description || template.description || '',
      layout: schema.layout || 'two-column',
      gameAreasImage: schema.gameAreasImage || null,
      fields: schema.fields,
    },
  };
}

function escapeForScriptTag(json) {
  return json.replace(/<\//g, '<\\/');
}

async function buildHtml({ normalizedTemplate }) {
  const [runtimeJs, stylesCss, templateHtml] = await Promise.all([
    readFile(path.join(__dirname, 'runtime.js'), 'utf8'),
    readFile(path.join(__dirname, 'styles.css'), 'utf8'),
    readFile(path.join(__dirname, 'template.html'), 'utf8'),
  ]);

  const schemaJson = escapeForScriptTag(JSON.stringify(normalizedTemplate, null, 2));

  return templateHtml
    .replace('/*__INLINE_STYLES__*/', stylesCss)
    .replace('//__INLINE_RUNTIME__', runtimeJs)
    .replace('__EMBEDDED_TEMPLATE_JSON__', schemaJson);
}

async function main() {
  try {
    const { input, output } = parseArgs(process.argv.slice(2));
    const rawJson = await readFile(input, 'utf8');
    const rawInput = JSON.parse(rawJson);

    const template = normalizeInput(rawInput);
    const validationErrors = validateSchema(template);

    if (validationErrors.length > 0) {
      const details = validationErrors.map((error) => `  - ${error}`).join('\n');
      throw new Error(`Unsupported schema for portable V1:\n${details}`);
    }

    const normalizedTemplate = normalizeSchemaShape(template);
    const html = await buildHtml({ normalizedTemplate });

    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, html, 'utf8');

    console.log(`Portable scoresheet exported:\n  input: ${input}\n  output: ${output}`);
  } catch (error) {
    console.error(`[export:scoresheet] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

await main();
