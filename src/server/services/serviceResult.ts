export type ServiceSuccess<T> = {
  ok: true;
  status: number;
  data: T;
};

export type ServiceFailure<E extends object = object> = {
  ok: false;
  status: number;
  error: string;
} & E;

export type ServiceResult<T, E extends object = object> =
  | ServiceSuccess<T>
  | ServiceFailure<E>;

export function serviceOk<T>(data: T, status = 200): ServiceSuccess<T> {
  return { ok: true, status, data };
}

export function serviceFail<E extends object>(
  status: number,
  error: string,
  extra?: E,
): ServiceFailure<E> {
  return { ok: false, status, error, ...(extra as E) };
}
