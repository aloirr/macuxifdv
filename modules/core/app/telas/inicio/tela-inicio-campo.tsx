/**
 * Início do Campo (T-0170; imagem `2026-11-12-T0170-final-inicio.png`). De cima para baixo: painel do topo (data · DU,
 * saudação, frase do dia, foto ou avatar), "Metas do mês" com o sino na linha e 4 cards, "Produtividade" com 6 indicadores e
 * a seta para a Performance, e o Sincronizar largo com "Últ. sincronização hh:mm". Só desenho: os textos e os tons saem de
 * `inicio-campo.ts` (puro, testado). O sino (com o balão), a barra de abas e as rotas são do shell: ele passa `sino`,
 * `onAbrirPerformance` e `onPerfil`. Alvos de toque >= 48 dp. Sem a foto no aparelho valem as iniciais.
 */
import { Button, Cartao, colors, fonts, Icon, initials, Pressionavel, ProgressBar, Screen, space, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useCore } from '../../lib/usar-core';
import type { CardMetaInicio, IndicadorInicio } from './inicio-campo';
import { useInicioCampo } from './usar-inicio-campo';

export interface PropsTelaInicioCampo {
  /** O sino com o balão (do shell); recebe o número de recados e tarefas novos (`useInicioCampo().sino.total`). */
  sino: (novos: number) => ReactNode;
  onAbrirPerformance: () => void;
  onPerfil: () => void;
  /** Avisos do shell logo abaixo do painel (ex.: módulo desativado com itens na fila). */
  avisos?: ReactNode;
}

export function TelaInicioCampo({ sino, onAbrirPerformance, onPerfil, avisos }: PropsTelaInicioCampo) {
  const core = useCore();
  const auto = useAtualizacaoAutomatica({ tz: core.tz });
  const v = useInicioCampo();
  if (!v) return null;
  return (
    <Screen testID="inicio" refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={{ flexGrow: 1 }}>
      <Pressionavel testID="abrir-perfil" accessibilityRole="button" accessibilityLabel={`${v.saudacao}. Abrir perfil`} onPress={onPerfil} style={s.painel}>
        <View style={s.painelTextos}>
          <Text style={s.data} testID="inicio.data">
            {v.data}
          </Text>
          <Text style={s.saudacao} testID="inicio.saudacao" numberOfLines={1}>
            {v.saudacao}
          </Text>
          {v.frase ? (
            <Text style={s.frase} testID="inicio.frase">
              “{v.frase}”
            </Text>
          ) : null}
        </View>
        <View style={s.avatar} testID="inicio.avatar" accessibilityLabel={`Foto de ${v.nome}`}>
          <Text style={s.iniciais}>{initials(v.nome)}</Text>
        </View>
      </Pressionavel>
      {avisos}

      <View style={s.linhaTitulo}>
        <Text style={t.h2} accessibilityRole="header">
          Metas do mês
        </Text>
        {sino(v.sino.total)}
      </View>
      <View style={s.grade}>
        {v.metas.map((c) => (
          <CartaoMeta key={c.indicador} c={c} />
        ))}
      </View>

      <Pressionavel testID="inicio.produtividade.abrir" accessibilityRole="button" accessibilityLabel="Produtividade. Abrir a Performance" onPress={onAbrirPerformance} style={s.linhaTitulo}>
        <Text style={t.h2} accessibilityRole="header">
          Produtividade
        </Text>
        <Icon name="chevron" size={22} color={colors.ink} />
      </Pressionavel>
      <Cartao testID="inicio.produtividade">
        <View style={s.gradeProd}>
          {v.produtividade.map((p, i) => (
            <IndicadorDoInicio key={p.indicador} p={p} divisor={i % 3 !== 0} />
          ))}
        </View>
      </Cartao>

      <View style={{ flex: 1, minHeight: 4 }} />
      <View style={s.linhaSinc}>
        <View style={{ flex: 1 }}>
          <Button testID="inicio-sincronizar" label="Sincronizar" icon="sync" variant="dark" height={52} loading={auto.puxando} onPress={auto.puxar} />
        </View>
        {v.ultimaSincronizacao ? (
          <Text style={[t.small, s.ultima]} testID="inicio.ultima-sincronizacao">
            {v.ultimaSincronizacao}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const leituraDaMeta = (c: CardMetaInicio): string =>
  [c.titulo, c.meta ? `${c.real} de ${c.meta}` : c.real, c.percentual ? `${c.percentual} da meta` : null, c.rodape ? `${c.rodape.rotulo} ${c.rodape.valor}` : null].filter(Boolean).join(', ');

function CartaoMeta({ c }: { c: CardMetaInicio }) {
  // MC-0010 no Início: barra de meta no laranja do gráfico (marca v1 §3); a situação fica no percentual (ink ou danger)
  const cor = c.tom === 'batida' ? colors.ink : colors.danger;
  return (
    <View style={s.celula} testID={`inicio.meta.${c.indicador}`} accessible accessibilityLabel={leituraDaMeta(c)}>
      <Cartao gap={space.sm} style={{ flex: 1 }}>
        <Text style={t.label} numberOfLines={1}>
          {c.titulo}
        </Text>
        <Text style={s.real} numberOfLines={1} adjustsFontSizeToFit>
          {c.real}
          {c.meta ? <Text style={s.meta}> / {c.meta}</Text> : null}
        </Text>
        {c.percentual ? (
          <View style={s.linhaBarra}>
            <View style={{ flex: 1 }}>
              <ProgressBar pct={c.barra * 100} color={colors.grafico} rotulo={`${c.titulo}: ${c.percentual} da meta`} />
            </View>
            <Text style={[s.percentual, { color: cor }]} importantForAccessibility="no">
              {c.percentual}
            </Text>
          </View>
        ) : null}
        {c.rodape ? (
          <View style={s.rodape}>
            <Text style={t.sub}>{c.rodape.rotulo}</Text>
            <Text style={s.valorRodape}>{c.rodape.valor}</Text>
          </View>
        ) : null}
      </Cartao>
    </View>
  );
}

function IndicadorDoInicio({ p, divisor }: { p: IndicadorInicio; divisor: boolean }) {
  const fora = p.ponto === 'fora';
  const leitura = [p.titulo, p.valor === '—' ? 'sem dado' : p.valor, p.ponto === 'dentro' ? 'dentro da meta' : fora ? 'fora da meta' : null].filter(Boolean).join(', ');
  return (
    <View style={[s.indicador, divisor && s.indicadorComDivisor]} accessible accessibilityLabel={leitura} testID={`inicio.produtividade.${p.indicador}`}>
      <Text style={t.sub} numberOfLines={1}>
        {p.titulo}
      </Text>
      <View style={s.linhaValor}>
        {p.ponto ? <View style={[s.ponto, { backgroundColor: fora ? colors.grafico : colors.success }]} /> : null}
        <Text style={s.valorIndicador}>{p.valor}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  painel: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.faixa, borderRadius: 24, padding: space.lg, minHeight: 140 },
  painelTextos: { flex: 1, gap: space.xs },
  data: { fontFamily: fonts.body, fontSize: 14, color: colors.faixaSub },
  saudacao: { fontFamily: fonts.display, fontSize: 28, color: colors.faixaTitulo },
  frase: { fontFamily: fonts.body, fontSize: 15, fontStyle: 'italic', color: colors.faixaSub },
  avatar: { width: 96, height: 128, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  iniciais: { fontFamily: fonts.display, fontSize: 32, color: colors.accentInk },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: space.md },
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs },
  celula: { width: '50%', padding: space.xs },
  real: { fontFamily: fonts.display, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
  meta: { fontFamily: fonts.body, fontSize: 18, color: colors.ink2 },
  linhaBarra: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  percentual: { fontFamily: fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  rodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valorRodape: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  gradeProd: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  indicador: { width: '33.333%', paddingHorizontal: space.sm, gap: space.xxs },
  indicadorComDivisor: { borderLeftWidth: 1, borderLeftColor: colors.line },
  linhaValor: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  ponto: { width: 8, height: 8, borderRadius: 4 },
  valorIndicador: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  linhaSinc: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ultima: { width: 96 },
});
