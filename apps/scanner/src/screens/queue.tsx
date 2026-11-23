import { Placeholder } from "./placeholder";

export default function Queue() {
  return (
    <Placeholder
      id="S4"
      title="Offline queue"
      purpose="Scans waiting to sync, the oldest one's age, Retry now, a warning when the allowlist is stale, the device clock offset, and any conflicts the server found after sync."
    />
  );
}
