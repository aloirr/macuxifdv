/**
 * Performance do app Campo (T-0170; desenho `docs/desenho/performance-produtividade.md` §2, §3 e §7; imagens
 * `2026-11-12-T0170-final-performance-resultados.png`, `-produtividade.png` e `-periodo.png`). Offline: os números saem das
 * funções do domain (N-A) sobre o que está no aparelho; período fora da janela vai ao servidor, com sinal.
 * Visual só com tokens e componentes de `@macuxi/ui/mobile` (marca v1 pelos tokens). Alvos de toque ≥ 48 dp.
 * A aba na barra e a rota são do shell (engenheiro-apps); esta tela é o componente que a rota monta.
 */
import { BotaoFiltro, Cartao, colors, Empty, fonts, FolhaPeriodo, formatHHMM, layout, ProgressBar, Screen, Segmentado, space, type as t, useAtualizacaoAutomatica, type TextosFolhaPeriodo } from '@macuxi/ui/mobile';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { dataLocal } from '../../../domain';
import { useCore } from '../../lib/usar-core';
import { cardsDeProdutividade, cardsDeResultados, leituraDoCardProdutividade, textoDosDiasUteis, type CardProdutividade, type CardResultado } from './cards-performance';
import { textoDaBase } from './performance-local';
import {
  AJUDA_FORA_DA_JANELA,
  ATALHO_PADRAO,
  ATALHOS_PERFORMANCE,
  atalhoEmVigor,
  contarFiltros,
  ehAtalhoPerformance,
  escolhaEmVigor,
  intervaloDaSelecao,
  mensagemDoServidor,
  rotuloDoPeriodo,
  SELECAO_PADRAO,
  type SelecaoPeriodo,
} from './periodo-performance';
import { usePerformance } from './usar-performance';

type Visao = 'resultados' | 'produtividade';

const OPCOES_VISAO = [
  { id: 'resultados' as const, rotulo: 'Resultados', testID: 'performance-resultados' },
  { id: 'produtividade' as const, rotulo: 'Produtividade', testID: 'performance-produtividade' },
];

/** Textos aprovados da folha (docs/design/pedidos-filtro-periodo.md §3). */
const TEXTOS_DA_FOLHA: TextosFolhaPeriodo = {
  titulo: 'Período',
  fechar: 'Fechar o filtro',
  escolher: 'Escolher dia, mês ou ano',
  voltar: 'Atalhos',
  dia: 'Dia',
  mes: 'Mês',
  ano: 'Ano',
  mesAnterior: 'Mês anterior',
  proximoMes: 'Próximo mês',
  anoAnterior: 'Ano anterior',
  proximoAno: 'Próximo ano',
  limpar: 'Limpar',
};

export function TelaPerformance() {
  const core = useCore();
  const tz = core.tz;
  const hoje = dataLocal(new Date(), tz);
  const [visao, setVisao] = useState<Visao>('resultados');
  const [selecao, setSelecao] = useState<SelecaoPeriodo>(SELECAO_PADRAO);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const intervalo = useMemo(() => intervaloDaSelecao(selecao, hoje), [selecao, hoje]);
  const perf = usePerformance(intervalo, { fuso: tz, hoje });
  // RN-CORE-23: puxar para baixo = Sincronizar (e nova tentativa da consulta fora da janela)
  const auto = useAtualizacaoAutomatica({ tz });
  const v = perf.visao;

  const resultados = useMemo(
    () => (v ? cardsDeResultados(v.resultados, { tipoMetaVenda: v.tipoMetaVenda, perfil: perf.perfil, umDia: intervalo.de === intervalo.ate }) : []),
    [v, perf.perfil, intervalo.de, intervalo.ate],
  );
  const produtividade = useMemo(() => (v ? cardsDeProdutividade(v.produtividade) : []), [v]);
  const base = v ? textoDaBase(v.baseEm, hoje, tz, (iso, fuso) => formatHHMM(iso, fuso)) : null;

  return (
    <Screen
      testID="performance.tela"
      refreshing={auto.puxando}
      onRefresh={() => {
        perf.tentarDeNovo();
        auto.puxar();
      }}>
      <View style={s.cabecalho}>
        <Text style={[t.h1, { flex: 1 }]} accessibilityRole="header">
          Performance
        </Text>
        <BotaoFiltro testID="performance-filtro" contagem={contarFiltros(selecao)} rotulo="Filtrar" onPress={() => setFolhaAberta(true)} />
      </View>

      <Segmentado testID="performance-visao" opcoes={OPCOES_VISAO} valor={visao} onChange={setVisao} rotuloAcessivel="Visão da Performance" />

      <View style={s.linhaPeriodo}>
        <Text style={t.sub} testID="performance-periodo">
          {rotuloDoPeriodo(selecao, hoje)}
        </Text>
        {v ? (
          <Text style={t.sub} testID="performance-dias-uteis">
            {textoDosDiasUteis(v.calendario, intervalo, hoje)}
          </Text>
        ) : null}
      </View>
      {base && visao === 'resultados' ? (
        <Text style={t.small} testID="performance-base">
          {base}
        </Text>
      ) : null}

      {perf.servidor ? (
        <Cartao testID="performance-servidor">
          <Empty text={mensagemDoServidor(perf.servidor)} />
        </Cartao>
      ) : visao === 'resultados' ? (
        <View style={{ gap: layout.entreBlocos }}>
          {resultados.map((c) => (
            <CartaoResultado key={c.indicador} c={c} />
          ))}
        </View>
      ) : (
        <View style={s.grade}>
          {produtividade.map((c) => (
            <CartaoProdutividade key={c.indicador} c={c} />
          ))}
        </View>
      )}

      <FolhaPeriodo
        testID="performance-folha"
        visivel={folhaAberta}
        onFechar={() => setFolhaAberta(false)}
        textos={TEXTOS_DA_FOLHA}
        atalhos={ATALHOS_PERFORMANCE}
        atalhoAtivo={atalhoEmVigor(selecao)}
        onAtalho={(id) => setSelecao({ tipo: 'atalho', id: ehAtalhoPerformance(id) ? id : ATALHO_PADRAO })}
        escolha={escolhaEmVigor(selecao)}
        onEscolher={(escolha) => setSelecao({ tipo: 'escolha', escolha })}
        onLimpar={() => setSelecao(SELECAO_PADRAO)}
        limparDesligado={contarFiltros(selecao) === 0}
        hoje={hoje}
        ajuda={perf.fora ? AJUDA_FORA_DA_JANELA : null}
      />
    </Screen>
  );
}

function CartaoResultado({ c }: { c: CardResultado }) {
  const corDoTom = c.tom === 'batida' ? colors.ink : colors.danger;
  return (
    <Cartao testID={`performance-resultado-${c.indicador}`} preenchimento={layout.secao} gap={space.md}>
      <View style={{ gap: space.xxs }}>
        <Text style={t.title16}>{c.titulo}</Text>
        <Text style={s.real} testID={`performance-resultado-${c.indicador}-valor`}>
          {c.real}
          {c.meta ? <Text style={s.meta}> / {c.meta}</Text> : null}
        </Text>
      </View>
      {c.atingimento ? (
        <View style={s.linhaBarra}>
          <View style={{ flex: 1 }}>
            <ProgressBar pct={c.barra * 100} color={c.tom === 'batida' ? colors.ink : colors.accent} rotulo={`${c.titulo}: ${c.atingimento} da meta`} />
          </View>
          <Text style={[s.percentual, { color: corDoTom }]} importantForAccessibility="no">
            {c.atingimento}
          </Text>
        </View>
      ) : null}
      {c.colunas.length > 0 ? (
        <View style={s.colunas}>
          {c.colunas.map((col, i) => (
            <View key={col.rotulo} style={[s.coluna, i > 0 && s.colunaComDivisor]} accessible accessibilityLabel={`${col.rotulo}: ${col.valor}`}>
              <Text style={t.sub}>{col.rotulo}</Text>
              <Text style={s.valorColuna}>{col.valor}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Cartao>
  );
}

function CartaoProdutividade({ c }: { c: CardProdutividade }) {
  const fora = c.ponto === 'fora';
  return (
    <View style={s.celula} accessible accessibilityLabel={leituraDoCardProdutividade(c)} testID={`performance-produtividade-${c.indicador}`}>
      <Cartao gap={space.xs} style={{ flex: 1 }}>
        <Text style={t.label} numberOfLines={1}>
          {c.titulo}
        </Text>
        <View style={s.linhaValor}>
          {c.ponto ? <View style={[s.ponto, { backgroundColor: fora ? colors.accent : colors.success }]} testID={`performance-produtividade-${c.indicador}-ponto`} /> : null}
          <Text style={[s.valorProdutividade, fora && { color: colors.accentInk }]}>{c.valor}</Text>
        </View>
        {c.meta ? <Text style={t.small}>{c.meta}</Text> : null}
      </Cartao>
    </View>
  );
}

const s = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  linhaPeriodo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  real: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, fontVariant: ['tabular-nums'] },
  meta: { fontFamily: fonts.body, fontSize: 24, color: colors.ink2 },
  linhaBarra: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  percentual: { fontFamily: fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  colunas: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.md },
  coluna: { flex: 1, gap: space.xxs },
  colunaComDivisor: { borderLeftWidth: 1, borderLeftColor: colors.line, paddingLeft: space.md },
  valorColuna: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  celula: { width: '50%', padding: space.xs },
  linhaValor: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ponto: { width: 10, height: 10, borderRadius: 5 },
  valorProdutividade: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, fontVariant: ['tabular-nums'] },
});
