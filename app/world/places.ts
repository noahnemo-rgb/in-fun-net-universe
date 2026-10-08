export type PlaceStatus = "open" | "next";

export type Place = {
  readonly id: string;
  readonly name: string;
  readonly status: PlaceStatus;
  readonly holds?: readonly string[];
  /** Angle around the fairground where a later place is named. */
  readonly signAngle?: number;
  readonly line: string;
};

/**
 * Add a place here. Open places are built. Next places are signs you can walk
 * to, with no interior, until a later pass builds them.
 */
export const places: readonly Place[] = [
  {
    id: "fairground",
    name: "Fairground",
    status: "open",
    holds: ["carnival", "fiesta", "party"],
    line: "The fairground is open.",
  },
  {
    id: "park",
    name: "Park",
    status: "next",
    signAngle: 2.6,
    line: "The park opens next.",
  },
  {
    id: "playground",
    name: "Playground",
    status: "next",
    signAngle: 0.55,
    line: "The playground opens next.",
  },
  {
    id: "learning-center",
    name: "Human potential learning center",
    status: "next",
    signAngle: -Math.PI / 2,
    line: "The human potential learning center opens next.",
  },
];

export type Peer = {
  readonly id: string;
  readonly kind: "ai" | "human";
  readonly name: string;
  readonly placeId: string;
  readonly present: boolean;
};

/** Beings already in the world. Append peers here; do not pretend a crowd. */
export const peers: readonly Peer[] = [
  { id: "rio", kind: "ai", name: "Rio", placeId: "fairground", present: true },
];

export const RIO = peers[0];
