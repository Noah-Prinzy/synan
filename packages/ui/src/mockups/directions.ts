/**
 * DEVELOPMENT ONLY — design-direction mock-ups (owner review, 2026-11-24).
 * Everything under packages/ui/src/mockups, apps/attendee/src/mockups and
 * apps/admin/src/mockups is throwaway (4 = "Chosen", the owner's pick, D-37): delete the three folders (and the two route lines and the
 * two package export lines) once a direction is chosen. Nothing here is used by a real screen.
 */

export type DirectionId = 1 | 2 | 3 | 4;
export type DxMode = "dark" | "light";

export interface RulesCard {
  surfaces: string;
  radii: string;
  separation: string;
  navigation: string;
  type: string;
  background: string;
  motion: string;
}

export interface Direction {
  id: DirectionId;
  key: "calm" | "stage" | "field" | "chosen";
  name: string;
  /** One line under the name. */
  tagline: string;
  /** What it feels like, where the references show up, what moves: a few plain sentences. */
  feels: string;
  references: string;
  moves: string;
  card: RulesCard;
  /** The admin's reading of the same direction (no animation in any direction). */
  admin: string;
}

export const DIRECTIONS: readonly Direction[] = [
  {
    id: 4,
    key: "chosen",
    name: "Chosen",
    tagline: "D-37: Calm site, Field event page, Field console. Square corners.",
    feels:
      "The owner's pick. The site is Calm: a dark (or daylight) room, one centred statement, generous space. One page is richer on purpose: the event page opens on the event's full-width picture with its name set large between sky and building, a glass card of key facts and a small rooms-now panel. The console is the Field instrument. Every corner is square; softness comes from space, tone and type, never from borders.",
    references:
      "Dark assistant everywhere on the site (Direction 1). The luxury stage only on the event page, read through Direction 3 (mono eyebrows, the live rooms panel). The developer instrument for the whole console (Direction 3). Rounded shapes from all three references are dropped.",
    moves:
      "Site: the slow Gathering field, also below the event page's picture so the two read as one place; opening an event morphs its picture from the card into the full-width hero and back (about 0.4 s; text only fades); the top bar lies clear over the picture and turns solid as soon as the page moves under it. Reduced motion: none of it. Console: nothing moves, not even the blue tick.",
    card: {
      surfaces:
        "Ground #0A0A0A / #F7F5F0. Panels are tonal steps: white at 4.5–8 % on dark; white with soft depth (no outline) on light. Glass (the ground at 80 % on dark, 84 % on light, frosted) only over the event picture; words on glass use the glass’s own tones, so they keep 4.5:1 over any photograph. Menus and dialogs opaque. No borders anywhere; a tonal step does every job a line used to.",
      radii:
        "Corners are square: 0 on frames, panels, cards, glass, image previews, buttons, inputs, chips, menus, dialogs, bars and tracks. Exceptions, round by nature: status dots (live, step and signal dots) and avatars (a person’s initials, round in both apps). No other radius was needed: focus rings, the QR card and thin meters work square.",
      separation:
        "Space first (8 px grid; 64–120 px between sections, 24–32 px inside a panel), then a tonal step, then type weight. Lists are rhythm, not rules. Buttons and chips are tonal blocks; the one filled action is ink.",
      navigation:
        "Site: one minimal top bar on every page (wordmark, two words, one action). On the event page the same bar lies clear over the picture and turns solid as soon as the page moves; its action becomes Register. Phone: a full-height menu with large words. Console: a full-width top bar with sections, the event switcher, live gate status and account; phone: bar plus menu sheet.",
      type:
        "Bricolage display for statements (56/40; the event name 64–184 px on the event page only), Instrument Sans for everything else (17 site, 14 console), Geist Mono for times, counts and ids. Eyebrows: sans on the site, mono capitals on the event page and in the console.",
      background:
        "Site: the Gathering field (points that gather in two slow crowds along the Fit seam), quiet under text, also under the event page below its picture. Event page: the picture, or the designed no-photo cover. Console: plain ground, a static dot grid under the venue map only.",
      motion:
        "Site: field at 24 fps max, paused when hidden; picture morph into and out of the event page; images fade in once; the blue reward tick. Nothing moves text; reduced motion is static. Console: no animation at all; the blue tick appears already drawn.",
    },
    admin:
      "Direction 3, square: a full-width top bar with live gate status, the four figures in one instrument strip, the venue map over a static dot grid, mono times and ids, no animation.",
  },
  {
    id: 1,
    key: "calm",
    name: "Calm",
    tagline: "Assistant-led. One quiet statement per screen.",
    feels:
      "Like opening a calm assistant: a dark room, one sentence in the middle, the thing you came for right under it. Nothing is boxed in; groups are held together by space and by soft tonal panels.",
    references:
      "The dark assistant is the base everywhere (centred statement, soft input-like search, almost no borders, a living background). The luxury site appears only as rounded image previews of events. The developer site does not appear.",
    moves:
      "Attendee side: a slow field of points that gather in two soft crowds along the Fit seam, about a minute to cross the screen; images fade in once. Admin: nothing moves.",
    card: {
      surfaces: "Ground #0A0A0A / #F7F5F0. Soft tonal panels: white at 4.5 % on dark, white cards lifted by soft depth on light. Menus and dialogs are opaque.",
      radii: "Controls and chips are pills. Panels 22 px. Image previews 24 px. Never square, never mixed in one group.",
      separation: "No ruled lines at all. Space first (8 px grid; 64–96 px between sections), then a tonal step, then type weight. Lists separate by rhythm, not rules.",
      navigation: "Attendee: a minimal top bar (wordmark, three words, one quiet pill). Phone: a menu sheet with large words. Admin: a slim icon rail with labels on hover and focus.",
      type: "One centred statement per screen in Bricolage 56/40 (phone 40/32), second line in the muted tone. Body 17 attendee, 14 admin. Mono only for times, counts and ids.",
      background: "Attendee: the Gathering field, points on a 24 px pitch that brighten where two slow crowds pass, ink and Daybreak. Never under text blocks at more than 10 %. Admin: plain ground.",
      motion: "One canvas, 24 fps cap, paused when hidden, still under reduced motion. Opacity-only entrances; text never moves. A blue tick on a completed action. Admin: none.",
    },
    admin:
      "A slim icon rail, one centred statement at the top of the Command Center (“All calm at Nexus Hall” or what needs you), four quiet figures without boxes, the map on one soft panel.",
  },
  {
    id: 2,
    key: "stage",
    name: "Stage",
    tagline: "Showcase-led. Events on stage, everything else calm.",
    feels:
      "The event showcase and the event page feel like a hospitality brand: the event's picture fills a rounded frame, its name is set very large and layered with the picture, and a small glass card carries the facts. As soon as you act (register, sign in, open your pass) the product turns calm again.",
    references:
      "The luxury site drives the showcase and the event page: rounded full-bleed frame, huge layered title, floating pill navigation with one action, glass info card, graceful reveals and a progress indicator. Registration, pass, sign-in and all of the admin use the dark assistant's calm.",
    moves:
      "Showcase and event page: pictures settle in once as they scroll into view (a 3 % scale and a fade; text only fades). Calm screens: the Gathering field, slower and fainter than in Calm. Admin: nothing moves.",
    card: {
      surfaces: "Showcase: the picture is the surface; facts sit on frosted glass (the ground at about two-thirds, frosted 18 px). Calm screens as Calm. Admin: soft panels inside one rounded stage.",
      radii: "Frame 32 px (phone 22). Panels 22. Controls are pills. Glass cards 22.",
      separation: "No ruled lines. On the stage: scale and layering (title, picture, glass). Elsewhere: space and tone, as Calm.",
      navigation: "A floating glass pill, top centre, with one filled action (Register on an event, My pass elsewhere). Phone: wordmark, the action and a menu button in one pill. Admin: a floating pill top bar with four sections.",
      type: "The event name at 96–184 px (phone 64), Bricolage 600, tight; captions in large thin capitals. Everything else as Calm.",
      background: "Showcase: the event picture; without one, a designed cover (Daybreak light, the date large). Calm screens: the Gathering field at 60 %.",
      motion: "Reveal once on scroll (pictures scale 1.03→1 and fade; text fades only), a thin scroll progress in the nav pill. Reduced motion: everything visible at once. Admin: none.",
    },
    admin:
      "A floating pill top bar instead of a rail, the work area set inside one large rounded stage, figures in soft cards, display type a step larger.",
  },
  {
    id: 3,
    key: "field",
    name: "Field",
    tagline: "Stage, plus a touch of the developer look.",
    feels:
      "Everything in Stage, with a faint instrument quality: a quiet field of soft squares behind the home that brightens a little where your pointer is, a small “live now” panel, and crisp mono details for times and counts.",
    references:
      "Luxury for the stage, dark assistant for the calm screens, and from the developer portfolio only three things, kept small: the responsive square field (home only), the live panel, and mono eyebrows.",
    moves:
      "Home: squares near the pointer brighten to about 10 % and fade back in half a second; nothing moves on its own; no effect on touch. Pictures reveal as in Stage. Admin: nothing moves.",
    card: {
      surfaces: "As Stage, with glass panels a touch more opaque so mono details stay crisp.",
      radii: "Tighter: frame 24 px, panels 16, controls 12. Reads more like an instrument than a hotel.",
      separation: "No ruled lines. Mono eyebrows and tabular figures do the job rules used to; a faint dot grid under maps only.",
      navigation: "As Stage. Admin: the pill top bar plus a small live status in it (gates online, last scan).",
      type: "As Stage; eyebrows, times, counts and ids in Geist Mono 12, capitals, 0.08 em tracking.",
      background: "Home: the square field (28 px pitch) around and below the frame. Calm screens: the Gathering field at 60 %. Admin: a static dot grid behind the map only.",
      motion: "Pointer-only on the home field (no idle motion), reveals as Stage, the reward tick. Reduced motion and touch: static. Admin: none.",
    },
    admin:
      "Stage's pill bar and rounded stage, plus mono figures, a static dot grid under the venue map and a small live panel for gates and scans.",
  },
] as const;

export const directionById = (id: DirectionId): Direction => DIRECTIONS.find((d) => d.id === id) ?? DIRECTIONS[0]!;

export function parseDirection(value: string | null): DirectionId {
  // No direction given: the owner's chosen design (D-37).
  return value === "1" ? 1 : value === "2" ? 2 : value === "3" ? 3 : 4;
}

export function parseMode(value: string | null): DxMode {
  return value === "light" ? "light" : "dark";
}
