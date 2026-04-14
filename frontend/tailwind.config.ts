import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panelSoft: 'var(--panel-soft)',
        text: 'var(--text)',
        textMuted: 'var(--text-muted)',
        accent: 'var(--accent)',
        borderGlow: 'var(--border)'
      },
      boxShadow: {
        neon: '0 0 calc(8px * var(--glow)) rgba(0,255,156,0.25), 0 0 calc(20px * var(--glow)) rgba(0,255,65,0.15)'
      },
      keyframes: {
        blink: {
          '0%, 48%': { opacity: '1' },
          '52%, 100%': { opacity: '0' }
        },
        flicker: {
          '0%, 100%': { opacity: '0.07' },
          '50%': { opacity: '0.1' }
        }
      },
      animation: {
        blink: 'blink 1.2s step-end infinite',
        flicker: 'flicker 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

export default config;
