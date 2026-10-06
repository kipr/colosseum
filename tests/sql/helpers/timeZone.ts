/**
 * Run `fn` with the Node process in `timeZone`. The suites pin TZ=UTC, which
 * hides any mismatch between Node's zone and the Postgres session zone, so
 * time-zone regression tests switch it explicitly.
 */
export async function withNodeTimeZone<T>(
  timeZone: string,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}
