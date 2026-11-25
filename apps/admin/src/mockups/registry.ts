/** DEVELOPMENT ONLY — the admin screens every direction mocks up. */
import type { ComponentType } from "react";
import Command, { CommandAlert, Navigation } from "./screens/command";
import Events, { EventDialog } from "./screens/events";
import Attendees from "./screens/attendees";
import Desk from "./screens/desk";

export interface ScreenSpec {
  id: string;
  label: string;
  /** Light theme required for the owner's review. */
  light?: boolean;
  /** Best judged at phone width. */
  phone?: boolean;
  component: ComponentType;
}

export const SCREENS: ScreenSpec[] = [
  { id: "command", label: "Command Center, calm", light: true, component: Command },
  { id: "command-alert", label: "Command Center, alert", light: true, component: CommandAlert },
  { id: "events", label: "Events", component: Events },
  { id: "attendees", label: "Event workspace, Attendees", component: Attendees },
  { id: "desk", label: "Registration desk", component: Desk },
  { id: "nav", label: "Navigation, open", component: Navigation },
  { id: "dialog", label: "New event dialog", component: EventDialog },
];
