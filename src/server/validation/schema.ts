/**
 * Request-schema helper used at the HTTP boundary.
 *
 * Covers the object, union, coercion, and refinement features the API schemas
 * need. Domain files import `z` from this module.
 */

export type Path = Array<string | number>;

export interface Issue {
  code: string;
  path: Path;
  message: string;
}

export interface ParseSuccess<T> {
  success: true;
  data: T;
}

export interface ParseFailure {
  success: false;
  error: { issues: Issue[] };
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface RefinementCtx {
  addIssue(issue: { code?: string; path?: Path; message: string }): void;
}

export class SchemaError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super('Schema validation failed');
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fail(path: Path, code: string, message: string): ParseFailure {
  return { success: false, error: { issues: [{ code, path, message }] } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export abstract class Schema<T> {
  readonly _output!: T;

  unwrap(): Schema<unknown> {
    return this;
  }

  abstract _parse(data: unknown, path: Path): ParseResult<T>;

  safeParse(data: unknown): ParseResult<T> {
    return this._parse(data, []);
  }

  parse(data: unknown): T {
    const result = this.safeParse(data);
    if (!result.success) {
      throw new SchemaError(result.error.issues);
    }
    return result.data;
  }

  optional(): OptionalSchema<T> {
    return new OptionalSchema(this);
  }

  nullable(): NullableSchema<T> {
    return new NullableSchema(this);
  }

  refine(
    check: (value: T) => unknown,
    extras: { message: string; path?: Path },
  ): Schema<T> {
    return new RefinedSchema(this, (value, ctx) => {
      if (!check(value)) {
        ctx.addIssue({
          code: 'custom',
          path: extras.path,
          message: extras.message,
        });
      }
    });
  }

  superRefine(refine: (value: T, ctx: RefinementCtx) => void): Schema<T> {
    return new RefinedSchema(this, refine);
  }
}

export class OptionalSchema<T> extends Schema<T | undefined> {
  constructor(private readonly inner: Schema<T>) {
    super();
  }

  unwrap(): Schema<unknown> {
    return this.inner.unwrap();
  }

  default(value: T): Schema<T> {
    return new DefaultSchema(this, value);
  }

  _parse(data: unknown, path: Path): ParseResult<T | undefined> {
    if (data === undefined) {
      return { success: true, data: undefined };
    }
    return this.inner._parse(data, path);
  }
}

export class DefaultSchema<T> extends Schema<T> {
  constructor(
    private readonly inner: Schema<T | undefined>,
    private readonly defaultValue: T,
  ) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    if (data === undefined) {
      return { success: true, data: this.defaultValue };
    }
    const result = this.inner._parse(data, path);
    if (!result.success) return result;
    if (result.data === undefined) {
      return { success: true, data: this.defaultValue };
    }
    return { success: true, data: result.data };
  }
}

export class NullableSchema<T> extends Schema<T | null> {
  constructor(private readonly inner: Schema<T>) {
    super();
  }

  unwrap(): Schema<unknown> {
    return this.inner.unwrap();
  }

  _parse(data: unknown, path: Path): ParseResult<T | null> {
    if (data === null) {
      return { success: true, data: null };
    }
    return this.inner._parse(data, path);
  }
}

export class RefinedSchema<T> extends Schema<T> {
  constructor(
    private readonly inner: Schema<T>,
    private readonly refineFn: (value: T, ctx: RefinementCtx) => void,
  ) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    const result = this.inner._parse(data, path);
    if (!result.success) return result;

    const issues: Issue[] = [];
    const ctx: RefinementCtx = {
      addIssue(issue) {
        issues.push({
          code: issue.code ?? 'custom',
          path: [...path, ...(issue.path ?? [])],
          message: issue.message,
        });
      },
    };
    this.refineFn(result.data, ctx);
    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return result;
  }
}

export class StringSchema extends Schema<string> {
  constructor(
    private readonly spec: {
      trim: boolean;
      min?: number;
      max?: number;
      pattern?: RegExp;
      patternMessage?: string;
    } = { trim: false },
  ) {
    super();
  }

  trim(): StringSchema {
    return new StringSchema({ ...this.spec, trim: true });
  }

  min(length: number): StringSchema {
    return new StringSchema({ ...this.spec, min: length });
  }

  max(length: number): StringSchema {
    return new StringSchema({ ...this.spec, max: length });
  }

  regex(pattern: RegExp, message: string): StringSchema {
    return new StringSchema({
      ...this.spec,
      pattern,
      patternMessage: message,
    });
  }

  _parse(data: unknown, path: Path): ParseResult<string> {
    if (typeof data !== 'string') {
      return fail(
        path,
        'invalid_type',
        `Expected string, received ${receivedType(data)}`,
      );
    }
    let value = data;
    if (this.spec.trim) {
      value = value.trim();
    }
    if (this.spec.min !== undefined && value.length < this.spec.min) {
      return fail(
        path,
        'too_small',
        `Too small: expected string to have >=${this.spec.min} characters`,
      );
    }
    if (this.spec.max !== undefined && value.length > this.spec.max) {
      return fail(
        path,
        'too_big',
        `Too big: expected string to have <=${this.spec.max} characters`,
      );
    }
    if (this.spec.pattern && !this.spec.pattern.test(value)) {
      return fail(
        path,
        'invalid_format',
        this.spec.patternMessage ?? 'Invalid string',
      );
    }
    return { success: true, data: value };
  }
}

type NumberCheck =
  | { kind: 'int' }
  | { kind: 'positive' }
  | { kind: 'min'; value: number }
  | { kind: 'gt'; value: number }
  | { kind: 'lte'; value: number };

export class NumberSchema extends Schema<number> {
  constructor(
    private readonly spec: {
      coerce: boolean;
      checks: NumberCheck[];
    } = { coerce: false, checks: [] },
  ) {
    super();
  }

  int(): NumberSchema {
    return new NumberSchema({
      ...this.spec,
      checks: [...this.spec.checks, { kind: 'int' }],
    });
  }

  positive(): NumberSchema {
    return new NumberSchema({
      ...this.spec,
      checks: [...this.spec.checks, { kind: 'positive' }],
    });
  }

  min(value: number): NumberSchema {
    return new NumberSchema({
      ...this.spec,
      checks: [...this.spec.checks, { kind: 'min', value }],
    });
  }

  gt(value: number): NumberSchema {
    return new NumberSchema({
      ...this.spec,
      checks: [...this.spec.checks, { kind: 'gt', value }],
    });
  }

  lte(value: number): NumberSchema {
    return new NumberSchema({
      ...this.spec,
      checks: [...this.spec.checks, { kind: 'lte', value }],
    });
  }

  _parse(data: unknown, path: Path): ParseResult<number> {
    let value = data;
    if (this.spec.coerce && typeof value !== 'number') {
      if (value === undefined || typeof value === 'symbol') {
        return fail(
          path,
          'invalid_type',
          `Expected number, received ${receivedType(value)}`,
        );
      }
      value = Number(value);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail(
        path,
        'invalid_type',
        `Expected number, received ${receivedType(data)}`,
      );
    }
    for (const check of this.spec.checks) {
      if (check.kind === 'int' && !Number.isInteger(value)) {
        return fail(path, 'invalid_type', 'Expected integer');
      }
      if (check.kind === 'positive' && value <= 0) {
        return fail(path, 'too_small', 'Too small: expected number to be >0');
      }
      if (check.kind === 'min' && value < check.value) {
        return fail(
          path,
          'too_small',
          `Too small: expected number to be >=${check.value}`,
        );
      }
      if (check.kind === 'gt' && value <= check.value) {
        return fail(
          path,
          'too_small',
          `Too small: expected number to be >${check.value}`,
        );
      }
      if (check.kind === 'lte' && value > check.value) {
        return fail(
          path,
          'too_big',
          `Too big: expected number to be <=${check.value}`,
        );
      }
    }
    return { success: true, data: value };
  }
}

export class BooleanSchema extends Schema<boolean> {
  _parse(data: unknown, path: Path): ParseResult<boolean> {
    if (typeof data !== 'boolean') {
      return fail(
        path,
        'invalid_type',
        `Expected boolean, received ${receivedType(data)}`,
      );
    }
    return { success: true, data };
  }
}

export class NullSchema extends Schema<null> {
  _parse(data: unknown, path: Path): ParseResult<null> {
    if (data !== null) {
      return fail(
        path,
        'invalid_type',
        `Expected null, received ${receivedType(data)}`,
      );
    }
    return { success: true, data: null };
  }
}

export class UnknownSchema extends Schema<unknown> {
  _parse(data: unknown, _path: Path): ParseResult<unknown> {
    return { success: true, data };
  }
}

export class LiteralSchema<
  T extends string | number | boolean,
> extends Schema<T> {
  constructor(readonly value: T) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    if (data !== this.value) {
      return fail(
        path,
        'invalid_value',
        `Invalid literal value, expected ${JSON.stringify(this.value)}`,
      );
    }
    return { success: true, data: this.value };
  }
}

export class EnumSchema<T extends string> extends Schema<T> {
  constructor(private readonly values: readonly T[]) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    if (typeof data !== 'string' || !this.values.includes(data as T)) {
      return fail(
        path,
        'invalid_value',
        `Invalid enum value. Expected ${this.values.map((value) => JSON.stringify(value)).join(' | ')}`,
      );
    }
    return { success: true, data: data as T };
  }
}

export class ArraySchema<T> extends Schema<T[]> {
  constructor(
    private readonly element: Schema<T>,
    private readonly minLength?: number,
  ) {
    super();
  }

  min(length: number): ArraySchema<T> {
    return new ArraySchema(this.element, length);
  }

  _parse(data: unknown, path: Path): ParseResult<T[]> {
    if (!Array.isArray(data)) {
      return fail(
        path,
        'invalid_type',
        `Expected array, received ${receivedType(data)}`,
      );
    }
    const issues: Issue[] = [];
    if (this.minLength !== undefined && data.length < this.minLength) {
      issues.push({
        code: 'too_small',
        path,
        message: `Too small: expected array to have >=${this.minLength} items`,
      });
    }
    const output: T[] = [];
    data.forEach((item, index) => {
      const result = this.element._parse(item, [...path, index]);
      if (result.success) {
        output.push(result.data);
      } else {
        issues.push(...result.error.issues);
      }
    });
    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: output };
  }
}

export class RecordSchema extends Schema<Record<string, unknown>> {
  _parse(data: unknown, path: Path): ParseResult<Record<string, unknown>> {
    if (!isObject(data)) {
      return fail(
        path,
        'invalid_type',
        `Expected object, received ${receivedType(data)}`,
      );
    }
    return { success: true, data: { ...data } };
  }
}

export class UnionSchema<T> extends Schema<T> {
  constructor(private readonly options: readonly Schema<unknown>[]) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    for (const option of this.options) {
      const result = option._parse(data, path);
      if (result.success) {
        return result as ParseResult<T>;
      }
    }
    return fail(path, 'invalid_union', 'Invalid input');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaShape = Record<string, Schema<any>>;

type OptionalKeys<S extends SchemaShape> = {
  [K in keyof S]: undefined extends Infer<S[K]> ? K : never;
}[keyof S];

type RequiredKeys<S extends SchemaShape> = Exclude<keyof S, OptionalKeys<S>>;

export type InferObject<S extends SchemaShape> = {
  [K in RequiredKeys<S>]: Infer<S[K]>;
} & {
  [K in OptionalKeys<S>]?: Infer<S[K]>;
};

export class ObjectSchema<S extends SchemaShape> extends Schema<
  InferObject<S>
> {
  constructor(
    readonly shape: S,
    private readonly strictMode = false,
  ) {
    super();
  }

  strict(): ObjectSchema<S> {
    return new ObjectSchema(this.shape, true);
  }

  _parse(data: unknown, path: Path): ParseResult<InferObject<S>> {
    if (!isObject(data)) {
      return fail(
        path,
        'invalid_type',
        `Expected object, received ${receivedType(data)}`,
      );
    }

    const issues: Issue[] = [];
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const field = this.shape[key];
      const hasKey = Object.prototype.hasOwnProperty.call(data, key);
      const raw = hasKey ? data[key] : undefined;
      const result = field._parse(raw, [...path, key]);
      if (!result.success) {
        issues.push(...result.error.issues);
        continue;
      }
      if (result.data !== undefined) {
        output[key] = result.data;
      }
    }

    if (this.strictMode) {
      const unknownKeys = Object.keys(data).filter(
        (key) => !Object.prototype.hasOwnProperty.call(this.shape, key),
      );
      if (unknownKeys.length > 0) {
        issues.push({
          code: 'unrecognized_keys',
          path,
          message: `Unrecognized keys: ${unknownKeys.join(', ')}`,
        });
      }
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: output as InferObject<S> };
  }
}

export class DiscriminatedUnionSchema<T> extends Schema<T> {
  constructor(
    private readonly discriminator: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly options: readonly ObjectSchema<any>[],
  ) {
    super();
  }

  _parse(data: unknown, path: Path): ParseResult<T> {
    if (!isObject(data)) {
      return fail(
        path,
        'invalid_type',
        `Expected object, received ${receivedType(data)}`,
      );
    }

    const discriminatorValue = data[this.discriminator];
    for (const option of this.options) {
      const field = option.shape[this.discriminator];
      if (!field) continue;
      const literal = field.unwrap();
      if (
        literal instanceof LiteralSchema &&
        literal.value === discriminatorValue
      ) {
        return option._parse(data, path) as ParseResult<T>;
      }
    }

    return fail(
      [...path, this.discriminator],
      'invalid_value',
      `Invalid discriminator value`,
    );
  }
}

export type Infer<T> = T extends Schema<infer U> ? U : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InferUnion<T extends readonly Schema<any>[]> = {
  [I in keyof T]: T[I] extends Schema<infer U> ? U : never;
}[number];

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  null: () => new NullSchema(),
  unknown: () => new UnknownSchema(),
  literal: <T extends string | number | boolean>(value: T) =>
    new LiteralSchema(value),
  enum: <const T extends readonly [string, ...string[]]>(values: T) =>
    new EnumSchema<T[number]>(values),
  array: <T>(schema: Schema<T>) => new ArraySchema(schema),
  object: <S extends SchemaShape>(shape: S) => new ObjectSchema(shape),
  record: (_key: Schema<string>, _value: Schema<unknown>) => new RecordSchema(),
  union: <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends readonly [Schema<any>, ...Schema<any>[]],
  >(
    options: T,
  ) => new UnionSchema<InferUnion<T>>(options),
  discriminatedUnion: <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Options extends readonly [ObjectSchema<any>, ...ObjectSchema<any>[]],
  >(
    discriminator: string,
    options: Options,
  ) =>
    new DiscriminatedUnionSchema<InferUnion<Options>>(discriminator, options),
  coerce: {
    number: () => new NumberSchema({ coerce: true, checks: [] }),
  },
};

export namespace z {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type infer<T extends Schema<any>> = Infer<T>;
}
