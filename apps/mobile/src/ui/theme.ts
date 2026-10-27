import { useColorScheme, useWindowDimensions } from 'react-native';
import { dark, light } from './palette';

export type Theme = typeof light;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

/** Corner radii: cards and panels, inputs and buttons, chips. */
export const radius = { card: 16, control: 12, chip: 20 };

/** Type scale (pt). Weights stay at semibold or regular; system fonts (SF Pro, Roboto). */
export const type = {
  screenTitle: { fontSize: 28, fontWeight: '600' as const },
  sectionTitle: { fontSize: 19, fontWeight: '600' as const },
  cardTitle: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 16 },
  secondary: { fontSize: 14 },
  caption: { fontSize: 13, fontWeight: '500' as const },
  figure: { fontSize: 28, fontWeight: '600' as const },
};

/** Minimum touch target (dp), per Android and iOS accessibility guidance. */
export const minTouch = 48;

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

/**
 * Width of a summary card: two per row, or one per row on narrow phones and with large text
 * (the screen width measured in text-scaled points is what has to fit the figures).
 */
export function useCardBasis(): '47%' | '100%' {
  const { width, fontScale } = useWindowDimensions();
  return width / Math.max(1, fontScale) < 340 ? '100%' : '47%';
}
