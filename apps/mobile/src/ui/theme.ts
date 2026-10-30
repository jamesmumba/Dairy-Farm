import { createContext, useContext } from 'react';
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

/** Follows the phone's light or dark setting. */
export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

/**
 * Card shadow in two layers, tinted green so it reads as depth rather than grey dirt: a tight one
 * that seats the card on the page, and a wide soft one that lifts it. The same on iOS and Android.
 */
export const shadow = {
  boxShadow: '0px 1px 2px rgba(23, 63, 43, 0.08), 0px 6px 16px -2px rgba(23, 63, 43, 0.10)',
};

/** For something small raised inside a card (the selected part of a switch). */
export const subtleShadow = { boxShadow: '0px 1px 3px rgba(23, 63, 43, 0.12)' };

/** For what floats above the page (the Add button): the same layers, stronger. */
export const raisedShadow = {
  boxShadow: '0px 2px 4px rgba(23, 63, 43, 0.14), 0px 10px 24px -4px rgba(23, 63, 43, 0.28)',
};

/**
 * Width of a summary card: two per row, or one per row on narrow phones and with large text
 * (the screen width measured in text-scaled points is what has to fit the figures).
 */
export function useCardBasis(): '47%' | '100%' {
  const { width, fontScale } = useWindowDimensions();
  return width / Math.max(1, fontScale) < 340 ? '100%' : '47%';
}

/** True inside a white card: fields there use the milk-white fill so they still stand out from the card. */
export const OnCard = createContext(false);

export function useFieldFill() {
  const t = useTheme();
  return useContext(OnCard) ? t.background : t.surface;
}
