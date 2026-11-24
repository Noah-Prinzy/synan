/**
 * Mount a hook in a real React root (happy-dom), with no testing library: enough to drive hooks
 * whose behaviour is their effects and timers. Use only from a happy-dom test file, and call
 * `cleanup()` after each test so no watcher outlives its test.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<() => void>();

/** Unmount every hook still mounted. */
export function cleanup(): void {
  for (const unmount of [...mounted]) unmount();
}

export function renderHook<P, R>(hook: (props: P) => R, initial: P) {
  const result = { current: undefined as R };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  act(() => root.render(createElement(Probe, { props: initial })));
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    act(() => root.unmount());
  };
  mounted.add(unmount);
  return {
    result,
    rerender(props: P) {
      act(() => root.render(createElement(Probe, { props })));
    },
    unmount,
  };
}
