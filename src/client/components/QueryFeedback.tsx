import type { UseQueryResult } from '@tanstack/react-query';
import { isAuthorizationError } from '../queries/invalidation';

/** Failed authorization must not leave stale protected content on screen. */
export function queryData<T>(query: UseQueryResult<T>): T | undefined {
  return isAuthorizationError(query.error) ? undefined : query.data;
}

export default function QueryFeedback({
  query,
}: {
  query: UseQueryResult<unknown>;
}) {
  if (query.isError)
    return (
      <div className="lookup-status-banner" role="alert">
        <p>
          {query.data === undefined
            ? 'Unable to load data.'
            : 'Unable to refresh data.'}{' '}
          {query.error.message}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    );
  return query.isLoading ? <p>Loading...</p> : null;
}
