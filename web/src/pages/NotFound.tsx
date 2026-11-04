import { Link, useRouteError } from "react-router-dom";

/** Branded 404 + route-error surface. Before this existed, an unknown URL rendered a blank
 *  shell (the SPA fallback serves index.html for any path) and a render error white-screened
 *  the whole app. Both now land on something a human can navigate out of. */
export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-6xl font-bold text-primary-light">404</div>
      <div className="text-lg font-semibold text-ink">This page does not exist</div>
      <p className="max-w-sm text-sm text-muted">
        The address may be stale, or the thing it pointed at was removed.
      </p>
      <Link to="/" className="btn btn-primary mt-2">
        Back to home
      </Link>
    </div>
  );
}

export function RouteError() {
  const err = useRouteError() as { statusText?: string; message?: string } | undefined;
  return (
    <div className="app-bg flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-lg font-semibold text-ink">Something broke on this page</div>
      <p className="max-w-md text-sm text-muted">
        {err?.statusText || err?.message || "An unexpected error interrupted rendering."} Reloading
        usually clears it; if it keeps happening, check the Monitor page.
      </p>
      <div className="flex gap-3">
        <button className="btn btn-primary" onClick={() => window.location.assign("/")}>
          Back to home
        </button>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

export default NotFound;
