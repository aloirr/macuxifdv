import localFont from 'next/font/local';

/**
 * Fontes do mockup (OFL), servidas pela própria web: o build não depende de baixar
 * do Google Fonts (bloqueado pelo proxy deste ambiente). Licenças em app/fonts/OFL-*.txt.
 */
export const archivo = localFont({
  src: [
    { path: './fonts/Archivo_600SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/Archivo_700Bold.ttf', weight: '700', style: 'normal' },
    { path: './fonts/Archivo_800ExtraBold.ttf', weight: '800', style: 'normal' },
  ],
  variable: '--font-archivo',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const plexSans = localFont({
  src: [
    { path: './fonts/IBMPlexSans_400Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSans_500Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSans_600SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSans_700Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const plexMono = localFont({
  src: [{ path: './fonts/IBMPlexMono_500Medium.ttf', weight: '500', style: 'normal' }],
  variable: '--font-plex-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});
