/**
 * DEVELOPMENT ONLY — `@synan/ui/mockups`: the design-direction mock-ups' shared parts.
 * Imported only from apps/attendee/src/mockups and apps/admin/src/mockups, which are reached
 * only through import.meta.env.DEV-guarded lazy routes. Delete once a direction is chosen.
 */
export {
  DIRECTIONS,
  directionById,
  parseDirection,
  parseMode,
  type Direction,
  type DirectionId,
  type DxMode,
  type RulesCard,
} from "./directions";
export { DirectionSwitcher, type SwitcherProps } from "./switcher";
export { GatheringField, SquareField, type QuietZone } from "./fields";
export { RewardTick, useReveal, Reveal } from "./parts";
export { GalleryView, CompareView, CompareCurrentView, Thumb, type GalleryScreen } from "./gallery";
