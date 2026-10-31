/**
 * Sincronização inicial depois do login, com barra de progresso (copiada da Fase M).
 * As etapas deixaram de ser fixas (SYNC_STEPS do app-store): vêm do motor de sync — envio da fila,
 * entidades dos módulos efetivos e etapas de carga registradas pelos módulos (desenho T-0001 §13).
 */
import type { ModuloId } from '@macuxi/platform-sdk';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Banner, Button, colors, firstName, fonts, Icon, ProgressBar, type as t } from '@macuxi/ui/mobile';

import { shellDaVariante } from '@/lib/modulos';
import type { Variante } from '@/lib/variante';
import { usePlataforma } from '@/state/plataforma';

/** Entidades de pull e etapas de carga dos módulos efetivos, na ordem em que o motor roda. */
function etapasVisiveis(variante: Variante, modulos: readonly ModuloId[]) {
  const shell = shellDaVariante(variante);
  const ativos = new Set(modulos);
  return [
    ...shell.registroSync.entidadesAtivas(modulos, 'pull').map((e) => ({ key: `ent:${e.nome}`, label: e.nome })),
    { key: 'me', label: 'Seu perfil' },
    ...shell.etapasSync.filter((e) => ativos.has(e.modulo)).map((e) => ({ key: `etapa:${e.modulo}:${e.id}`, label: e.rotulo })),
  ];
}

export default function SyncScreen() {
  const { sessao: session, sincronizar: syncAll, offline, setOffline, logout, modulosAtivos, variante } = usePlataforma();
  const { estado } = useMotorSync();
  const sync = { running: estado.sincronizando, step: estado.etapa, progress: estado.progresso, error: estado.erro };
  const SYNC_STEPS = [
    { key: 'fila', label: 'Enviando a fila' },
    ...etapasVisiveis(variante, modulosAtivos),
  ];
  const insets = useSafeAreaInsets();
  const started = useRef(false);

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    void syncAll().then((ok) => {
      if (ok) router.replace('/');
    });
  }, [session, syncAll]);

  if (!session) return <Redirect href="/login" />;

  const currentIndex = sync.running ? SYNC_STEPS.findIndex((s) => s.label === sync.step) : sync.progress >= 1 ? SYNC_STEPS.length : -1;
  const pct = Math.round(sync.progress * 100);

  return (
    <View style={[styles.root, { paddingTop: Math.max(36, insets.top + 24) }]}>
      <View style={{ gap: 4 }}>
        <Text style={t.sub}>Olá, {firstName(session.user.name)}</Text>
        <Text style={t.h1}>Preparando o app</Text>
        <Text style={t.sub}>Baixando os dados dos seus módulos para funcionar mesmo sem sinal.</Text>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={t.label}>{sync.error ? 'Parou' : sync.running ? sync.step : 'Pronto'}</Text>
          <Text style={[t.label, { color: colors.ink }]} testID="sync-pct">
            {pct}%
          </Text>
        </View>
        <ProgressBar pct={pct} />
      </View>

      <View style={styles.list}>
        {SYNC_STEPS.map((s, i) => {
          const done = currentIndex > i || (!sync.running && sync.progress >= 1);
          const active = sync.running && currentIndex === i;
          return (
            <View key={s.key} style={styles.step} testID={`sync-etapa-${s.key}`}>
              <View style={[styles.dot, done ? styles.dotDone : active ? styles.dotActive : styles.dotIdle]}>
                {done ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={2.6} /> : null}
              </View>
              <Text style={[t.body, { color: done || active ? colors.ink : colors.ink2, fontFamily: active ? fonts.semibold : fonts.body }]}>{s.label}</Text>
            </View>
          );
        })}
      </View>

      {sync.error ? (
        <View style={{ gap: 10 }}>
          <Banner icon="alert" tone="danger">
            {sync.error}
          </Banner>
          {offline ? <Button label="Desligar modo sem sinal" variant="outline" onPress={() => void setOffline(false).then(() => syncAll().then((ok) => ok && router.replace('/')))} /> : null}
          <Button label="Tentar de novo" variant="accent" height={52} onPress={() => void syncAll().then((ok) => ok && router.replace('/'))} />
          <Button
            label="Trocar usuário ou servidor"
            variant="outline"
            onPress={() => {
              void logout().then(() => router.replace('/login'));
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground, paddingHorizontal: 20, gap: 22 },
  list: { gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  dot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.success },
  dotActive: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  dotIdle: { borderWidth: 2, borderColor: colors.lineStrong },
});
