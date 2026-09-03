/* Tokens del design system "Nocturne Salon" (exportado de Stitch).
   Los colores viven como variables RGB en /css/theme.css para soportar tema oscuro y claro. */
const tk = (name) => `rgb(var(--tk-${name}) / <alpha-value>)`;
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'secondary-fixed-dim': tk('secondary-fixed-dim'), 'on-primary-container': tk('on-primary-container'),
        'outline-variant': tk('outline-variant'), 'primary-container': tk('primary-container'),
        error: tk('error'), 'surface-container-high': tk('surface-container-high'),
        'surface-dim': tk('surface-dim'), 'on-secondary': tk('on-secondary'), 'on-background': tk('on-background'),
        'surface-container-highest': tk('surface-container-highest'), 'primary-fixed': tk('primary-fixed'),
        'surface-container-low': tk('surface-container-low'), 'tertiary-fixed-dim': tk('tertiary-fixed-dim'),
        'secondary-container': tk('secondary-container'), 'surface-variant': tk('surface-variant'),
        'error-container': tk('error-container'), tertiary: tk('tertiary'), 'on-tertiary': tk('on-tertiary'),
        secondary: tk('secondary'), surface: tk('surface'), 'on-primary': tk('on-primary'),
        'on-surface-variant': tk('on-surface-variant'), outline: tk('outline'), 'on-surface': tk('on-surface'),
        'on-secondary-container': tk('on-secondary-container'), primary: tk('primary'),
        background: tk('background'), 'surface-container-lowest': tk('surface-container-lowest'),
        'surface-container': tk('surface-container'), 'on-error-container': tk('on-error-container'),
        'surface-tint': tk('surface-tint'), 'primary-fixed-dim': tk('primary-fixed-dim'),
        'surface-bright': tk('surface-bright'), 'tertiary-container': tk('tertiary-container'),
      },
      borderRadius: { DEFAULT: '0.25rem', lg: '0.5rem', xl: '0.75rem', full: '9999px' },
      spacing: {
        'element-gap-sm': '0.5rem', 'margin-tablet': '2rem', 'element-gap-md': '0.75rem',
        'gutter-mobile': '1rem', 'stack-gap-xl': '2rem', 'gutter-tablet': '1.5rem',
        'card-padding-lg': '2.25rem', 'card-padding-md': '1.5rem', 'element-gap-lg': '1rem',
        'margin-mobile': '1rem', 'margin-desktop': '3rem', 'element-gap-xs': '0.25rem',
        'gutter-desktop': '2rem', 'card-padding-sm': '1rem',
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'headline-sm': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'display-hero-mobile': ['34px', { lineHeight: '42px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'display-hero': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'body-sm': ['13px', { lineHeight: '20px', fontWeight: '400' }],
        'stat-counter': ['24px', { lineHeight: '28px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-lg': ['28px', { lineHeight: '36px', fontWeight: '600' }],
        'body-md': ['15px', { lineHeight: '24px', fontWeight: '400' }],
        'headline-xl': ['36px', { lineHeight: '44px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'headline-md': ['22px', { lineHeight: '30px', fontWeight: '500' }],
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.03em', fontWeight: '600' }],
        'label-sm': ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '700' }],
      },
    },
  },
};
