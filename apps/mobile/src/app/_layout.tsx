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
import { colors, transicaoDeAvancar, useReduzirMovimento } from '@macuxi/ui/mobile';
import { AreaSeguraSuperior } from '@/components/area-segura';
import { SincronizacaoDoShell } from '@/components/sincronizacao-do-shell';
import { registrarCameraNosModulos } from '@/services/camera';
import { useVibracaoDoShell } from '@/services/vibracao';
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
  // T-0072: avançar lateral em 240 ms; com "reduzir movimento", troca instantânea (docs/design/componentes.md §6)
  const reduzir = useReduzirMovimento();
  // T-0072: vibração leve do kit (principal, confirmar e Desfazer); desligada com "reduzir movimento" (R-20261104-231036)
  useVibracaoDoShell(reduzir);
  const show = fontsReady && ready;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync().catch(() => {});
  }, [show]);
  if (!show) return null;
  return (
    <ShellProvider visao={visao as VisaoShell<unknown>} motor={motor} ambiente={ambiente}>
      {/* área segura superior para todas as telas, abas e empilhadas (R-20261102-111044, T-0064) */}
      {/* RN-CORE-23: botão Sincronizar, puxar para baixo e push usam o agendador único do app */}
      <SincronizacaoDoShell>
        <AreaSeguraSuperior>
          {/* login, carga e abas trocam sem deslizar (não é "avançar"); o perfil entra pela direita */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground }, ...transicaoDeAvancar(reduzir) }}>
            <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
            <Stack.Screen name="login" options={{ animation: 'none' }} />
            <Stack.Screen name="sync" options={{ animation: 'none' }} />
            <Stack.Screen name="profile" />
          </Stack>
        </AreaSeguraSuperior>
      </SincronizacaoDoShell>
    </ShellProvider>
  );
}
