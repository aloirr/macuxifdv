/**
 * RN-CORE-23 item 1: botão "Sincronizar" com "Última sincronização hh:mm · N na fila", sempre visível no Início e no
 * Perfil (Campo e Gestão). O shell (apps/mobile) monta o `SincronizacaoProvider` com o agendador único do app
 * (`criarAgendadorSync`, atualizacao.ts) e o estado do motor; o botão e o `useAtualizacaoAutomatica` das telas leem daqui.
 * O kit não depende do platform-sdk: o shell traduz o estado do motor para `ValorSincronizacao`.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { AgendadorSync, EstadoAgendadorSync } from './atualizacao';
import { desenhoBotaoSincronizar, desenhoSeloAtualizacao } from './atualizacao';
import { Icon } from './icon';
import { Pressionavel, useReduzirMovimento } from './movimento-rn';
import {
  ACAO_LEITOR_SYNC_COMPLETA,
  ANEL_SEGURAR,
  criarControleSegurar,
  desenhoSegurar,
  dicaDoSegurar,
  modoDoSegurar,
  ROTULO_ACESSIVEL_SYNC,
  TEXTOS_SYNC_COMPLETA,
  type ForcaVibracao,
  type ModoSegurar,
} from './sincronizacao-completa';
import { ALTURA, colors, fonts, type as t } from './theme';
import { Button } from './ui';

export interface ValorSincronizacao {
  agendador: AgendadorSync;
  /** Estado do agendador (puxando). */
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
  /** R-20261115-100000: segurar 10 s. Ausente = o botão não oferece o segurar (sem dica, sem ação do leitor). */
  sincronizarCompleta?: () => void;
  /** Vibração do segurar (o shell usa expo-haptics; o kit não depende dele). */
  vibrar?: (forca: ForcaVibracao) => void;
  /** Completa em andamento (popup aberto): o botão fica ocupado. */
  completaEmCurso?: boolean;
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
 * Botão "Sincronizar" + "Última sincronização hh:mm · N na fila" (envio da fila + pull na hora, no máximo 1 vez a cada 30 s).
 * T-0076 (referência do Início aprovada no R-20261104-164000): botão de 52 dp na largura toda (é o único botão do Início)
 * e a linha de situação CENTRALIZADA logo abaixo. Sem sinal, o botão fica "Sem sinal" desabilitado e o motivo vai numa
 * linha própria, acima da situação. Vale para o Início e para o Perfil (mesmo componente, mesmo desenho).
 *
 * RD-0008 (T-0124): `avisoDados` = o aviso único de dado antigo do Início ("Dados de 06/11, 6h28", "Sincronize para ver as
 * vendas"), texto pronto do shell. Com ele, a linha de situação fica `⟳ {aviso} · N na fila` em `warningInk` (ícone sync de
 * 14, mesma linha, centralizada), testID `{testID}-aviso-dados` no texto; a linha continua `{testID}-situacao`. Sem ele
 * (null/undefined/vazio), nada muda. O Perfil não passa.
 *
 * R-20261115-100000 (docs/design/sync-completa/spec.md): toque = parcial (`agendador.puxar()`, fila + pedidos e clientes).
 * Com `sincronizarCompleta` no provider, segurar 10 s = completa: depois de 500 ms o anel de 22 dp toma o lugar do ícone e o
 * rótulo conta "Continue segurando · N s"; vibra leve no início do anel e média aos 10 s, quando a completa dispara na hora
 * (mesmo com o dedo no botão). Soltar antes = toque normal. A linha `{testID}-dica` (abaixo da situação) diz que dá para
 * segurar. Leitor de tela: ação "Sincronização completa". Sem sinal ou ocupado: desabilitado, segurar nada faz.
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
  const reduzir = useReduzirMovimento();
  const [segurandoMs, setSegurandoMs] = useState<number | null>(null);
  const ocupado = Boolean(s && (s.estado.puxando || s.sincronizando || s.completaEmCurso));
  const modo: ModoSegurar = s ? modoDoSegurar({ temCompleta: Boolean(s.sincronizarCompleta), semSinal: s.semSinal, ocupado }) : 'nenhum';
  // o controle lê sempre o valor mais novo (o provider muda a cada passo do motor)
  const atual = useRef({ s, modo });
  atual.current = { s, modo };
  const controle = useMemo(
    () =>
      criarControleSegurar({
        modo: () => atual.current.modo,
        parcial: () => void atual.current.s?.agendador.puxar(),
        completa: () => atual.current.s?.sincronizarCompleta?.(),
        liberar: () => atual.current.s?.agendador.liberarManual() ?? false,
        vibrar: (forca) => atual.current.s?.vibrar?.(forca),
        aoMudar: setSegurandoMs,
        passoMs: reduzir ? 250 : 50,
      }),
    [reduzir],
  );
  useEffect(() => () => controle.desligar(), [controle]);
  useEffect(() => {
    if (modo !== 'segurar') controle.desligar();
  }, [modo, controle]);

  if (!s) return null;
  const d = desenhoBotaoSincronizar({ semSinal: s.semSinal, sincronizadoEm: s.sincronizadoEm, naFila: s.naFila, tz: s.tz, avisoDados });
  const g = desenhoSegurar(modo === 'segurar' ? segurandoMs : null, { reduzirMovimento: reduzir });
  const dica = dicaDoSegurar({ modo, segurando: g.anel });
  const oferece = modo === 'segurar';
  const rotuloAcessivel = d.aviso ? `${d.rotulo}. ${d.aviso}` : oferece ? ROTULO_ACESSIVEL_SYNC : undefined;
  return (
    <View style={{ gap: 6 }} testID={`${testID}-bloco`}>
      <Button
        testID={testID}
        label={g.rotulo ?? d.rotulo}
        accessibilityLabel={rotuloAcessivel}
        icon="sync"
        desenharIcone={g.anel ? (cor) => <AnelSegurar cor={cor} progresso={g.progresso} /> : undefined}
        variant={variant}
        height={ALTURA.principal}
        loading={ocupado}
        disabled={s.semSinal}
        onPressIn={() => controle.pressionar()}
        onPressOut={() => controle.soltar()}
        onPress={() => controle.tocar()}
        accessibilityActions={oferece ? [{ name: ACAO_LEITOR_SYNC_COMPLETA, label: TEXTOS_SYNC_COMPLETA.acao }] : undefined}
        onAccessibilityAction={oferece ? (e) => (e.nativeEvent.actionName === ACAO_LEITOR_SYNC_COMPLETA ? controle.acaoDoLeitor() : undefined) : undefined}
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
      {dica ? (
        <Text style={[t.small, { color: colors.ink2, textAlign: 'center' }]} testID={`${testID}-dica`}>
          {dica}
        </Text>
      ) : null}
    </View>
  );
}

/** Anel do segurar (22 dp, traço 3): trilho na cor do texto do botão a 30% e o progresso na cor cheia, a partir do topo. */
function AnelSegurar({ cor, progresso }: { cor: string; progresso: number }) {
  const { tamanho, traco, opacidadeTrilho } = ANEL_SEGURAR;
  const r = (tamanho - traco) / 2;
  const volta = 2 * Math.PI * r;
  const c = tamanho / 2;
  return (
    <Svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={c} cy={c} r={r} stroke={cor} strokeOpacity={opacidadeTrilho} strokeWidth={traco} fill="none" />
      <Circle
        cx={c}
        cy={c}
        r={r}
        stroke={cor}
        strokeWidth={traco}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${volta} ${volta}`}
        strokeDashoffset={volta * (1 - progresso)}
        transform={`rotate(-90 ${c} ${c})`}
      />
    </Svg>
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
