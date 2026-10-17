import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence for the dashboard.
 *
 * React unmounts the whole tree when a render throws, so before this existed a
 * single bad property access anywhere produced a completely white page: no
 * message, no partial UI, nothing in the DOM to inspect. From the outside that
 * is indistinguishable from a failed deploy, an expired certificate, or a dead
 * server -- which is exactly how long it took to find the last one.
 *
 * This does not make a crash acceptable. It makes a crash legible: the person
 * looking at the page learns that the dashboard broke rather than that the
 * internet broke, and the reason is on screen instead of only in a console
 * nobody has open.
 */
type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  // This repo has no `@types/react`, so the members React.Component provides
  // are invisible to tsc. Declaring them keeps the file type-checked without
  // pulling a new dependency in, and `declare` emits nothing.
  declare props: ErrorBoundaryProps;

  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack: the minified function name in the message is
    // useless on its own, and this is the only place it is ever recorded.
    console.error('[dashboard] render failed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-ink">
        <div className="max-w-xl rounded-lg border border-stroke bg-surface/88 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_18px_40px_rgba(0,0,0,0.045)]">
          <p className="text-xs font-bold uppercase text-muted">Dashboard error</p>
          <h1 className="mt-2 text-2xl font-semibold">This page failed to render.</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-muted">
            The metrics service itself may be fine — this is a fault in the page, not
            necessarily in the data behind it. Reloading sometimes clears it.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-canvas p-3 text-xs leading-5 text-ink">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-[#465fff] px-4 py-2 text-sm font-semibold text-white"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
