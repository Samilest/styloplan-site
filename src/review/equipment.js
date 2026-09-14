// Equipment annotations — the short codes a floor plan puts next to a fixture
// rather than in the middle of a room.
//
// Why this list exists. The extraction is told to capture "room name + nominal
// size" pairs only, but a plan is covered in appliance callouts and the model
// sometimes promotes one to a room: "LAUNDRY STACKER" arrived as a room label,
// where it was sized and placed like a room name and ran a quarter of the way
// across the drawing. Deleting it lost real information from the plan. Picking
// it from here puts it back as what it is.
//
// Kept deliberately short. These are the callouts that carry information a
// buyer acts on (where the laundry goes, whether there is a dishwasher); the
// full vocabulary of a construction drawing does not belong on a marketing
// image. Codes are the conventional abbreviations, so they read correctly to
// anyone who has seen a floor plan.

export const EQUIPMENT_GROUPS = [
  {
    group: 'Kitchen',
    items: [
      { code: 'REF.', name: 'Refrigerator' },
      { code: 'D/W', name: 'Dishwasher' },
      { code: 'RANGE', name: 'Range / cooktop' },
      { code: 'M/W', name: 'Microwave' },
      { code: 'HOOD', name: 'Range hood' },
    ],
  },
  {
    group: 'Laundry',
    items: [
      { code: 'W/D', name: 'Washer / dryer' },
      { code: 'STACKED W/D', name: 'Stacked washer / dryer' },
      // Not plain "TUB": on a floor plan that reads as a bathtub.
      { code: 'LAUNDRY TUB', name: 'Laundry tub' },
    ],
  },
  {
    group: 'Mechanical',
    items: [
      { code: 'FURNACE', name: 'Furnace' },
      { code: 'H.W.T.', name: 'Hot water tank' },
      { code: 'HRV', name: 'Heat recovery ventilator' },
      { code: 'A/C', name: 'Air conditioning' },
      { code: 'PANEL', name: 'Electrical panel' },
      { code: 'SUMP', name: 'Sump pump' },
    ],
  },
  {
    group: 'Features',
    items: [
      // A fireplace and a skylight are selling features whose top-down symbol
      // is ambiguous — exactly the case where a callout earns its place.
      { code: 'F/P', name: 'Fireplace' },
      { code: 'SKYLIGHT', name: 'Skylight' },
      { code: 'SHELVING', name: 'Shelving' },
      { code: 'BENCH', name: 'Bench / seating' },
    ],
  },
];

// The sentinel the picker uses for "let me type my own". A curated list is
// always incomplete, and without this an unlisted annotation could only be
// added as a ROOM label — which inflates the enclosed-space count, the number
// four-point check #1 is about. So a free-text option is a correctness
// requirement, not a convenience.
export const CUSTOM_EQUIPMENT = '__custom__';
export const CUSTOM_PLACEHOLDER = 'NEW';

// Deliberately NOT here: bathroom fixtures (toilet, shower, vanity), kitchen
// sinks, closets and pantries. The first group is drawn as recognisable symbols
// by the styling model, so a callout would only add clutter; the second are
// enclosed spaces, which are ROOM labels and must stay countable as such.

/** Flat lookup, for validating a stored code. */
export const EQUIPMENT_CODES = new Set(
  EQUIPMENT_GROUPS.flatMap((g) => g.items.map((i) => i.code)));
