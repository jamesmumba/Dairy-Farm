import { useColorScheme } from 'react-native';

// Text/background pairs meet WCAG AA (4.5:1) in both schemes.
const light = {
  background: '#FFFFFF',
  surface: '#F3F5F2',
  text: '#1B1F1C',
  textMuted: '#4A524C',
  primary: '#1F6B3A',
  onPrimary: '#FFFFFF',
  danger: '#B3261E',
  border: '#C5CCC6',
  // Chart marks: validated (lightness band, chroma, 3:1 vs surface) for each scheme.
  chart: '#1F6B3A',
};

const dark: typeof light = {
  background: '#121513',
  surface: '#1E2320',
  text: '#ECEFEC',
  textMuted: '#B4BCB6',
  primary: '#7FD39B',
  onPrimary: '#0B2614',
  danger: '#F2B8B5',
  border: '#3A423C',
  chart: '#3FA060',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 };

/** Minimum touch target (dp), per Android and iOS accessibility guidance. */
export const minTouch = 48;

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}
