/**
 * A fault in one screen must not take the chrome with it: the live pill, the alert
 * notice and the status bar stay up while the screen shows what failed.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ERROR_COPY } from "@synan/contracts/copy";

export class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="px-6 py-8">
        <p className="text-13 font-medium text-destructive">This screen stopped working</p>
        <p className="mt-1 text-13 text-muted-foreground">
          {ERROR_COPY.INTERNAL.message} Alerts and gate status above are unaffected.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-4 border border-border px-3 py-1.5 text-12 font-medium hover:border-foreground/50"
        >
          Reload the screen
        </button>
      </div>
    );
  }
}
