import {
  isRouteErrorResponse,
  Link,
  useRevalidator,
  useRouteError,
} from 'react-router-dom';
import Navbar from './Navbar';

function errorDetail(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === 'string' && error.data.trim()) return error.data;
    return `The server returned status ${error.status}.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'The scoresheet could not be loaded. Please try again.';
}

export default function ScoresheetRouteError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  const retrying = revalidator.state === 'loading';

  return (
    <div className="app">
      <Navbar />
      <main className="container" role="alert">
        <h2>
          {isNotFound ? 'Scoresheet not found' : 'Unable to load scoresheet'}
        </h2>
        <p>{errorDetail(error)}</p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {!isNotFound && (
            <button
              className="btn btn-primary"
              type="button"
              disabled={retrying}
              onClick={() => revalidator.revalidate()}
            >
              {retrying ? 'Retrying…' : 'Try again'}
            </button>
          )}
          <Link className="btn btn-secondary" to="/judge">
            Back to templates
          </Link>
        </div>
      </main>
    </div>
  );
}
