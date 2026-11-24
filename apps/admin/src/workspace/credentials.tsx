/**
 * D6.5 · Credentials `/events/:id/credentials` (docs/06 §2.3; docs/01 §5). Where this event's
 * passes and wristbands stand: band inventory by state as large mono numerals, credentials by
 * state, chip profiles, and the latest band activity. Binding happens in the provisioning
 * console (D8); this tab links there.
 *
 * States: loading, error with retry, nothing issued yet.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { buttonClass, cn } from "@synan/ui/components";
import { SignalShape, formatNumber, formatPercent } from "@synan/ui/data";
import {
  ErrorState,
  LoadingState,
  Notice,
  SPLIT,
  SectionHead,
  TYPE,
  Table,
  Td,
  Th,
  formatStamp,
  rowClass,
  useDocumentTitle,
  useResource,
} from "../kit";
import { configure } from "../live/backend";
import { useWorkspaceEvent } from "./parts/context";
import { CARRIER_ORDER, CARRIER_VIEW, CHIP_PROFILE_LABEL, CREDENTIAL_ORDER, CREDENTIAL_VIEW } from "./parts/copy";
import { HEAD_BLEED, Meter, RAIL_ROW, RailNote } from "./parts/layout";

const ACTION_WORD = { bound: "Bound", replaced: "Replaced", revoked: "Revoked" } as const;

export default function WorkspaceCredentials() {
  const { event, readOnly } = useWorkspaceEvent();
  useDocumentTitle(`Credentials · ${event.title || "Untitled event"}`);
  const overview = useResource(() => configure.credentialOverview(event.id), [event.id]);

  if (overview.status === "loading") return <LoadingState label="Loading credentials…" rows={4} />;
  if (overview.status === "error") return <ErrorState title="Could not load the credentials" error={overview.error} onRetry={() => overview.reload()} />;

  const data = overview.data;
  const issued = CREDENTIAL_ORDER.reduce((sum, state) => sum + data.credentials[state], 0);
  const chips = Object.entries(data.by_chip_profile);
  const chipTotal = chips.reduce((sum, [, n]) => sum + n, 0);
  const consoleLink = (
    <Link to="/credentials" className={buttonClass("secondary", "compact")}>
      Open the provisioning console
      <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden="true" />
    </Link>
  );

  return (
    <div className="pb-10">
      <section aria-labelledby="cred-bands">
        <SectionHead id="cred-bands" title="Wristbands" meta="stock is shared across the organisation's events" className={HEAD_BLEED} />
        {/* Six cells; from 1280 the last two sit over the rail below, so the dividers continue its edge (SPLIT). */}
        <dl className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(2,minmax(10rem,12rem))] 2xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(2,13rem)]">
          {CARRIER_ORDER.map((state) => (
            <div key={state} className="flex min-w-0 flex-col gap-2 bg-background px-4 py-4 sm:px-6 2xl:px-8">
              <dt className="truncate text-13 text-muted-foreground">{CARRIER_VIEW[state].label}</dt>
              {/* One size across the strip: 40px once every cell has room for it (1440 up), 28px below. */}
              <dd
                className={cn(
                  "font-mono text-28 leading-none tracking-tight tabular-nums min-[90rem]:text-40",
                  state === "lost" && data.by_state.lost > 0 && "text-warning",
                )}
              >
                {formatNumber(data.by_state[state])}
              </dd>
              <dd className="text-12 leading-snug text-muted-foreground">{CARRIER_VIEW[state].detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {issued === 0 ? (
        <Notice className="mx-4 mt-4 sm:mx-6 2xl:mx-8">
          No passes are issued for this event yet. Each registration gets one when it is confirmed; bands are bound at the
          provisioning desk or at check-in.
        </Notice>
      ) : null}

      <div className={cn(SPLIT, "border-b border-border")}>
        <section aria-labelledby="cred-recent" className="flex min-w-0 flex-col">
          <SectionHead id="cred-recent" title="Recent band activity" meta="times in the event's zone" className={HEAD_BLEED} />
          {data.recent.length === 0 ? (
            <p className="px-4 py-8 text-13 text-muted-foreground sm:px-6 2xl:px-8">No band has been bound for this event yet.</p>
          ) : (
            <Table label="Recent band activity">
              <thead>
                <tr>
                  <Th fit>When</Th>
                  <Th fit>Band</Th>
                  <Th>Attendee</Th>
                  <Th fit>Action</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((item, index) => (
                  <tr key={`${item.band_hint}:${item.at}:${index}`} className={rowClass}>
                    <Td fit className={TYPE.value}>{formatStamp(item.at, event.timezone)}</Td>
                    <Td fit className={TYPE.value}>{item.band_hint}</Td>
                    <Td className="max-w-64 truncate">{item.attendee}</Td>
                    <Td fit>
                      <span className="inline-flex items-center gap-1.5">
                        <SignalShape state={item.action === "revoked" ? "stop" : item.action === "replaced" ? "warn" : "ok"} className={item.action === "revoked" ? "text-destructive" : item.action === "replaced" ? "text-warning" : "text-success"} />
                        {ACTION_WORD[item.action]}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border px-4 py-4 sm:px-6 2xl:px-8">
            <p className="max-w-[60ch] text-12 leading-relaxed text-muted-foreground">
              {readOnly
                ? "The event is over: bands still bound to it are retired when they come back to stock."
                : "Bind a band to a registration, replace a lost one or import a batch in the provisioning console. Each change revokes the old band at every gate within a minute."}
            </p>
            {consoleLink}
          </div>
        </section>

        <aside className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <section aria-labelledby="cred-states">
            <SectionHead id="cred-states" title="Credentials" meta={<><span className="font-mono tabular-nums">{formatNumber(issued)}</span> issued in all</>} />
            <ul className="py-1.5">
              {CREDENTIAL_ORDER.map((state) => {
                const view = CREDENTIAL_VIEW[state];
                const n = data.credentials[state];
                return (
                  <li
                    key={state}
                    className={cn(RAIL_ROW, "grid-cols-[auto_minmax(0,1fr)_4rem_4rem]")}
                    title={issued > 0 ? `${formatPercent(n / issued)} of issued` : undefined}
                  >
                    <SignalShape state={n > 0 ? view.shape : "idle"} className={n > 0 ? view.tone : "text-muted-foreground"} />
                    <span className={n > 0 ? undefined : "text-muted-foreground"}>{view.label}</span>
                    <Meter value={issued > 0 ? n / issued : 0} />
                    <span className={cn(TYPE.value, "text-right", n === 0 && "text-muted-foreground")}>{formatNumber(n)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="cred-chips" className="border-t border-border">
            <SectionHead id="cred-chips" title="Chip profiles" meta="bands bound to this event" />
            {chipTotal === 0 ? (
              <p className="px-4 py-4 text-13 text-muted-foreground sm:px-5">No bands bound yet.</p>
            ) : (
              <ul className="py-1.5">
                {chips.map(([profile, n]) => (
                  <li key={profile} className={cn(RAIL_ROW, "grid-cols-[minmax(0,1fr)_4rem_4rem]")}>
                    <span className="truncate">{CHIP_PROFILE_LABEL[profile] ?? profile}</span>
                    <Meter value={n / chipTotal} />
                    <span className={cn(TYPE.value, "text-right")}>{formatNumber(n)}</span>
                  </li>
                ))}
              </ul>
            )}
            <RailNote>
              VIP and invitation bands are cryptographic (NTAG 424 DNA): a copied UID is refused. Ordinary and public bands are read by UID.
            </RailNote>
          </section>
        </aside>
      </div>
    </div>
  );
}
