/**
 * `@synan/mock/command` — the Admin Command mock backend. A separate entry so the
 * Attendee Portal and Scanner never bundle the operator-scale venues.
 */
export {
  createCommandMock,
  EventServer,
  type CommandApi,
  type CommandEvent,
  type CommandMock,
  type CommandMockOptions,
  type LiveSummary,
  type OperatorContext,
  type SummarySeries,
} from "./server";
export {
  buildVenue,
  isGridPolygon,
  isGridRect,
  type BuiltVenue,
  type GridPoint,
  type GridPolygon,
  type GridRect,
  type VenueKey,
  type VenueLayout,
} from "./venues";
export { CLOSED_EVENT, type ExportFormat, type ReportRow } from "./summary";
