/**
 * RN-CORE-23 item 1: botão "Sincronizar" com "Última sincronização hh:mm · N na fila", sempre visível no Início e no
 * Perfil (Campo e Gestão). O shell (apps/mobile) monta o `SincronizacaoProvider` com o agendador único do app
 * (`criarAgendadorSync`, atualizacao.ts) e o estado do motor; o botão e o `useAtualizacaoAutomatica` das telas leem daqui.
 * O kit não depende do platform-sdk: o shell traduz o estado do motor para `ValorSincronizacao`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AgendadorSync, EstadoAgendadorSync } from './atualizacao';
import { desenhoBotaoSincronizar, desenhoSeloAtualizacao } from './atualizacao';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { ALTURA, colors, fonts, type as t } from './theme';
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
 *
 * RD-0008 (T-0124): `avisoDados` = o aviso único de dado antigo do Início ("Dados de 06/11, 6h28", "Sincronize para ver as
 * vendas"), texto pronto do shell. Com ele, a linha de situação fica `⟳ {aviso} · N na fila` em `warningInk` (ícone sync de
 * 14, mesma linha, centralizada), testID `{testID}-aviso-dados` no texto; a linha continua `{testID}-situacao`. Sem ele
 * (null/undefined/vazio), nada muda. O Perfil não passa.
 */
export function BotaoSincronizar({
  testID = 'sincronizar',
  variant = 'dark',
  avisoDados,
}: {
  testID?: string;
  variant?: 'dark' | 'outline' | 'accent';
  /** RD-0008: aviso de dado antigo, já no fuso do tenant; troca "Última sincronização…" e mantém o "N na fila". */
  avisoDados?: string | null;
}) {
  const s = useSincronizacao();
  if (!s) return null;
  const ocupado = s.estado.puxando || s.sincronizando;
  const d = desenhoBotaoSincronizar({ semSinal: s.semSinal, recente: s.estado.recente, sincronizadoEm: s.sincronizadoEm, naFila: s.naFila, tz: s.tz, avisoDados });
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
      {d.tom === 'atencao' ? (
        <View style={styles.linhaAviso} testID={`${testID}-situacao`} accessible accessibilityLabel={d.situacao} accessibilityLiveRegion="polite">
          <Icon name="sync" size={14} color={colors.warningInk} />
          <Text style={[t.small, { color: colors.warningInk, fontFamily: fonts.semibold, flexShrink: 1, textAlign: 'center' }]} testID={`${testID}-aviso-dados`}>
            {d.situacao}
          </Text>
        </View>
      ) : (
        <Text style={[t.small, { color: colors.ink2, textAlign: 'center' }]} testID={`${testID}-situacao`} accessibilityLiveRegion="polite">
          {d.situacao}
        </Text>
      )}
    </View>
  );
}

/**
 * RD-0076 (T-0153): selo de sincronização do cabeçalho das listas, à direita do título (o "↻ 06:30" da imagem
 * `docs/design/telas/T-0153-inicio-pedidos.png`). É o ÚNICO lugar da tela que fala de sinal, servidor e hora da última
 * sincronização: substitui as faixas de sinal, o "Buscando o restante no servidor…" e o rodapé da lista. Textos e prioridade
 * em `desenhoSeloAtualizacao` (atualizacao.ts).
 *
 * Desenho: pílula de 32 dp (alvo de 44 dp com `hitSlop`), borda `line` e fundo `surface`; em atenção ("Sem sinal", "Sem
 * resposta"), fundo `warningBg` e texto `warningInk` semibold (contraste 9,6:1). Ícone de 14 + texto 13 em números tabulares.
 * O toque é o mesmo do puxar para baixo; com o modo sem sinal ligado, abre o Perfil (`onAbrirPerfil`, rota do shell).
 * Lê a hora e o modo sem sinal do `SincronizacaoProvider`; fora do shell usa `atualizadoEm`/`tz` das props.
 */
export function SeloAtualizacao({
  testID = 'selo-atualizacao',
  semRede = false,
  atualizando = false,
  semResposta = false,
  onSincronizar,
  onAbrirPerfil,
  atualizadoEm,
  tz,
  sobreFaixa = false,
}: {
  testID?: string;
  /** Aparelho sem rede (o modo sem sinal vem do provider). */
  semRede?: boolean;
  /** Consulta da tela em andamento (o puxar do provider já conta). */
  atualizando?: boolean;
  /** A consulta da tela falhou (o erro do motor vem pela tela, que conhece o estado do motor). */
  semResposta?: boolean;
  /** Mesmo efeito do puxar para baixo (a tela passa `auto.puxar` + nova tentativa da consulta). */
  onSincronizar: () => void;
  /** Modo sem sinal ligado: abre o Perfil. Sem ele, o toque tenta sincronizar. */
  onAbrirPerfil?: () => void;
  /** Hora da última sincronização, quando não há provider (testes de tela). */
  atualizadoEm?: number | string | null;
  tz?: string;
  /**
   * Dentro da faixa Azul noite (`CabecalhoTela`, T-0173): sem fundo, borda `faixaTrilho` e texto `faixaSub` (8,07:1). Em
   * atenção, a pílula âmbar de sempre.
   */
  sobreFaixa?: boolean;
}) {
  const s = useSincronizacao();
  const d = desenhoSeloAtualizacao({
    atualizadoEm: s ? s.sincronizadoEm : atualizadoEm,
    tz: tz ?? s?.tz,
    modoSemSinal: s?.semSinal ?? false,
    semRede,
    atualizando: atualizando || (s ? s.estado.puxando : false),
    semResposta,
  });
  const atencao = d.tom === 'atencao';
  const cor = atencao ? colors.warningInk : sobreFaixa ? colors.faixaSub : colors.ink2;
  const acao = d.acao === 'perfil' && !onAbrirPerfil ? 'sincronizar' : d.acao;
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={d.rotuloAcessivel}
      accessibilityHint={d.dica ?? undefined}
      accessibilityState={{ disabled: acao === 'nenhuma' }}
      accessibilityLiveRegion="polite"
      disabled={acao === 'nenhuma'}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={() => (acao === 'perfil' ? onAbrirPerfil?.() : onSincronizar())}
      style={[styles.selo, sobreFaixa && styles.seloFaixa, atencao && styles.seloAtencao]}>
      <Icon name={d.icone} size={14} color={cor} />
      <Text style={[t.small, styles.seloTexto, { color: cor }, atencao && { fontFamily: fonts.semibold }]} numberOfLines={1} testID={`${testID}-texto`}>
        {d.texto}
      </Text>
    </Pressionavel>
  );
}

const styles = StyleSheet.create({
  selo: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  seloFaixa: { borderColor: colors.faixaTrilho, backgroundColor: 'transparent' },
  seloAtencao: { borderColor: colors.warningBg, backgroundColor: colors.warningBg },
  seloTexto: { fontVariant: ['tabular-nums'] },
  linhaAviso: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 20 },
});
