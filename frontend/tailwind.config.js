/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        'display': ['Outfit', 'sans-serif'],
        'body': ['Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fef3f2',
          100: '#fee4e2',
          200: '#fecdc9',
          300: '#fcaaa3',
          400: '#f77c6f',
          500: '#ed5545',
          600: '#d93c2a',
          700: '#b6301f',
          800: '#972b1d',
          900: '#7d291e',
          950: '#44110b',
        },
        dark: {
          50: '#1b1713',
          100: '#26211d',
          200: '#3a332d',
          300: '#4f463f',
          400: '#6b6158',
          500: '#8b8076',
          600: '#b3a79c',
          700: '#d6cec6',
          800: '#ebe5df',
          900: '#f7f3ef',
          950: '#fcfaf7',
        }
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
        'bounce-in': 'bounceIn 0.5s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        bounceIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '50%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' }
        }
      }
    },
  },
  plugins: [],
}
