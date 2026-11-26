/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9f1', 100: '#dcf1df', 200: '#bde3c3', 300: '#8fcd99', 400: '#5cb06b',
          500: '#3a954d', 600: '#2b783d', 700: '#246033', 800: '#1f4c2b', 900: '#1b3f25'
        },
        turmeric: {
          50: '#fff9eb', 100: '#ffefc6', 200: '#ffdd88', 300: '#ffc84a',
          400: '#ffb220', 500: '#f99307', 600: '#dd6e02', 700: '#b74e06'
        },
        success: '#16a34a',
        warning: '#f59e0b',
        danger: '#dc2626',
        info: '#0284c7'
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '12px', control: '8px' },
      boxShadow: {
        card: '0 1px 3px rgb(15 23 42 / 0.08)',
        modal: '0 24px 60px rgb(15 23 42 / 0.22)'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(.98)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { to: { backgroundPosition: '-200% 0' } }
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 150ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
        shimmer: 'shimmer 1.5s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
