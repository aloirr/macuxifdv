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
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';

import { ProvedorBloqueioDeSaida, ShellProvider } from '@macuxi/platform-sdk/react';
import type { VisaoShell } from '@macuxi/platform-sdk';
import { colors, ProvedorSaidaDaTela, transicaoDeAvancar, useReduzirMovimento } from '@macuxi/ui/mobile';
import { AreaSeguraSuperior } from '@/components/area-segura';
import { FolhaFotoPdv } from '@/components/folha-foto-pdv';
import { TelaErroArmazenamento } from '@/components/preparo-aparelho';
import { SincronizacaoDoShell } from '@/components/sincronizacao-do-shell';
import { TelaDeErroDaRaiz } from '@/components/tela-de-erro';
import { TelaEntrada } from '@/components/tela-entrada';
import { TelaPermissoes } from '@/components/tela-permissoes';
import { percentualDaPassagem } from '@/lib/armazenamento-aparelho';
import { ROTULO_ATUALIZANDO } from '@/lib/entrada';
import { registrarCameraNosModulos } from '@/services/camera';
import { useVibracaoDoShell } from '@/services/vibracao';
import { bloqueioDoShell } from '@/state/bloqueio-do-shell';
import { PlataformaProvider, usePlataforma } from '@/state/plataforma';

void SplashScreen.preventAutoHideAsync().catch(() => {});
// câmera do aparelho para a foto da fachada do cliente fechado (RN-CORE-14): o Core só recebe a referência
registrarCameraNosModulos();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.ground,
    card: colors.surface,
    primary: colors.accent,
    text: colors.ink,
    border: colors.line,
  },
};

/** Erro fora das telas de módulo (abertura, carga inicial, abas): tela de erro em vez de fechar o app (T-0140, relato de 08/11). */
export const ErrorBoundary = TelaDeErroDaRaiz;

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

/**
 * Só renderiza as rotas depois de carregar fontes, sessão e fila do aparelho. Até lá, a tela de entrada (T-0172): o mesmo
 * fundo e o mesmo logo da splash nativa, que some assim que o logo do JS está desenhado (sem corte). T-0088: a passagem
 * do AsyncStorage para o SQLite ("Atualizando o app", na tela de entrada) e a tela de erro do armazenamento ficam POR
 * CIMA, sem desmontar o roteador (o login que está esperando a abertura continua montado).
 */
function Gate({ fontsReady }: { fontsReady: boolean }) {
  const {
    ready,
    visao,
    motor,
    ambiente,
    preparo,
    erroArmazenamento,
    tentandoAbrir,
    tentarAbrirDeNovo,
    logout,
    telaPermissoes,
    permissoesLidas,
    pedindoPermissao,
    tocarBotaoPermissoes,
    variante,
  } = usePlataforma();
  // T-0072: avançar lateral em 240 ms; com "reduzir movimento", troca instantânea (docs/design/componentes.md §6)
  const reduzir = useReduzirMovimento();
  // T-0072: vibração leve do kit (principal, confirmar e Desfazer); desligada com "reduzir movimento" (R-20261104-231036)
  useVibracaoDoShell(reduzir);
  // T-0145: sem as permissões obrigatórias, só a tela de permissões (nada de login, carga ou abas por baixo)
  const semPermissao = fontsReady && permissoesLidas ? telaPermissoes : null;
  const show = fontsReady && ready && permissoesLidas;
  const sobre = !fontsReady || !permissoesLidas ? null : preparo ? (
    <TelaEntrada
      variante={variante}
      sobreposta
      testID="preparo-aparelho"
      barra={{ rotulo: ROTULO_ATUALIZANDO, pct: percentualDaPassagem(preparo.progresso) }}
    />
  ) : erroArmazenamento ? (
    <TelaErroArmazenamento
      detalhe={erroArmazenamento.detalhe}
      falhouDeNovo={erroArmazenamento.falhouDeNovo}
      tentando={tentandoAbrir}
      onTentar={() => void tentarAbrirDeNovo()}
      onSair={() => {
        void logout().then(() => {
          try {
            router.replace('/login');
          } catch {
            // roteador ainda não montado: sem sessão, as abas já levam ao login
          }
        });
      }}
    />
  ) : null;
  const esconderSplash = useCallback(() => void SplashScreen.hideAsync().catch(() => {}), []);
  const visivel = show || sobre !== null || semPermissao !== null;
  useEffect(() => {
    if (visivel) esconderSplash();
  }, [visivel, esconderSplash]);
  if (semPermissao) {
    return (
      <TelaPermissoes
        marca={Constants.expoConfig?.name ?? ''}
        tela={semPermissao}
        pedindo={pedindoPermissao}
        onBotao={() => void tocarBotaoPermissoes()}
      />
    );
  }
  if (!show) return sobre ?? <TelaEntrada variante={variante} sobreposta aoDesenhar={esconderSplash} nomeDoApp={Constants.expoConfig?.name} />;
  return (
    <ShellProvider visao={visao as VisaoShell<unknown>} motor={motor} ambiente={ambiente}>
      {/* RN-VEN-38 (T-0128): formulário alterado segura a barra inferior e o Voltar do Android (useBloquearSaida do SDK) */}
      <ProvedorBloqueioDeSaida value={bloqueioDoShell}>
        {/* T-0128: o `BackLink` do kit (cabeçalho das telas de módulo e do shell) também passa por `tentarSair` */}
        <ProvedorSaidaDaTela value={bloqueioDoShell}>
        {/* área segura superior para todas as telas, abas e empilhadas (R-20261102-111044, T-0064) */}
        {/* RN-CORE-23: botão Sincronizar, puxar para baixo e push usam o agendador único do app */}
        <SincronizacaoDoShell>
          {/* T-0088: com a tela de preparo ou de erro por cima, o TalkBack não alcança o login nem as abas por baixo
              (`accessibilityViewIsModal` da tela só vale no iOS) */}
          <View
            style={{ flex: 1 }}
            importantForAccessibility={sobre ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={sobre !== null}
          >
            <AreaSeguraSuperior>
              {/* login, carga e abas trocam sem deslizar (não é "avançar"); o perfil entra pela direita */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.ground },
                  ...transicaoDeAvancar(reduzir),
                }}
              >
                <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
                <Stack.Screen name="login" options={{ animation: 'none' }} />
                <Stack.Screen name="sync" options={{ animation: 'none' }} />
                <Stack.Screen name="profile" />
                {/* T-0147 / RD-0088: o visor de foto comum (foto do PDV, do produto) abre por cima, sem deslizar */}
                <Stack.Screen name="foto" options={{ animation: 'fade' }} />
              </Stack>
            </AreaSeguraSuperior>
          </View>
          {/* T-0147: folha "Tirar foto / Escolher da galeria" que o Core pede pela porta da captura da foto do PDV */}
          <FolhaFotoPdv />
          {sobre}
        </SincronizacaoDoShell>
        </ProvedorSaidaDaTela>
      </ProvedorBloqueioDeSaida>
    </ShellProvider>
  );
}
