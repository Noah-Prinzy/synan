import { Component, type ReactNode } from "react";
import { buttonClass } from "@synan/ui/components";
import { StateBlock } from "./states";

/** Catches a crashing screen so the shell, navigation and the pass stay reachable. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StateBlock
        glyph="✕"
        tone="destructive"
        title="This page stopped working."
        action={
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => window.location.reload()} className={buttonClass("secondary", "sm")}>
              Reload
            </button>
            <a href="/pass" className={buttonClass("quiet", "sm")}>
              Open my pass
            </a>
          </div>
        }
      >
        Something on this page failed. Reloading usually fixes it; your pass is unaffected.
      </StateBlock>
    );
  }
}
