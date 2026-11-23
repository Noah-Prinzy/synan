/**
 * D3's dialogs: the publish review (a DiffView of the draft against the published layout, in
 * plain words), and the confirmations for deleting, discarding the draft and leaving with
 * unpublished changes. Local versions: the kit has no DiffView yet.
 */
import type { ReactNode } from "react";
import { ActionButton, Button, Dialog } from "@synan/ui/components";
import { Notice } from "../../kit";
import type { Change } from "./model";

const GROUPS: { kind: Change["kind"]; title: string; sign: string }[] = [
  { kind: "added", title: "Added", sign: "+" },
  { kind: "changed", title: "Changed", sign: "~" },
  { kind: "removed", title: "Removed", sign: "−" },
];

const TARGET_WORD: Record<Change["target"], string> = { floor: "Floor", zone: "Zone", room: "Room", order: "Order" };

/** Added / changed / removed, each item on one line with what changed about it. */
export function DiffView({ changes, onPick }: { changes: Change[]; onPick?: (change: Change) => void }) {
  if (changes.length === 0) return <p className="text-13 text-muted-foreground">Nothing has changed since the last publish.</p>;
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => {
        const items = changes.filter((c) => c.kind === group.kind);
        if (items.length === 0) return null;
        return (
          <section key={group.kind} aria-label={`${group.title}: ${items.length}`}>
            <h3 className="flex items-baseline justify-between border-b border-border pb-1 text-12 font-medium">
              {group.title}
              <span className="font-mono text-11 font-normal text-muted-foreground tabular-nums">{items.length}</span>
            </h3>
            <ul>
              {items.map((change) => (
                <li key={change.key} className="grid grid-cols-[1rem_3.25rem_minmax(0,1fr)] gap-x-2 border-b border-border py-1.5 text-13">
                  <span aria-hidden="true" className={`font-mono ${group.kind === "removed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {group.sign}
                  </span>
                  <span className="text-11 leading-5 text-muted-foreground">{TARGET_WORD[change.target]}</span>
                  <span className="min-w-0">
                    {onPick && change.select ? (
                      <button type="button" onClick={() => onPick(change)} className="text-left font-medium underline decoration-border underline-offset-4 hover:decoration-brand">
                        {change.name}
                      </button>
                    ) : (
                      <span className="font-medium">{change.name}</span>
                    )}
                    <span className="text-muted-foreground">: {change.details.join("; ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function PublishDialog({
  open,
  onClose,
  changes,
  version,
  liveEvents,
  problem,
  onPublish,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  changes: Change[];
  version: number;
  liveEvents: string[];
  /** A conflict or server refusal, shown above the summary. */
  problem: ReactNode;
  onPublish: () => Promise<void>;
  onPick: (change: Change) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title="Publish layout"
      description={
        version === 0
          ? "The first published layout for this venue. Gates and the Command Center use it from now on."
          : `Replaces version ${version}. Gates and the Command Center use the new layout as soon as it is published.`
      }
      footer={
        <>
          <Button size="compact" variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          <ActionButton action={onPublish} doneLabel="Published" reward keepDone variant="primary" size="compact" disabled={changes.length === 0}>
            Publish layout
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {problem}
        {liveEvents.length > 0 ? (
          <Notice tone="warning">
            {liveEvents.join(", ")} {liveEvents.length === 1 ? "is" : "are"} live here. Publishing changes the rooms gate staff and attendees are
            using right now.
          </Notice>
        ) : null}
        <p className="text-12 text-muted-foreground">
          <span className="font-mono text-foreground tabular-nums">{changes.length}</span> {changes.length === 1 ? "change" : "changes"} to publish.
          Rooms removed here also leave the events that used them.
        </p>
        <DiffView changes={changes} onPick={onPick} />
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      tone="danger"
      width="sm"
      footer={
        <>
          <Button size="compact" variant="secondary" onClick={onClose} autoFocus>
            {cancelLabel}
          </Button>
          <Button size="compact" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
