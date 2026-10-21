/* Shared Tailwind theme: used by tailwind.config.js for the production build
   and by the in-browser CDN fallback when assets/css/tailwind.css is missing (local dev). */
(function (theme) {
  if (typeof module !== 'undefined' && module.exports) module.exports = theme;
  else window.__TW_THEME__ = theme;
})({
  extend: {
    colors: {
      oa: {
        base: '#04060B',
        subtle: '#070B14',
        surface: '#0A101D',
        card: '#0C1322',
        hover: '#111A2E',
        border: '#1A2540',
        borderLight: '#24325A'
      },
      // The brand accent was historically written as `red-*` / `economist`
      // throughout the markup and app.js; both now resolve to the cobalt scale.
      red: {
        50: '#EEF5FF',
        100: '#D9E8FF',
        200: '#BCD6FF',
        300: '#8EBBFF',
        400: '#5B9BFF',
        500: '#3B7BFF',
        600: '#2F6BFF',
        700: '#2457E6',
        800: '#1C44B8',
        900: '#183A8F',
        950: '#0B1A45'
      },
      economist: {
        DEFAULT: '#2F6BFF',
        red: '#2F6BFF',
        dark: '#1D4ED8',
        glow: 'rgba(47, 107, 255, 0.4)'
      },
      tv: {
        green: '#089981',
        red: '#F23645',
        blue: '#2962FF',
        dark: '#131722',
        card: '#1E222D',
        border: '#2A2E39'
      },
      brand: {
        50: '#EFF6FF',
        100: '#DBEAFE',
        200: '#BFDBFE',
        300: '#93C5FD',
        400: '#60A5FA',
        500: '#3B82F6',
        600: '#2563EB',
        700: '#1D4ED8',
        800: '#1E40AF',
        900: '#1E3A8A'
      },
      slate: {
        850: '#0C1322',
        900: '#0A101D',
        950: '#04060B'
      }
    },
    fontFamily: {
      masthead: ['Space Grotesk', 'Inter', 'sans-serif'],
      serif: ['Space Grotesk', 'Inter', 'sans-serif'],
      sans: ['Inter', '-apple-system', 'sans-serif'],
      tv: ['Inter', '-apple-system', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
      tabular: ['JetBrains Mono', 'monospace']
    }
  }
});
