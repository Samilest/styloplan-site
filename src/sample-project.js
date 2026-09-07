// Sample project data — what the L1 extraction + L2 Review Station will
// eventually produce. Label x/y are NORMALIZED clear-area anchors relative
// to the plan image (0..1); dims are verbatim transcriptions.

export const sampleLabels = [
  { name: 'Living Room', dim: `15'-6" x 13'-0"`, x: 0.245, y: 0.27, size: 30 },
  { name: 'Kitchen',     dim: `11'-2" x 9'-8"`,  x: 0.555, y: 0.30, size: 26 },
  { name: 'Primary Bedroom', dim: `13'-0" x 11'-6"`, x: 0.795, y: 0.30, size: 26 },
  { name: 'Bedroom 2',   dim: `10'-0" x 9'-2"`,  x: 0.20,  y: 0.75, size: 26 },
  { name: 'Bath',        dim: `8'-0" x 5'-6"`,   x: 0.415, y: 0.75, size: 22 },
  { name: 'Dining',      dim: `10'-6" x 9'-0"`,  x: 0.795, y: 0.62, size: 26 },
];

// User-confirmed listing specs (L2 confirmation step). `confirmed: true` is
// what unlocks rendering — auto-counted suggestions never reach the canvas.
export const sampleSpecs = { beds: 2, baths: 1, sqft: 1240, confirmed: true };

export const sampleBrand = {
  companyName: 'Northgate Homes',
  tagline: 'Custom homes · Vancouver BC · northgatehomes.ca',
  font: 'Inter',            // one of the 6 shipped Google Fonts
  canvasBg: '#EDEAE3',      // matches the light-theme styled image background
  labelInk: '#2B2B2B',
  footerInk: '#2B2B2B',
  disclaimerOn: true,       // default ON (handoff L3)
  disclaimerText: null,     // null → DEFAULT_DISCLAIMER
  logo: null,               // filled at runtime with the mock logo canvas
};

export const sampleMeta = { title: 'Main Floor — The Geena' };
