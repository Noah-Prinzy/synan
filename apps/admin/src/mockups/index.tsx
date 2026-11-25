/**
 * DEVELOPMENT ONLY — /admin/dev/directions: the owner's gallery of the console's design-direction
 * mock-ups. Reached only through the import.meta.env.DEV-guarded lazy route in App.tsx, so none of
 * this is in a production build. To remove: delete apps/admin/src/mockups and that route line
 * (and the attendee and packages/ui mock-up folders, see packages/ui/src/mockups/directions.ts).
 */
import "@synan/ui/mockups.css";
import "./admin.css";
import { Route, Routes, useParams } from "react-router-dom";
import { DxFrame } from "./frame";
import { Compare, CompareCurrent, Gallery } from "./gallery";
import { SCREENS } from "./registry";

function ScreenRoute() {
  const { screen } = useParams();
  const spec = SCREENS.find((s) => s.id === screen) ?? SCREENS[0]!;
  const Body = spec.component;
  return (
    <DxFrame key={spec.id} screen={spec.id} label={spec.label}>
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
