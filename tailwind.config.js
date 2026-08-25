/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // One grotesque across both roles, separated by weight and tracking
        // rather than by family — a tool, not a brochure. Plex Mono holds every
        // column of times and counts.
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        card: 'var(--color-card)',
        'card-foreground': 'var(--color-card-foreground)',
        border: 'var(--color-border)',
        rule: 'var(--color-rule)',
        primary: 'var(--color-primary)',
        'primary-foreground': 'var(--color-primary-foreground)',
        accent: 'var(--color-accent)',
        'accent-foreground': 'var(--color-accent-foreground)',
        secondary: 'var(--color-secondary)',
        muted: 'var(--color-muted)',
        'muted-foreground': 'var(--color-muted-foreground)',

        free: 'var(--color-free)',
        'free-bg': 'var(--color-free-bg)',
        'free-border': 'var(--color-free-border)',

        requested: 'var(--color-requested)',
        'requested-bg': 'var(--color-requested-bg)',
        'requested-border': 'var(--color-requested-border)',

        taken: 'var(--color-taken)',
        'taken-bg': 'var(--color-taken-bg)',
        'taken-border': 'var(--color-taken-border)',

        blackout: 'var(--color-blackout)',
        'blackout-bg': 'var(--color-blackout-bg)',
        'blackout-border': 'var(--color-blackout-border)',
      },
      // Tighter than Tailwind's defaults across the board. Redefining the scale
      // sharpens every corner in the app without touching a single className.
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.1875rem',
        md: '0.25rem',
        lg: '0.3125rem',
        xl: '0.4375rem',
        tag: '0.1875rem',
      },
    },
  },
  plugins: [],
};
