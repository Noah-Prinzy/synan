/**
 * Admin-specific inputs built on the shared controls: an event-local date-time field and a
 * time-zone picker. Both use the compact density and read their ids from a surrounding Field.
 */
import { useMemo } from "react";
import { Select, TextInput, type SelectOption } from "@synan/ui/components";
import { allTimeZones, fromLocalInput, toLocalInput, zoneLabel } from "./time";

/**
 * A date and time in a given zone. Holds an ISO instant; shows and edits wall time in `timeZone`.
 * The browser's own picker is themed dark through `color-scheme` (theme.css).
 */
export function DateTimeInput({
  value,
  onChange,
  timeZone,
  min,
  max,
  disabled,
  invalid,
  id,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  timeZone: string;
  min?: string | null;
  max?: string | null;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}) {
  return (
    <TextInput
      id={id}
      type="datetime-local"
      value={toLocalInput(value, timeZone)}
      min={min ? toLocalInput(min, timeZone) : undefined}
      max={max ? toLocalInput(max, timeZone) : undefined}
      disabled={disabled}
      invalid={invalid}
      onChange={(event) => onChange(event.target.value ? fromLocalInput(event.target.value, timeZone) : null)}
      className="font-mono tabular-nums [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
    />
  );
}

/** Every IANA zone, labelled with its offset, with type-ahead (type "kam" for Kampala). */
export function TimeZoneSelect({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string | null;
  onChange: (zone: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const options = useMemo<SelectOption[]>(() => {
    const now = Date.now();
    const list = allTimeZones();
    const withValue = value && !list.includes(value) ? [value, ...list] : list;
    return withValue.map((zone) => ({ value: zone, label: zone.replace(/_/g, " "), meta: zoneLabel(zone, now).split(" · ")[1] }));
  }, [value]);
  return (
    <Select
      options={options}
      value={value}
      onChange={onChange}
      placeholder="Choose a time zone"
      invalid={invalid}
      disabled={disabled}
      listMinWidth={280}
      renderValue={(option) => (
        <>
          {option.label} <span className="text-muted-foreground">· {option.meta}</span>
        </>
      )}
    />
  );
}
