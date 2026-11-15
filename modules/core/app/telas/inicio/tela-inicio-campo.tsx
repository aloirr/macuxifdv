/**
 * Início do Campo (T-0170; R-20261114-145000). Coluna de altura cheia, sem rolagem no uso normal e responsiva (`escala-inicio.ts`: letra, espaços e alturas escalam pela janela e pela fonte do sistema): (a) painel do topo FIXO, Azul
 * noite de ponta a ponta (variação C, R-20261114-212000: foto de 72 dp à esquerda, ou as iniciais no mesmo tamanho; à direita a saudação, que encolhe até 0,75, com o sino na mesma linha, a data · DU e a frase), (b) o meio rolável só se preciso (Metas do mês e Produtividade, compactas, com o puxar
 * para atualizar) e (c) o Sincronizar FIXO no rodapé, fora da rolagem, com "Últ. sincronização" e a hora em 2 linhas. Só desenho: textos e tons
 * saem de `inicio-campo.ts` (puro, testado). O sino (com o balão), a barra de abas e as rotas são do shell: o sino vem do
 * `ProvedorSinoCabecalho` (o mesmo das outras telas); a prop `sino` só vale sem provedor. Alvos de toque >= 48 dp (`ALVO_TOQUE`).
 */
import { ALVO_TOQUE, Button, Cartao, colors, fonte, Icon, initials, layout, layoutCabecalho, Pressionavel, ProgressBar, radius, Screen, space, type as t, useAtualizacaoAutomatica, useSinoCabecalho } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCore } from '../../lib/usar-core';
import { type EscalaInicio, escalaInicio } from './escala-inicio';
import type { CardMetaInicio, IndicadorInicio } from './inicio-campo';
import { useInicioCampo } from './usar-inicio-campo';

const FONTES_DO_KIT = { saudacao: t.saudacao.fontSize, h2: t.h2.fontSize, label: t.label.fontSize, sub: t.sub.fontSize, ultima: t.small.fontSize };

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
  const janela = useWindowDimensions();
  const frase = v?.frase ?? undefined;
  const esc = useMemo(
    () => escalaInicio({ largura: janela.width, altura: janela.height, fontScale: janela.fontScale, topo: insets.top, base: insets.bottom, frase, kit: FONTES_DO_KIT }),
    [janela.width, janela.height, janela.fontScale, insets.top, insets.bottom, frase],
  );
  const s = useMemo(() => estilos(esc), [esc]);
  if (!v) return null;
  const sinoDoPainel = sinoDoCabecalho ?? sino?.(v.sino.total) ?? null;
  const pares = [v.metas.slice(0, 2), v.metas.slice(2, 4)].filter((p) => p.length > 0);
  return (
    <View style={s.raiz}>
      <View style={[layoutCabecalho(insets.top), s.painel]}>
        <View style={s.linhaTopo}>
          <Pressionavel testID="abrir-perfil" accessibilityRole="button" accessibilityLabel={`${v.saudacao}. Abrir perfil`} onPress={onPerfil} style={s.perfil}>
            <View style={s.avatar} testID="inicio.avatar" accessibilityLabel={`Foto de ${v.nome}`}>
              {v.foto ? <Image source={{ uri: v.foto }} resizeMode="cover" style={s.foto} testID="inicio.foto" /> : <Text style={s.iniciais}>{initials(v.nome)}</Text>}
            </View>
          </Pressionavel>
          <View style={s.textos}>
            <View style={s.linhaSaudacao}>
              <Pressionavel accessible={false} importantForAccessibility="no-hide-descendants" onPress={onPerfil} style={s.saudacaoBox}>
                <Text style={s.saudacao} testID="inicio.saudacao" numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.75}>
                  {v.saudacao}
                </Text>
              </Pressionavel>
              <View style={s.sinoBox}>{sinoDoPainel}</View>
            </View>
            <Pressionavel accessible={false} importantForAccessibility="no-hide-descendants" onPress={onPerfil} style={s.dataEFrase}>
              <Text style={s.data} testID="inicio.data" numberOfLines={2}>
                {v.data}
              </Text>
              {v.frase ? (
                <Text style={s.frase} testID="inicio.frase" numberOfLines={2}>
                  “{v.frase}”
                </Text>
              ) : null}
            </Pressionavel>
          </View>
        </View>
      </View>

      <Screen testID="inicio" top={0} gap={esc.meio.gap} refreshing={auto.puxando} onRefresh={auto.puxar} contentStyle={s.meio}>
        {avisos}
        <Text style={s.h2} accessibilityRole="header">
          Metas do mês
        </Text>
        <View style={s.grade}>
          {pares.map((par, i) => (
            <View key={i} style={s.parLinha}>
              {par.map((c) => (
                <CartaoMeta key={c.indicador} c={c} s={s} e={esc} />
              ))}
            </View>
          ))}
        </View>

        <Pressionavel testID="inicio.produtividade.abrir" accessibilityRole="button" accessibilityLabel="Produtividade. Abrir a Performance" hitSlop={{ top: 8, bottom: 8 }} onPress={onAbrirPerformance} style={s.linhaTitulo}>
          <Text style={s.h2} accessibilityRole="header">
            Produtividade
          </Text>
          <Icon name="chevron" size={22} color={colors.ink} />
        </Pressionavel>
        <Cartao testID="inicio.produtividade" preenchimento={esc.produtividade.preenchimento}>
          <View style={s.gradeProd}>
            {v.produtividade.map((p, i) => (
              <IndicadorDoInicio key={p.indicador} p={p} divisor={i % 3 !== 0} s={s} />
            ))}
          </View>
        </Cartao>
      </Screen>

      <View style={s.linhaSinc} testID="inicio.rodape">
        <View style={{ flex: 1 }}>
          <Button testID="inicio-sincronizar" label="Sincronizar" icon="sync" variant="dark" height={esc.rodape.botao} loading={auto.puxando} onPress={auto.puxar} />
        </View>
        {v.ultimaSincronizacao ? (
          <Text style={s.ultima} testID="inicio.ultima-sincronizacao" numberOfLines={2}>
            {v.ultimaSincronizacao}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const leituraDaMeta = (c: CardMetaInicio): string =>
  [c.titulo, c.meta ? `${c.real} de ${c.meta}` : c.real, c.percentual ? `${c.percentual} da meta` : null, c.rodape ? `${c.rodape.rotulo} ${c.rodape.valor}` : null].filter(Boolean).join(', ');

function CartaoMeta({ c, s, e }: { c: CardMetaInicio; s: Estilos; e: EscalaInicio }) {
  // MC-0016: barra de meta no Sol laranja #C2540A (colors.grafico); a situação fica no percentual, em ink ou danger
  const corDoTom = c.tom === 'batida' ? colors.ink : colors.danger;
  return (
    <View style={s.celula} testID={`inicio.meta.${c.indicador}`} accessible accessibilityLabel={leituraDaMeta(c)}>
      <Cartao gap={e.cartao.gap} preenchimento={e.cartao.preenchimento} style={{ flex: 1 }}>
        <View style={s.linhaBarra}>
          <Text style={s.rotuloMeta} numberOfLines={1}>
            {c.titulo}
          </Text>
          {c.percentual ? (
            <Text style={[s.percentual, { color: corDoTom }]} importantForAccessibility="no">
              {c.percentual}
            </Text>
          ) : null}
        </View>
        <View style={s.valores}>
          <Text style={s.real}>{c.real}</Text>
          {c.meta ? <Text style={s.meta}>/ {c.meta}</Text> : null}
        </View>
        {c.percentual ? <ProgressBar pct={c.barra * 100} color={colors.grafico} height={e.cartao.barra} rotulo={`${c.titulo}: ${c.percentual} da meta`} /> : null}
        {c.rodape ? (
          <View style={s.rodape}>
            <Text style={s.sub}>{c.rodape.rotulo}</Text>
            <Text style={s.valorRodape}>{c.rodape.valor}</Text>
          </View>
        ) : null}
      </Cartao>
    </View>
  );
}

function IndicadorDoInicio({ p, divisor, s }: { p: IndicadorInicio; divisor: boolean; s: Estilos }) {
  const fora = p.ponto === 'fora';
  const leitura = [p.titulo, p.valor === '—' ? 'sem dado' : p.valor, p.ponto === 'dentro' ? 'dentro da meta' : fora ? 'fora da meta' : null].filter(Boolean).join(', ');
  return (
    <View style={[s.indicador, divisor && s.indicadorComDivisor]} accessible accessibilityLabel={leitura} testID={`inicio.produtividade.${p.indicador}`}>
      <Text style={s.sub} numberOfLines={1}>
        {p.titulo}
      </Text>
      <View style={s.linhaValor}>
        {p.ponto ? <View style={[s.ponto, { backgroundColor: fora ? colors.grafico : colors.success }]} /> : null}
        <Text style={s.valorIndicador}>{p.valor}</Text>
      </View>
    </View>
  );
}

type Estilos = ReturnType<typeof estilos>;

/** Estilos do Início para uma escala (`escala-inicio.ts`): letra, espaços e alturas saem do fator que faz a tela caber. */
function estilos(e: EscalaInicio) {
  const f = e.fonte;
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: colors.ground },
    // Painel fixo, de ponta a ponta (quadro 8 de docs/marca/propostas/2026-11-12-entrada-sync): a faixa Azul noite do `CabecalhoTela`;
    // a área segura e o respiro de cima vêm só do `layoutCabecalho`
    painel: { paddingBottom: e.painel.paddingBottom, gap: e.painel.gap },
    // Variação C (docs/design/telas/inicio-cabecalho.md): foto à esquerda, textos à direita; o sino fica na linha da saudação
    linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    perfil: { minHeight: e.painel.avatar, minWidth: ALVO_TOQUE, justifyContent: 'center' },
    textos: { flex: 1, minWidth: 0, gap: e.painel.gap },
    // O sino (alvo de 48) sobe 10 e avança 12 no respiro do painel: só a saudação divide a linha com ele
    linhaSaudacao: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: -space.md },
    saudacaoBox: { flex: 1, minWidth: 0 },
    sinoBox: { marginVertical: -10 },
    dataEFrase: { gap: e.painel.gap },
    data: { ...fonte.body, fontSize: f.data, color: colors.faixaSub },
    saudacao: { ...fonte.bold, fontSize: f.saudacao, color: colors.faixaTitulo },
    frase: { ...fonte.body, fontSize: f.frase, fontStyle: 'italic', color: colors.faixaSub },
    avatar: { width: e.painel.avatar, height: e.painel.avatar, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.neutralBg, alignItems: 'center', justifyContent: 'center' },
    foto: { width: e.painel.avatar, height: e.painel.avatar },
    iniciais: { ...fonte.bold, fontSize: f.iniciais, color: colors.accentInk },
    meio: { paddingTop: e.meio.paddingTop, paddingBottom: e.meio.paddingBottom, flexGrow: 1 },
    h2: { ...t.h2, fontSize: f.h2 },
    linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: e.meio.linhaTitulo, gap: space.md },
    grade: { gap: e.meio.gap },
    parLinha: { flexDirection: 'row', flexGrow: 1, flexShrink: 0, maxHeight: e.cartao.alturaMaxima, gap: e.meio.gap },
    celula: { flex: 1 },
    // Realizado e meta quebram em 2 linhas quando não cabem na largura do cartão (nunca cortam o valor)
    valores: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.xs },
    rotuloMeta: { ...t.label, flex: 1, fontSize: f.label },
    real: { ...t.number, fontSize: f.real },
    meta: { ...fonte.body, fontSize: f.meta, color: colors.ink2 },
    linhaBarra: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    percentual: { ...fonte.bold, fontSize: f.percentual, fontVariant: ['tabular-nums'] },
    rodape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sub: { ...t.sub, fontSize: f.sub },
    valorRodape: { ...fonte.semibold, fontSize: f.valorRodape, color: colors.ink, fontVariant: ['tabular-nums'] },
    gradeProd: { flexDirection: 'row', flexWrap: 'wrap', rowGap: e.produtividade.gapLinhas },
    indicador: { width: '33.333%', paddingHorizontal: space.xs, gap: space.xxs },
    indicadorComDivisor: { borderLeftWidth: 1, borderLeftColor: colors.line },
    linhaValor: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    ponto: { width: 8, height: 8, borderRadius: 4 },
    valorIndicador: { ...t.number, fontSize: f.valorIndicador },
    linhaSinc: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.telaLateral, paddingTop: e.rodape.paddingTop, paddingBottom: e.rodape.paddingBottom, backgroundColor: colors.ground },
    // "Últ. sincronização" em cima e a hora embaixo, na largura do texto (sem largura fixa: não quebra com a fonte do sistema)
    ultima: { ...t.small, flexShrink: 0, fontSize: f.ultima },
  });
}
