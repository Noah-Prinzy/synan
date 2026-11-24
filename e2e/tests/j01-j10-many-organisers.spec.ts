/**
 * Journeys 1 and 10 (docs/07 §2.6) need more than one organisation. The system has one until roadmap
 * step 5.2 (many organisers, D-26): there is no organiser sign-up, and every organiser sees the one
 * organisation. They are written down here so they are not forgotten, and become real tests in 5.2.
 */
import { test } from "@playwright/test";

test.fixme("J1: an organiser signs up and publishes a first event", async () => {
  // Needs 5.2: organiser sign-up (no endpoint or screen today) and a fresh organisation per sign-up.
  // Steps once it exists: sign up → verify email → enrol the second factor → D0 first-run setup
  // (venue, layout) → D5 wizard → publish → the event is on A1 Discover; the server lists one event
  // for the new organisation and none of the seed's.
});

test.fixme("J10: organiser B sees nothing of organiser A", async () => {
  // Needs 5.2: two organisations. Steps once it exists: A creates a venue, an event, attendees and an
  // alert; B signs in and sees none of them in D2, D4, D7, D9, D10 and the Command Center's switcher,
  // and every direct API read of A's ids answers 404 (not 403), as 03 §3 asks.
});
