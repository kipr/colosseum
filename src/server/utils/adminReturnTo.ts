export const DEFAULT_ADMIN_RETURN_TO = '/admin';

const INTERNAL_ORIGIN = 'http://colosseum.internal';

export function sanitizeAdminReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return DEFAULT_ADMIN_RETURN_TO;
  }

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    const isAdminPath =
      url.pathname === '/admin' || url.pathname.startsWith('/admin/');

    if (url.origin !== INTERNAL_ORIGIN || !isAdminPath) {
      return DEFAULT_ADMIN_RETURN_TO;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_ADMIN_RETURN_TO;
  }
}
