/**
 * Layout raiz do shell mobile (copiado da Fase M). O AppStore monolítico da Fase M virou o estado de
 * plataforma (state/plataforma.tsx, motor de sync do platform-sdk — ADR 0003) e o `ShellProvider`
 * que as telas dos módulos usam (`@macuxi/platform-sdk/react`). As folhas de visita da Fase M voltam
 * como telas/extensões do core na B2.
 */
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ShellProvider } from '@macuxi/platform-sdk/react';
import type { VisaoShell } from '@macuxi/platform-sdk';
import { colors } from '@macuxi/ui/mobile';
import { registrarCameraNosModulos } from '@/services/camera';
import { PlataformaProvider, usePlataforma } from '@/state/plataforma';

void SplashScreen.preventAutoHideAsync().catch(() => {});
// câmera do aparelho para a foto da fachada do cliente fechado (RN-CORE-14): o Core só recebe a referência
registrarCameraNosModulos();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.ground, card: colors.surface, primary: colors.accent, text: colors.ink, border: colors.line } };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_500Medium,
  });
  const fontsReady = fontsLoaded || Boolean(fontError);
  return (
    <ThemeProvider value={theme}>
      <PlataformaProvider>
        <StatusBar style="dark" />
        <Gate fontsReady={fontsReady} />
      </PlataformaProvider>
    </ThemeProvider>
  );
}

/** Só renderiza as rotas depois de carregar fontes, sessão e fila do aparelho. */
function Gate({ fontsReady }: { fontsReady: boolean }) {
  const { ready, visao, motor, ambiente } = usePlataforma();
  const show = fontsReady && ready;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync().catch(() => {});
  }, [show]);
  if (!show) return null;
  return (
    <ShellProvider visao={visao as VisaoShell<unknown>} motor={motor} ambiente={ambiente}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="sync" />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </ShellProvider>
  );
}
