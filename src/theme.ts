import { ActionIcon, Badge, Button, Chip, createTheme, Paper, type MantineColorsTuple } from '@mantine/core';

// Accent: trophy gold, the console's selection highlight. Used for what you can
// act on and what's selected; colour otherwise comes from box art and platforms.
const gold: MantineColorsTuple = [
  '#fff8e1',
  '#ffefbf',
  '#ffe08a',
  '#ffd257',
  '#ffc53a',
  '#ffbd24',
  '#e6a400',
  '#b98200',
  '#8f6400',
  '#664700',
];

// Dark mode: night blue, the home screen behind the art (index 7 is the page).
const dark: MantineColorsTuple = [
  '#e8ecfa',
  '#c3c9e3',
  '#9aa2c6',
  '#7a83ad',
  '#4d5786',
  '#2a3460',
  '#1c2547',
  '#151c38',
  '#0e1328',
  '#090d1d',
];

export const theme = createTheme({
  primaryColor: 'gold',
  // Light enough in both schemes for dark text on gold buttons.
  primaryShade: { light: 5, dark: 4 },
  // Dark text on gold.
  autoContrast: true,
  luminanceThreshold: 0.45,
  colors: { gold, dark },
  fontFamily: '"Saira Variable", system-ui, sans-serif',
  headings: {
    fontFamily: '"Saira Variable", system-ui, sans-serif',
    fontWeight: '800',
    sizes: {
      h1: { fontSize: 'clamp(2rem, 1.4rem + 2.4vw, 3.25rem)', lineHeight: '1' },
      h2: { fontSize: '1.5rem', lineHeight: '1.15' },
      h3: { fontSize: '1.1rem', lineHeight: '1.25' },
      h4: { fontSize: '0.95rem', lineHeight: '1.3' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '8px', md: '12px', lg: '18px', xl: '28px' },
  cursorType: 'pointer',
  components: {
    // Dark text on gold (and white on dark colours) wherever a colour is filled in.
    Button: Button.extend({ defaultProps: { autoContrast: true } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { autoContrast: true } }),
    Badge: Badge.extend({ defaultProps: { autoContrast: true } }),
    Chip: Chip.extend({ defaultProps: { autoContrast: true } }),
    // Panels are only for forms and grouped controls: no outline, a quiet raised fill.
    Paper: Paper.extend({
      defaultProps: { withBorder: false, radius: 'lg' },
      styles: { root: { background: 'var(--sp-surface)' } },
    }),
  },
});
