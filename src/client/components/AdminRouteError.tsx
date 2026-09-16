import '../pages/Admin.css';

import {
  isRouteErrorResponse,
  Link,
  useRevalidator,
  useRouteError,
} from 'react-router-dom';

function getErrorDetail(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === 'string' && error.data.trim()) {
      return error.data;
    }

    return `The server returned status ${error.status}.`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'The admin area could not be loaded. Please try again.';
}

export default function AdminRouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const isRetrying = revalidator.state === 'loading';
  const status = isRouteErrorResponse(error) ? error.status : undefined;

  return (
    <main className="container admin-route-error" role="alert">
      <h2>Unable to load the admin area</h2>
      <p>{getErrorDetail(error)}</p>
      {status === 401 && <p>Please sign in again to continue.</p>}
      <div className="admin-route-error-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => revalidator.revalidate()}
          disabled={isRetrying}
        >
          {isRetrying ? 'Retrying…' : 'Try again'}
        </button>
        <Link className="btn btn-secondary" to="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
