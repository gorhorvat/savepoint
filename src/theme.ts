import { createTheme, Paper, type MantineColorsTuple } from '@mantine/core';

// Accent: ember, the glow of a save point's bonfire. Used only for
// interactive elements, so it never competes with the platform data colours.
const ember: MantineColorsTuple = [
  '#fff4e2',
  '#ffe6bf',
  '#fdd08e',
  '#f9b85a',
  '#f2a33a',
  '#e08a1e',
  '#c4710c',
  '#a35c08',
  '#814805',
  '#5f3503',
];

// Dark mode: soot brown, like the room around the fire (index 8 is the page background).
const dark: MantineColorsTuple = [
  '#e6ddd1',
  '#c6baab',
  '#a5988a',
  '#83776b',
  '#5f5246',
  '#4d4035',
  '#3a3028',
  '#2f261f',
  '#241c16',
  '#1a1410',
];

export const theme = createTheme({
  primaryColor: 'ember',
  primaryShade: { light: 7, dark: 4 },
  // Dark text on the light ember in dark mode, white on the deep ember in light mode.
  autoContrast: true,
  colors: { ember, dark },
  fontFamily: '"Instrument Sans", system-ui, sans-serif',
  headings: {
    fontFamily: '"Unbounded", "Instrument Sans", sans-serif',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: 'clamp(1.6rem, 1.1rem + 2vw, 2.4rem)', lineHeight: '1.1' },
      h2: { fontSize: '1.35rem', lineHeight: '1.2' },
      h3: { fontSize: '1.05rem', lineHeight: '1.3' },
      h4: { fontSize: '0.95rem', lineHeight: '1.3' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '3px', sm: '6px', md: '10px', lg: '16px', xl: '24px' },
  cursorType: 'pointer',
  components: {
    Paper: Paper.extend({
      defaultProps: { withBorder: true, radius: 'lg' },
      styles: { root: { background: 'var(--sp-surface)', borderColor: 'var(--sp-line)' } },
    }),
  },
});
