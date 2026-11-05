/**
 * RN-CORE-23 item 1: botão "Sincronizar" com "Última sincronização hh:mm · N na fila", sempre visível no Início e no
 * Perfil (Campo e Gestão). O shell (apps/mobile) monta o `SincronizacaoProvider` com o agendador único do app
 * (`criarAgendadorSync`, atualizacao.ts) e o estado do motor; o botão e o `useAtualizacaoAutomatica` das telas leem daqui.
 * O kit não depende do platform-sdk: o shell traduz o estado do motor para `ValorSincronizacao`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { AgendadorSync, EstadoAgendadorSync } from './atualizacao';
import { desenhoBotaoSincronizar } from './atualizacao';
import { ALTURA, colors, type as t } from './theme';
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

/**
 * Botão "Sincronizar" + "Última sincronização hh:mm · N na fila" (envio da fila + pull na hora, proteção de 30 s).
 * T-0076 (referência do Início aprovada no R-20261104-164000): botão de 52 dp na largura toda (é o único botão do Início)
 * e a linha de situação CENTRALIZADA logo abaixo. Sem sinal, o botão fica "Sem sinal" desabilitado e o motivo vai numa
 * linha própria, acima da situação. Vale para o Início e para o Perfil (mesmo componente, mesmo desenho).
 */
export function BotaoSincronizar({ testID = 'sincronizar', variant = 'dark' }: { testID?: string; variant?: 'dark' | 'outline' | 'accent' }) {
  const s = useSincronizacao();
  if (!s) return null;
  const ocupado = s.estado.puxando || s.sincronizando;
  const d = desenhoBotaoSincronizar({ semSinal: s.semSinal, recente: s.estado.recente, sincronizadoEm: s.sincronizadoEm, naFila: s.naFila, tz: s.tz });
  return (
    <View style={{ gap: 6 }} testID={`${testID}-bloco`}>
      <Button
        testID={testID}
        label={d.rotulo}
        accessibilityLabel={d.aviso ? `${d.rotulo}. ${d.aviso}` : undefined}
        icon="sync"
        variant={variant}
        height={ALTURA.principal}
        loading={ocupado}
        disabled={s.semSinal}
        onPress={() => void s.agendador.puxar()}
      />
      {d.aviso ? (
        <Text style={[t.small, { color: colors.warningInk, textAlign: 'center' }]} testID={`${testID}-sem-sinal`}>
          {d.aviso}
        </Text>
      ) : null}
      <Text style={[t.small, { color: colors.ink2, textAlign: 'center' }]} testID={`${testID}-situacao`} accessibilityLiveRegion="polite">
        {d.situacao}
      </Text>
    </View>
  );
}
