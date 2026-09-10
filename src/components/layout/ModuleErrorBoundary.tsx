import { Component, type ErrorInfo, type ReactNode } from "react";

interface ModuleErrorBoundaryProps {
  moduleName: string;
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
  retryKey: number;
}

/**
 * Keeps a failed route contained to its module so the application shell and
 * navigation remain usable.
 */
export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ModuleErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(previousProps: ModuleErrorBoundaryProps) {
    if (
      previousProps.moduleName !== this.props.moduleName &&
      this.state.error !== null
    ) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`The ${this.props.moduleName} module failed to render.`, error, errorInfo);
  }

  private retry = () => {
    this.setState((current) => ({ error: null, retryKey: current.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <section
          role="alert"
          className="mx-auto flex min-h-64 max-w-xl flex-col justify-center rounded-lg border border-[var(--color-destructive)]/40 bg-[var(--color-card)] p-6"
        >
          <h1 className="text-lg font-semibold">{this.props.moduleName} needs to reload</h1>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            Only this module was affected. You can use the sidebar to continue elsewhere, or retry it now.
          </p>
          <div className="mt-5">
            <button
              type="button"
              onClick={this.retry}
              className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary-foreground)]"
            >
              Retry {this.props.moduleName}
            </button>
          </div>
        </section>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
