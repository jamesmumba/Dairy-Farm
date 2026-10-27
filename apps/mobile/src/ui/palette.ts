// Light: the "milk white and pasture green" palette from docs/design.md.
// Text/background pairs meet WCAG AA (4.5:1); checked in test/accessibility.test.ts.
export const light = {
  background: '#FBFAF6', // milk-50
  surface: '#FFFFFF', // cards, sheets, text entry
  text: '#202A24', // ink-900
  textMuted: '#46534B', // ink-700
  primary: '#24583A', // green-800: primary buttons, active and selected states
  primarySoft: '#E8F1E9', // green-100: selected backgrounds, success panels
  onPrimary: '#FFFFFF',
  danger: '#A5322A', // red-700: urgent, overdue, blocking, destructive
  dangerSoft: '#F9E9E6', // red-100
  attention: '#805B12', // straw-700: upcoming, caution
  attentionSoft: '#FBF1D9', // straw-100
  info: '#356A83', // sky-700
  infoSoft: '#E8F1F5', // sky-100
  border: '#DCE3DC', // line-200
  // Chart marks: one validated hue per chart (lightness band, chroma, 3:1 vs surface).
  chart: '#34734B', // green-700
};

// Dark mode keeps its earlier palette until the dark design is done.
export const dark: typeof light = {
  background: '#121513',
  surface: '#1E2320',
  text: '#ECEFEC',
  textMuted: '#B4BCB6',
  primary: '#7FD39B',
  primarySoft: '#1C3324',
  onPrimary: '#0B2614',
  danger: '#F2B8B5',
  dangerSoft: '#3A1F1D',
  attention: '#F1CF7E',
  attentionSoft: '#3A2F15',
  info: '#9CCBE0',
  infoSoft: '#1A2C35',
  border: '#3A423C',
  chart: '#3FA060',
};
