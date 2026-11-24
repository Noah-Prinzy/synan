import { Link } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import { buttonClass } from "@synan/ui/components";
import { StateBlock } from "../components/states";

/**
 * Signed in, but no pass is issued to this person (real API only; the mock always has one).
 * Its own chunk, so the contracts' copy table is not loaded with every pass.
 */
export default function NoPass() {
  return (
    <StateBlock
      glyph="·"
      title={ERROR_COPY.NO_CREDENTIAL.title}
      action={
        <Link to="/" className={buttonClass("secondary", "sm")}>
          Browse events
        </Link>
      }
    >
      {ERROR_COPY.NO_CREDENTIAL.message}
    </StateBlock>
  );
}
