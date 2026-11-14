/**
 * Início do Campo (T-0170; R-20261114-145000). Coluna de altura cheia, sem rolagem no uso normal: (a) painel do topo FIXO, Azul
 * noite de ponta a ponta (avatar pequeno, data · DU e o sino à direita, como o `CabecalhoTela`; saudação na largura inteira,
 * que encolhe para caber, e a frase), (b) o meio rolável só se preciso (Metas do mês e Produtividade, compactas, com o puxar
 * para atualizar) e (c) o Sincronizar FIXO no rodapé, fora da rolagem, com "Últ. sincronização hh:mm". Só desenho: textos e tons
 * saem de `inicio-campo.ts` (puro, testado). O sino (com o balão), a barra de abas e as rotas são do shell: o sino vem do
 * `ProvedorSinoCabecalho` (o mesmo das outras telas); a prop `sino` só vale sem provedor. Alvos de toque >= 48 dp.
 */
import { Button, Cartao, colors, fonts, Icon, initials, layout, layoutCabecalho, Pressionavel, ProgressBar, Screen, space, type as t, useAtualizacaoAutomatica, useSinoCabecalho } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCore } from '../../lib/usar-core';
import type { CardMetaInicio, IndicadorInicio } from './inicio-campo';
import { useInicioCampo } from './usar-inicio-campo';

export interface PropsTelaInicioCampo {
  /** Só para quem não tem o `ProvedorSinoCabecalho`: o sino com o balão (recebe `useInicioCampo().sino.total`). */
  sino?: (novos: number) => ReactNode;
  onAbrirPerformance: () => void;
  onPerfil: () => void;
  /** Avisos do shell logo abaixo do painel (ex.: módulo desativado com itens na fila). */
  avisos?: ReactNode;
}

export function TelaInicioCampo({ sino, onAbrirPerformance, onPerfil, avisos }: PropsTelaInicioCampo) {
  const core = useCore();
  const auto = useAtualizacaoAutomatica({ tz: core.tz });
  const v = useInicioCampo();
  const insets = useSafeAreaInsets();
  const sinoDoCabecalho = useSinoCabecalho();
  if (!v) return null;
  const sinoDoPainel = sinoDoCabecalho ?? sino?.(v.sino.total) ?? null;
  const pares = [v.metas.slice(0, 2), v.metas.slice(2, 4)].filter((p) => p.length > 0);
  return (
    <View style={s.raiz}>
      <View style={[layoutCabecalho(insets.top), s.painel]}>
        <View style={s.linhaTopo}>
          <Pressionavel testID="abrir-perfil" accessibilityRole="button" accessibilityLabel={`${v.saudacao}. Abrir perfil`} onPress={onPerfil} style={s.perfil}>
            <View style={s.avatar} testID="inicio.avatar" accessibilityLabel={`Foto de ${v.nome}`}>
              <Text style={s.iniciais}>{initials(v.nome)}</Text>
            </View>
            <Text style={s.data} testID="inicio.data" numberOfLines={2}>
              {v.data}
            </Text>
          </Pressionavel>
          {sinoDoPainel}
        </View>
        <Pressionavel accessibilityRole="button" accessibilityLabel={`${v.saudacao}. Abrir perfil`} onPress={onPerfil} style={s.textos}>
          <Text style={s.saudacao} testID="inicio.saudacao" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {v.saudacao}
          </Text>
          {v.frase ? (
            <Text style={s.frase} testID="inicio.frase" numberOfLines={2}>
              “{v.frase}”
            </Text>
          ) : null}
        </Pressionavel>
      </View>

      <Screen testID="inicio" top={0} gap={space.sm} refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={s.meio}>
        {avisos}
        <Text style={[t.h2, s.titulo]} accessibilityRole="header">
          Metas do mês
        </Text>
        <View style={s.grade}>
          {pares.map((par, i) => (
            <View key={i} style={s.parLinha}>
              {par.map((c) => (
                <CartaoMeta key={c.indicador} c={c} />
              ))}
            </View>
          ))}
        </View>

        <Pressionavel testID="inicio.produtividade.abrir" accessibilityRole="button" accessibilityLabel="Produtividade. Abrir a Performance" hitSlop={{ top: 8, bottom: 8 }} onPress={onAbrirPerformance} style={s.linhaTitulo}>
          <Text style={t.h2} accessibilityRole="header">
            Produtividade
          </Text>
          <Icon name="chevron" size={22} color={colors.ink} />
        </Pressionavel>
        <Cartao testID="inicio.produtividade" preenchimento={space.md}>
          <View style={s.gradeProd}>
            {v.produtividade.map((p, i) => (
              <IndicadorDoInicio key={p.indicador} p={p} divisor={i % 3 !== 0} />
            ))}
          </View>
        </Cartao>
      </Screen>

      <View style={s.linhaSinc} testID="inicio.rodape">
        <View style={{ flex: 1 }}>
          <Button testID="inicio-sincronizar" label="Sincronizar" icon="sync" variant="dark" height={52} loading={auto.puxando} onPress={auto.puxar} />
        </View>
        {v.ultimaSincronizacao ? (
          <Text style={[t.small, s.ultima]} testID="inicio.ultima-sincronizacao">
            {v.ultimaSincronizacao}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const leituraDaMeta = (c: CardMetaInicio): string =>
  [c.titulo, c.meta ? `${c.real} de ${c.meta}` : c.real, c.percentual ? `${c.percentual} da meta` : null, c.rodape ? `${c.rodape.rotulo} ${c.rodape.valor}` : null].filter(Boolean).join(', ');

function CartaoMeta({ c }: { c: CardMetaInicio }) {
  // MC-0016: barra de meta no Sol laranja #C2540A (colors.grafico); a situação fica no percentual, em ink ou danger
  const corDoTom = c.tom === 'batida' ? colors.ink : colors.danger;
  return (
    <View style={s.celula} testID={`inicio.meta.${c.indicador}`} accessible accessibilityLabel={leituraDaMeta(c)}>
      <Cartao gap={space.xs} preenchimento={space.md} style={{ flex: 1 }}>
        <View style={s.linhaBarra}>
          <Text style={[t.label, { flex: 1 }]} numberOfLines={1}>
            {c.titulo}
          </Text>
          {c.percentual ? (
            <Text style={[s.percentual, { color: corDoTom }]} importantForAccessibility="no">
              {c.percentual}
            </Text>
          ) : null}
        </View>
        <Text style={s.real} numberOfLines={1} adjustsFontSizeToFit>
          {c.real}
          {c.meta ? <Text style={s.meta}> / {c.meta}</Text> : null}
        </Text>
        {c.percentual ? <ProgressBar pct={c.barra * 100} color={colors.grafico} height={6} rotulo={`${c.titulo}: ${c.percentual} da meta`} /> : null}
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
  raiz: { flex: 1, backgroundColor: colors.ground },
  // Painel fixo, de ponta a ponta (quadro 8 de docs/marca/propostas/2026-11-12-entrada-sync): a faixa Azul noite do `CabecalhoTela`
  painel: { paddingBottom: space.lg, gap: space.xs },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  perfil: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  textos: { gap: space.xxs },
  data: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.faixaSub },
  saudacao: { fontFamily: fonts.display, fontSize: 24, color: colors.faixaTitulo },
  frase: { fontFamily: fonts.body, fontSize: 14, fontStyle: 'italic', color: colors.faixaSub },
  avatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  iniciais: { fontFamily: fonts.display, fontSize: 16, color: colors.accentInk },
  meio: { paddingTop: space.md, paddingBottom: space.sm, flexGrow: 1 },
  titulo: { minHeight: 24 },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32, gap: space.md },
  grade: { gap: space.sm },
  parLinha: { flexDirection: 'row', flexGrow: 1, flexShrink: 0, maxHeight: 132, gap: space.sm },
  celula: { flex: 1 },
  real: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
  meta: { fontFamily: fonts.body, fontSize: 16, color: colors.ink2 },
  linhaBarra: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  percentual: { fontFamily: fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  rodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valorRodape: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  gradeProd: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm },
  indicador: { width: '33.333%', paddingHorizontal: space.sm, gap: space.xxs },
  indicadorComDivisor: { borderLeftWidth: 1, borderLeftColor: colors.line },
  linhaValor: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  ponto: { width: 8, height: 8, borderRadius: 4 },
  valorIndicador: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  linhaSinc: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.telaLateral, paddingTop: space.sm, paddingBottom: space.md, backgroundColor: colors.ground },
  ultima: { width: 96 },
});
