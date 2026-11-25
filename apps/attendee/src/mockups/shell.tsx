/**
 * DEVELOPMENT ONLY — the calm page every direction uses for acting (register, sign in, pass),
 * and Calm uses everywhere: the living Gathering field, the minimal top bar, one column.
 */
import { useState, type ReactNode } from "react";
import { GatheringField, type QuietZone } from "@synan/ui/mockups";
import { useDx } from "./frame";
import { MenuSheet, TopNav } from "./nav";

/** The centre column where the statement sits: the field drops to a quarter there. */
export const QUIET_CENTRE: QuietZone = { x: 0.22, y: 0.12, w: 0.56, h: 0.5, floor: 0.22 };
export const QUIET_NONE = undefined;

export function CalmPage({
  children,
  signedIn = false,
  current,
  quiet = QUIET_CENTRE,
  field = true,
  footer = true,
}: {
  children: ReactNode;
  signedIn?: boolean;
  current?: string;
  quiet?: QuietZone | undefined;
  /** The pass hides the field behind its code card on a phone; everything else keeps it. */
  field?: boolean;
  footer?: boolean;
}) {
  const dx = useDx();
  const [menu, setMenu] = useState(false);
  return (
    <>
      {field ? <GatheringField strength={dx.d === 1 ? 1 : 0.6} still={dx.still} quiet={quiet} mode={dx.m} /> : null}
      <div className="dx-above dxa-calm">
        <TopNav signedIn={signedIn} current={current} onMenu={() => setMenu(true)} />
        <main className="dxa-calm-main">{children}</main>
        {footer ? <CalmFooter /> : null}
      </div>
      {menu ? <MenuSheet onClose={() => setMenu(false)} /> : null}
    </>
  );
}

export function CalmFooter() {
  return (
    <footer className="dxa-foot">
      <span className="dx-meta dx-muted">Synan · events in Kampala</span>
      <span className="dx-meta dx-muted">Help · Privacy · Organisers</span>
    </footer>
  );
}
