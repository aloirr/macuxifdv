/**
 * Cartão "Minha RV" da tela Metas (T-0082; RN-CORE-29): valor projetado, faixa por indicador, gatilho e o texto
 * "No ritmo" / "Ainda não atingido". Lê só a cópia do aparelho (funciona sem rede) e mostra de quando é o cálculo.
 */
import { Banner, Cartao, ChipEstado, colors, EstadoVazio, fonts, ProgressBar, radius, type as t, useSincronizacao } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { avisoAoSincronizarRv, type LinhaMinhaRv } from '../lib/minha-rv';
import { useCore } from '../lib/usar-core';
import { useMinhaRv } from '../lib/usar-minha-rv';

export function CartaoMinhaRv() {
  const { visao, erro } = useMinhaRv();
  const core = useCore();
  const sync = useSincronizacao();
  const [avisoSemSinal, setAvisoSemSinal] = useState<string | null>(null);
  // sem sinal: não chama o motor, mostra o aviso padrão do botão Sincronizar e mantém o último cálculo
  const aoSincronizar = () => {
    const aviso = avisoAoSincronizarRv(sync?.semSinal ?? false);
    setAvisoSemSinal(aviso);
    if (!aviso) core.sincronizar();
  };
  const sincronizar = { rotulo: 'Sincronizar', onPress: aoSincronizar, testID: 'minha-rv-sincronizar' };
  const aviso = avisoSemSinal && sync?.semSinal ? <Banner testID="minha-rv-sem-sinal">{avisoSemSinal}</Banner> : null;
  if (erro) {
    return (
      <View style={{ gap: 6 }}>
        <EstadoVazio testID="minha-rv-erro" icone="alert" titulo="Não foi possível ler a sua RV" texto="Toque em Sincronizar. Se continuar, feche e abra o aplicativo." acao={sincronizar} />
        {aviso}
      </View>
    );
  }
  if (!visao) {
    return (
      <View testID="minha-rv-carregando" accessibilityLabel="Carregando a sua RV" style={styles.carregando}>
        <Text style={t.small}>Carregando a sua RV…</Text>
      </View>
    );
  }
  if (visao.tipo !== 'ok') {
    return (
      <View style={{ gap: 6 }} testID="minha-rv">
        <Text style={t.h2}>Minha RV</Text>
        <EstadoVazio testID={`minha-rv-${visao.tipo}`} icone="target" titulo={visao.titulo} texto={visao.texto} acao={visao.tipo === 'sem_calculo' ? sincronizar : undefined} />
        {visao.tipo === 'sem_calculo' ? aviso : null}
        {visao.tipo === 'sem_plano' ? <Text style={t.small}>Último cálculo recebido em {visao.calculado_em}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }} testID="minha-rv">
      <Text style={t.h2}>Minha RV</Text>
      <View style={styles.dark}>
        <Text style={styles.darkLabel}>{visao.rotulo}</Text>
        <Text style={styles.darkValue} testID="minha-rv-valor">
          {visao.valor}
        </Text>
        <ChipEstado texto={visao.estado} tom={visao.tom === 'sucesso' ? 'sucesso' : 'aviso'} testID="minha-rv-estado" />
        {visao.explicacao_estado ? <Text style={styles.darkLabel}>{visao.explicacao_estado}</Text> : null}
        {visao.aviso_gatilho ? (
          <Text style={styles.alerta} testID="minha-rv-gatilho">
            {visao.aviso_gatilho} {visao.bruta}.
          </Text>
        ) : null}
        <Text style={styles.darkLabel}>{visao.nota}</Text>
      </View>
      <Cartao preenchimento={0}>
        {visao.linhas.map((l, i) => (
          <Linha key={l.indicador} l={l} ultima={i === visao.linhas.length - 1} />
        ))}
      </Cartao>
      <Text style={[t.small, { textAlign: 'center' }]} testID="minha-rv-data">
        Último cálculo recebido em {visao.calculado_em}
      </Text>
    </View>
  );
}

function Linha({ l, ultima }: { l: LinhaMinhaRv; ultima: boolean }) {
  return (
    <View style={[styles.linha, !ultima && styles.divisor]} testID={`minha-rv-${l.indicador}`}>
      <View style={styles.topo}>
        <Text style={styles.nome}>{l.rotulo}</Text>
        <Text style={styles.pct}>{l.atingimento}</Text>
      </View>
      <ProgressBar pct={l.progresso_pct} color={l.tom === 'aviso' ? colors.danger : l.tom === 'sucesso' ? colors.accent : colors.lineStrong} />
      <Text style={t.small}>{l.detalhe}</Text>
      {l.gatilho_texto ? <Text style={[t.small, l.tom === 'aviso' && { color: colors.danger }]}>{l.gatilho_texto}</Text> : null}
      {!l.gatilho ? (
        <View style={styles.topo}>
          <Text style={[t.small, { flex: 1 }]}>{l.faixa}</Text>
          <Text style={styles.valor}>{l.valor}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  carregando: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  dark: { backgroundColor: colors.ink, borderRadius: radius.secao, padding: 18, gap: 8 },
  darkLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.darkMuted },
  darkValue: { fontFamily: fonts.display, fontSize: 34, color: colors.surface, fontVariant: ['tabular-nums'] },
  alerta: { fontFamily: fonts.body, fontSize: 13, color: colors.dangerOnDark },
  linha: { gap: 6, padding: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  nome: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, flex: 1 },
  pct: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  valor: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
});
