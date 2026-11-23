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
  SectionHead,
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
      <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
    </Link>
  );

  return (
    <div className="pb-8">
      <section aria-labelledby="cred-bands">
        <SectionHead id="cred-bands" title="Wristbands" meta="by state · stock is shared across the organisation's events" />
        <dl className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          {CARRIER_ORDER.map((state) => (
            <div key={state} className="flex min-w-0 flex-col gap-2 bg-background px-4 pt-3 pb-3">
              <dt className="truncate text-12 text-muted-foreground">{CARRIER_VIEW[state].label}</dt>
              <dd className={cn("font-mono text-40 leading-none tracking-tight tabular-nums", state === "lost" && data.by_state.lost > 0 && "text-warning")}>
                {formatNumber(data.by_state[state])}
              </dd>
              <dd className="text-12 text-muted-foreground">{CARRIER_VIEW[state].detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {issued === 0 ? (
        <Notice className="mx-4 mt-4 sm:mx-6">
          No passes are issued for this event yet. Each registration gets one when it is confirmed; bands are bound at the
          provisioning desk or at check-in.
        </Notice>
      ) : null}

      <div className="grid grid-cols-12 border-b border-border">
        <section aria-labelledby="cred-recent" className="col-span-12 min-w-0 xl:col-span-8">
          <SectionHead id="cred-recent" title="Recent band activity" meta={`times in the event's zone`} />
          {data.recent.length === 0 ? (
            <p className="px-4 py-6 text-13 text-muted-foreground sm:px-6">No band has been bound for this event yet.</p>
          ) : (
            <Table label="Recent band activity">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Band</Th>
                  <Th>Attendee</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((item, index) => (
                  <tr key={`${item.band_hint}:${item.at}:${index}`} className={rowClass}>
                    <Td className="font-mono text-12 whitespace-nowrap tabular-nums">{formatStamp(item.at, event.timezone)}</Td>
                    <Td className="font-mono text-12 tabular-nums">{item.band_hint}</Td>
                    <Td className="max-w-64 truncate">{item.attendee}</Td>
                    <Td className="whitespace-nowrap text-12">
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <p className="max-w-120 text-12 text-muted-foreground">
              {readOnly
                ? "The event is over: bands still bound to it are retired when they come back to stock."
                : "Bind a band to a registration, replace a lost one or import a batch in the provisioning console. Each change revokes the old band at every gate within a minute."}
            </p>
            {consoleLink}
          </div>
        </section>

        <aside className="col-span-12 min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <section aria-labelledby="cred-states">
            <SectionHead id="cred-states" title="Credentials" meta={<><span className="font-mono tabular-nums">{formatNumber(issued)}</span> issued in all</>} />
            <ul className="py-1">
              {CREDENTIAL_ORDER.map((state) => {
                const view = CREDENTIAL_VIEW[state];
                const n = data.credentials[state];
                return (
                  <li key={state} className="grid h-8 grid-cols-[auto_minmax(0,1fr)_auto_3.5rem] items-center gap-3 px-4 text-13">
                    <SignalShape state={n > 0 ? view.shape : "idle"} className={n > 0 ? view.tone : "text-muted-foreground"} />
                    <span>{view.label}</span>
                    <span className="font-mono text-12 tabular-nums">{formatNumber(n)}</span>
                    <span className="text-right font-mono text-11 text-muted-foreground tabular-nums">{issued > 0 ? formatPercent(n / issued) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="cred-chips" className="border-t border-border">
            <SectionHead id="cred-chips" title="Chip profiles" meta="bands bound to this event" />
            {chipTotal === 0 ? (
              <p className="px-4 py-3 text-13 text-muted-foreground">No bands bound yet.</p>
            ) : (
              <ul className="py-1">
                {chips.map(([profile, n]) => (
                  <li key={profile} className="grid h-8 grid-cols-[minmax(0,1fr)_4rem_auto] items-center gap-3 px-4 text-13">
                    <span className="truncate">{CHIP_PROFILE_LABEL[profile] ?? profile}</span>
                    <span aria-hidden="true" className="relative h-1 bg-border">
                      <span className="absolute inset-0 origin-left bg-foreground/60" style={{ transform: `scaleX(${n / chipTotal})` }} />
                    </span>
                    <span className="text-right font-mono text-12 tabular-nums">{formatNumber(n)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border px-4 py-3 text-12 text-muted-foreground">
              VIP and invitation bands are cryptographic (NTAG 424 DNA): a copied UID is refused. Ordinary and public bands are read by UID.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
