import { getApiError, getApiErrorMessage } from '../../../src/shared/apiError';
import type { JsonResponse } from './testServer';

export { getApiError, getApiErrorMessage };

export function expectValidationFailed(res: JsonResponse) {
  const error = getApiError(res.json);
  if (res.status !== 400 || error?.code !== 'VALIDATION_FAILED') {
    throw new Error(
      `Expected VALIDATION_FAILED, got status ${res.status} ${JSON.stringify(res.json)}`,
    );
  }
  return error;
}
