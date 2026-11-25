/** DEVELOPMENT ONLY — the attendee screens every direction mocks up. */
import type { ComponentType } from "react";
import Showcase from "./screens/showcase";
import EventPage from "./screens/event";
import Register from "./screens/register";
import Pass from "./screens/pass";
import SignIn from "./screens/sign-in";
import Menu from "./screens/menu";

export interface ScreenSpec {
  id: string;
  label: string;
  /** Shows event pictures: gets the photo / no-photo switch. */
  photo?: boolean;
  /** Light theme required for the owner's review. */
  light?: boolean;
  /** Best judged at phone width. */
  phone?: boolean;
  component: ComponentType;
}

export const SCREENS: ScreenSpec[] = [
  { id: "showcase", label: "Event showcase", photo: true, light: true, component: Showcase },
  { id: "event", label: "Event page", photo: true, light: true, component: EventPage },
  { id: "register", label: "Registration step", component: Register },
  { id: "pass", label: "Pass", light: true, component: Pass },
  { id: "sign-in", label: "Sign in", component: SignIn },
  { id: "menu", label: "Phone menu, open", phone: true, component: Menu },
];
