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
  // Deep green headline cards (Home "today", the milking-round banner) and their text.
  hero: '#24583A',
  onHero: '#FFFFFF',
  heroMuted: '#E8F1E9',
  onDanger: '#FFFFFF', // text on a red badge
};

// Dark: the same pasture palette at night. Deep green-black surfaces, light pasture green for actions,
// headline cards stay deep green rather than turning into a bright block.
export const dark: typeof light = {
  background: '#0E1511',
  surface: '#18221C',
  text: '#E9EFEA',
  textMuted: '#A9B7AD',
  primary: '#86D0A0',
  primarySoft: '#1D3426',
  onPrimary: '#0C2416',
  danger: '#F4A79F',
  dangerSoft: '#3B1E1B',
  attention: '#E8C36E',
  attentionSoft: '#33290F',
  info: '#93C6DD',
  infoSoft: '#142832',
  border: '#2B3830',
  chart: '#5DB27D',
  hero: '#1F4A31',
  onHero: '#F2F7F3',
  heroMuted: '#BFDCC8',
  onDanger: '#2B0E0B',
};
