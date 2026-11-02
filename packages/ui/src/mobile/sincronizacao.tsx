/**
 * RN-CORE-23 item 1: botão "Sincronizar" com "Última sincronização hh:mm · N na fila", sempre visível no Início e no
 * Perfil (Campo e Gestão). O shell (apps/mobile) monta o `SincronizacaoProvider` com o agendador único do app
 * (`criarAgendadorSync`, atualizacao.ts) e o estado do motor; o botão e o `useAtualizacaoAutomatica` das telas leem daqui.
 * O kit não depende do platform-sdk: o shell traduz o estado do motor para `ValorSincronizacao`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { AgendadorSync, EstadoAgendadorSync } from './atualizacao';
import { textoUltimaSincronizacao } from './atualizacao';
import { colors, type as t } from './theme';
import { Button } from './ui';

export interface ValorSincronizacao {
  agendador: AgendadorSync;
  /** Estado do agendador (puxando, "Atualizado há instantes"). */
  estado: EstadoAgendadorSync;
  /** `sincronizado_em` do motor (ISO) ou null. */
  sincronizadoEm: string | null;
  /** Itens na fila do aparelho (pendentes e com falha). */
  naFila: number;
  /** O motor está sincronizando (qualquer motivo). */
  sincronizando: boolean;
  /** Modo sem sinal ligado. */
  semSinal: boolean;
  /** Fuso do tenant (exibição da hora). */
  tz: string;
}

const Ctx = createContext<ValorSincronizacao | null>(null);

export function SincronizacaoProvider({ value, children }: { value: ValorSincronizacao | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Sincronização do app; `null` fora do shell (ex.: testes de tela, BKO). */
export function useSincronizacao(): ValorSincronizacao | null {
  return useContext(Ctx);
}

/** Botão "Sincronizar" + "Última sincronização hh:mm · N na fila" (envio da fila + pull na hora, proteção de 30 s). */
export function BotaoSincronizar({ testID = 'sincronizar', variant = 'dark' }: { testID?: string; variant?: 'dark' | 'outline' | 'accent' }) {
  const s = useSincronizacao();
  if (!s) return null;
  const ocupado = s.estado.puxando || s.sincronizando;
  return (
    <View style={{ gap: 6 }} testID={`${testID}-bloco`}>
      <Button
        testID={testID}
        label={s.semSinal ? 'Sem sinal: desligue o modo sem sinal para sincronizar' : 'Sincronizar'}
        icon="sync"
        variant={variant}
        loading={ocupado}
        disabled={s.semSinal}
        onPress={() => void s.agendador.puxar()}
      />
      <Text style={[t.small, { color: colors.ink2 }]} testID={`${testID}-situacao`} accessibilityLiveRegion="polite">
        {s.estado.recente ? 'Atualizado há instantes' : textoUltimaSincronizacao(s.sincronizadoEm, s.naFila, s.tz)}
      </Text>
    </View>
  );
}
