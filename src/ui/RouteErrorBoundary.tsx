// =============================================================================
// RouteErrorBoundary — recover from a failed lazy-route chunk load or a render
// error inside a routed workspace without unmounting the root app.
//
// Plan 008 Workstream B: route-level lazy chunks (Runs, Evaluations, suites,
// profiles, fusion study, experiment detail) load on first navigation. If a
// chunk fails to load (transient network) or a routed workspace throws during
// render, a boundary at the top of the routed area keeps the Compare reducer,
// controllers, repositories, and executor/experiment state mounted above it
// (the Plan 007 root-mount contract). Without it React would unmount the whole
// tree and destroy Compare/experiment state.
//
// It renders only a small inline heading + a Retry action; it does not flash a
// full-screen spinner or hide the app chrome. The user can retry the chunk
// (remoteModule = true) or clear the error and re-render the current route.
// =============================================================================
import { Component, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  private dismiss = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h2 className="font-mono text-sm uppercase tracking-[0.14em] text-text-secondary">
          This view could not be loaded
        </h2>
        <p className="max-w-sm text-sm text-text-secondary">
          A workspace chunk failed to load or render. Your Compare state and any active
          run/experiment are preserved. Try again to reload this view.
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text transition-colors duration-150 hover:border-edge-bright hover:text-text"
            onClick={() => {
              // Reload re-requests the current route's lazy chunk after a
              // transient load failure. Rolldown does not tag chunk errors with
              // a "ChunkLoadError" name, so reload is the robust recovery.
              window.location.reload();
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className="flex min-h-[44px] items-center gap-1.5 rounded-md text-sm text-text-secondary transition-colors duration-150 hover:text-text"
            onClick={this.dismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
}
