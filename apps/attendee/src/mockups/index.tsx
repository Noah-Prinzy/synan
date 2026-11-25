/**
 * DEVELOPMENT ONLY — /dev/directions: the owner's gallery of design-direction mock-ups.
 * Reached only through the import.meta.env.DEV-guarded lazy route in App.tsx, so none of this
 * is in a production build. To remove: delete apps/attendee/src/mockups, apps/admin/src/mockups,
 * packages/ui/src/mockups, the route line in each App.tsx and the two export lines in
 * packages/ui/package.json.
 */
import "@synan/ui/mockups.css";
import "./attendee.css";
import "./screens/screens.css";
import { Route, Routes, useParams } from "react-router-dom";
import { DxFrame } from "./frame";
import { CompareCurrent, Gallery } from "./gallery";
import { Compare } from "./compare";
import { SCREENS } from "./registry";

function ScreenRoute() {
  const { screen } = useParams();
  const spec = SCREENS.find((s) => s.id === screen) ?? SCREENS[0]!;
  const Body = spec.component;
  return (
    <DxFrame key={spec.id} screen={spec.id} label={spec.label} hasPhoto={spec.photo}>
      <Body />
    </DxFrame>
  );
}

export default function Directions() {
  return (
    <Routes>
      <Route index element={<Gallery />} />
      <Route path="compare/:screen" element={<Compare />} />
      <Route path="current/:screen" element={<CompareCurrent />} />
      <Route path=":screen" element={<ScreenRoute />} />
    </Routes>
  );
}
