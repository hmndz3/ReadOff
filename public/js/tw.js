/* Tokens del design system "Nocturne Salon" (exportado de Stitch) */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'secondary-fixed-dim': '#3cddc7', 'on-primary-container': '#644000', 'outline-variant': '#524534',
        'primary-container': '#f5a623', error: '#ffb4ab', 'surface-container-high': '#272a31',
        'surface-dim': '#10131a', 'on-secondary': '#003731', 'on-background': '#e0e2ec',
        'surface-container-highest': '#32353c', 'primary-fixed': '#ffddb4', 'surface-container-low': '#191c23',
        'tertiary-fixed-dim': '#ffb951', 'secondary-container': '#03c6b2', 'surface-variant': '#32353c',
        'error-container': '#93000a', tertiary: '#ffc97e', 'on-tertiary': '#452b00', secondary: '#44e2cd',
        surface: '#10131a', 'on-primary': '#452b00', 'on-surface-variant': '#d7c3ae', outline: '#9f8e7a',
        'on-surface': '#e0e2ec', 'on-secondary-container': '#004d44', primary: '#ffc880',
        background: '#10131a', 'surface-container-lowest': '#0b0e15', 'surface-container': '#1d2027',
        'on-error-container': '#ffdad6', 'surface-tint': '#ffb955', 'primary-fixed-dim': '#ffb955',
        'surface-bright': '#363941', 'tertiary-container': '#eea93f',
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
