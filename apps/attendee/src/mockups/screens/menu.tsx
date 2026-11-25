/**
 * DEVELOPMENT ONLY — (f) navigation in its open state on a phone: the home of the direction
 * underneath, the menu sheet open on top (at desktop width it opens as a side panel).
 */
import { useNavigate } from "react-router-dom";
import { useDx } from "../frame";
import { MenuSheet } from "../nav";
import Showcase from "./showcase";

export default function Menu() {
  const dx = useDx();
  const navigate = useNavigate();
  return (
    <>
      <Showcase />
      <div className="dxm-scrim" aria-hidden="true" />
      <MenuSheet onClose={() => navigate(dx.href({ screen: "showcase" }))} />
    </>
  );
}
