/**
 * Tela de carga (rota `/sync`), Campo e Gestão. T-0059, a partir do teste de campo de 02/11:
 * - R-20261102-091336: a navegação depende do ESTADO do motor (`sincronizado_em` gravado e nada em andamento →
 *   `<Redirect href="/">`), não da promessa de `sincronizar()`; vale com a tela remontada e ao voltar do segundo plano.
 *   Com a carga pronta aparece também "Entrar no app" (rede de segurança). Se a carga já existia quando a tela abriu
 *   (ex.: entrar de novo com o mesmo usuário), o usuário entra na hora e a sincronização segue em segundo plano.
 * - R-20261102-090915: nenhum nome de módulo, entidade ou etapa; uma frase amigável por vez (perfil + módulos
 *   efetivos, `frasesDaCarga`); erro amigável com "Tentar de novo" (o detalhe técnico vai para o log e para o
 *   Diagnóstico do Perfil); raiz rolável respeitando as áreas seguras de cima e de baixo.
 * - R-20261102-090919 item 2: montar a tela (ou remontar) não reinicia a carga em andamento (`sincronizarSeNecessario`).
 * - ADR 0017 / `EstadoMotorSync.carga`: barra proporcional ao que já está gravado (páginas da entidade em andamento),
 *   frases do módulo que está sendo baixado (`carga.modulo`, nunca exibido), "Continuando de onde parou" na retomada e
 *   "Mantenha o app aberto" (a carga inicial só roda com o app aberto; fechou, continua de onde parou na volta).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Banner, Button, colors, firstName, ProgressBar, type as t } from '@macuxi/ui/mobile';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargaRetomada, percentualDaCarga, situacaoDaCarga } from '@/lib/carga';
import { AVISO_APP_ABERTO, FRASE_RETOMADA, frasesDaCarga, INTERVALO_FRASE_MS, mensagemDeErroDaCarga } from '@/lib/frases-carga';
import { usePlataforma } from '@/state/plataforma';

/** Uma frase por vez, trocando a cada ~3,5 s com transição suave (só enquanto a carga roda). */
function useFraseDaVez(frases: readonly string[], ativa: boolean): { frase: string; opacidade: Animated.Value } {
  const [i, setI] = useState(0);
  const opacidade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!ativa || frases.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(opacidade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setI((n) => (n + 1) % frases.length);
        Animated.timing(opacidade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
      });
    }, INTERVALO_FRASE_MS);
    return () => clearInterval(timer);
  }, [ativa, frases.length, opacidade]);
  return { frase: frases[i % Math.max(1, frases.length)] ?? '', opacidade };
}

export function TelaCarga() {
  const { sessao, sincronizar, sincronizarSeNecessario, offline, setOffline, logout, modulosAtivos, variante, perfil } = usePlataforma();
  const { estado } = useMotorSync();
  const insets = useSafeAreaInsets();
  /** A carga já estava gravada quando a tela abriu: não prende o usuário enquanto a sincronização roda. */
  const tinhaCarga = useRef(Boolean(estado.sincronizado_em)).current;
  const situacao = situacaoDaCarga(estado, { tinhaCarga });
  const moduloAtual = estado.carga?.modulo ?? null;
  const frases = useMemo(() => frasesDaCarga(variante, perfil, modulosAtivos, moduloAtual), [variante, perfil, modulosAtivos, moduloAtual]);
  const { frase, opacidade } = useFraseDaVez(frases, situacao === 'carregando');
  // re-render ao voltar do segundo plano: o <Redirect> roda de novo se a carga terminou com o app fora da tela
  const [, setVolta] = useState(0);

  useEffect(() => {
    if (!sessao) return;
    void sincronizarSeNecessario('tela-carga');
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setVolta((n) => n + 1);
    });
    return () => sub.remove();
  }, [sessao, sincronizarSeNecessario]);

  if (!sessao) return <Redirect href="/login" />;

  const pct = percentualDaCarga(estado, situacao);
  const retomada = cargaRetomada(estado, situacao);
  const rotulo = situacao === 'entrar' ? 'Pronto' : situacao === 'erro' ? 'Parou' : retomada ? FRASE_RETOMADA : 'Sincronizando';

  return (
    <>
      <ScrollView
        testID="tela-carga"
        style={styles.root}
        contentContainerStyle={[styles.conteudo, { paddingTop: Math.max(36, insets.top + 24), paddingBottom: Math.max(24, insets.bottom + 16) }]}>
        <View style={{ gap: 4 }}>
          <Text style={t.sub}>Olá, {firstName(sessao.user.name)}</Text>
          <Text style={t.h1} accessibilityRole="header">
            Preparando o app
          </Text>
          <Text style={t.sub}>Estamos deixando tudo pronto para funcionar mesmo sem sinal.</Text>
        </View>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={t.label} testID="carga-situacao">
              {rotulo}
            </Text>
            <Text style={[t.label, { color: colors.ink }]} testID="sync-pct" accessibilityLabel={`${pct} por cento`}>
              {pct}%
            </Text>
          </View>
          <ProgressBar pct={pct} />
        </View>

        {situacao === 'carregando' ? (
          <View style={{ gap: 12 }}>
            <View style={styles.cartao} accessibilityLiveRegion="polite">
              <Animated.Text testID="carga-frase" style={[t.body, styles.frase, { opacity: opacidade }]}>
                {frase}
              </Animated.Text>
            </View>
            <Banner icon="clock" tone="warning" testID="carga-app-aberto">
              {AVISO_APP_ABERTO}
            </Banner>
          </View>
        ) : null}

        {situacao === 'entrar' ? (
          <View style={{ gap: 10 }}>
            <Banner icon="check" tone="success" testID="carga-pronta">
              Tudo pronto! Seus dados estão no aparelho.
            </Banner>
            <Button testID="entrar-no-app" label="Entrar no app" variant="accent" height={52} onPress={() => router.replace('/')} />
          </View>
        ) : null}

        {situacao === 'erro' ? (
          <View style={{ gap: 10 }}>
            <Banner icon="alert" tone="danger" testID="carga-erro">
              {mensagemDeErroDaCarga(offline)}
            </Banner>
            {offline ? <Button testID="desligar-sem-sinal" label="Desligar modo sem sinal" variant="outline" onPress={() => void setOffline(false)} /> : null}
            <Button testID="tentar-de-novo" label="Tentar de novo" variant="accent" height={52} onPress={() => void sincronizar()} />
            <Button
              testID="trocar-usuario"
              label="Trocar usuário ou servidor"
              variant="outline"
              onPress={() => {
                void logout().then(() => router.replace('/login'));
              }}
            />
          </View>
        ) : null}
      </ScrollView>
      {situacao === 'entrar' ? <Redirect href="/" /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  conteudo: { flexGrow: 1, paddingHorizontal: 20, gap: 22 },
  cartao: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 16, minHeight: 76, justifyContent: 'center' },
  frase: { color: colors.ink, textAlign: 'center' },
});
