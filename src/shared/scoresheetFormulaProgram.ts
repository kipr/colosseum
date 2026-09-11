import {
  compileFormulaProgram,
  type FormulaCompilationResult,
  type FormulaDefinition,
  type FormulaDiagnostic,
  type FormulaInput,
} from './scoreFormulaEval';

/** The schema boundary is untrusted JSON. Only declared top-level scalar fields
 * and explicitly configured derived outputs enter the formula namespace. */
export function compileScoresheetFormulas(
  fields: unknown,
): FormulaCompilationResult {
  const definitions: FormulaDefinition[] = [];
  const inputs: FormulaInput[] = [];
  const errors: FormulaDiagnostic[] = [];
  const ids = new Set<string>();
  const nonscalarIds = new Set<string>();
  if (fields === undefined) return compileFormulaProgram([], []);
  if (!Array.isArray(fields))
    return {
      ok: false,
      errors: [{ code: 'INVALID_FIELDS', message: 'Fields must be an array.' }],
    };
  for (const value of fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({
        code: 'INVALID_FIELD',
        message: 'Each field must be an object.',
      });
      continue;
    }
    const field: Record<string, unknown> = value;
    const id = typeof field.id === 'string' ? field.id : undefined;
    if (id) {
      if (ids.has(id))
        errors.push({
          code: 'DUPLICATE_ID',
          field: id,
          message: `Duplicate field ID "${id}".`,
        });
      ids.add(id);
      if (
        ['repeatableGroup', 'section_header', 'group_header'].includes(
          String(field.type),
        )
      )
        nonscalarIds.add(id);
    }
    if (field.type === 'section_header' || field.type === 'group_header')
      continue;
    if (!id) {
      errors.push({
        code: 'MISSING_ID',
        message: 'Every non-header field needs an ID.',
      });
      continue;
    }
    if (field.type === 'calculated') {
      if (field.formula !== undefined && typeof field.formula !== 'string')
        errors.push({
          code: 'INVALID_FORMULA',
          field: id,
          message: 'Formula must be text.',
        });
      else definitions.push({ id, formula: field.formula });
    } else if (field.type === 'repeatableGroup') {
      const scopes = [field.fields];
      while (scopes.length) {
        const children = scopes.pop();
        if (!Array.isArray(children)) continue;
        const childIds = new Set<string>();
        for (const child of children) {
          if (!child || typeof child !== 'object' || Array.isArray(child))
            continue;
          const node: Record<string, unknown> = child;
          if (typeof node.id === 'string') {
            if (childIds.has(node.id))
              errors.push({
                code: 'DUPLICATE_ID',
                field: id,
                message: `Duplicate row field ID "${node.id}" in "${id}".`,
              });
            childIds.add(node.id);
          }
          if (node.type === 'calculated')
            errors.push({
              code: 'ROW_FORMULA_UNSUPPORTED',
              field: id,
              message: `Row-level calculated field "${String(node.id)}" is unsupported; use a top-level formula with a declared derived output.`,
            });
          if (node.type === 'repeatableGroup') scopes.push(node.fields);
        }
      }
      if (
        !field.derived ||
        typeof field.derived !== 'object' ||
        Array.isArray(field.derived)
      )
        continue;
      const derived = field.derived as Record<string, unknown>;
      if (
        !derived.outputs ||
        typeof derived.outputs !== 'object' ||
        Array.isArray(derived.outputs)
      )
        continue;
      for (const [key, output] of Object.entries(derived.outputs)) {
        const validKey =
          derived.type === 'botballStartBoxCubes'
            ? key === 'subtotal'
            : derived.type === 'botballCubeStacks' &&
              ['subtotal', 'sortedEquivalent', 'unsortedEquivalent'].includes(
                key,
              );
        if (!validKey || typeof output !== 'string' || !output)
          errors.push({
            code: 'INVALID_DERIVED_OUTPUT',
            field: id,
            message: `Invalid derived output "${key}"; use a supported output and a field ID.`,
          });
        else inputs.push({ id: output, kind: 'derived' });
      }
    } else if (
      [
        'text',
        'number',
        'dropdown',
        'buttons',
        'checkbox',
        'winner-select',
      ].includes(String(field.type))
    )
      inputs.push({ id, kind: 'input' });
    else
      errors.push({
        code: 'INVALID_FIELD_TYPE',
        field: id,
        message: `Unsupported field type "${String(field.type)}".`,
      });
  }
  for (const input of inputs) {
    if (input.kind === 'derived' && nonscalarIds.has(input.id))
      errors.push({
        code: 'DUPLICATE_ID',
        field: input.id,
        message: `Derived output "${input.id}" collides with a group or header field.`,
      });
  }
  const compiled = compileFormulaProgram(definitions, inputs);
  if (!compiled.ok) errors.push(...compiled.errors);
  return errors.length ? { ok: false, errors } : compiled;
}
