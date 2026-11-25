/**
 * "Gradient" (D-37 candidate): two large soft fields of light, the ground lifted toward white and a
 * touch of Daybreak blue (a cool tint in the light theme), drifting and breathing over a minute or
 * more. No edges; a still grain over them keeps the dark, near-empty pages free of 8-bit steps.
 * Only the two fields move (backgrounds.css).
 */
import "./backgrounds.css";
import { usePauseWhenHidden } from "./living";

export default function GradientBackground() {
  usePauseWhenHidden();
  return (
    <div className="living-bg living-bg-gradient" aria-hidden="true">
      <div />
      <div />
      <i />
    </div>
  );
}
