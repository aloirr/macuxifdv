/**
 * Painel "Indicadores do mês" (RF-CORE-08; RN-CORE-20..22): visitados, cobertura, positivação, meta × realizado e
 * necessidade diária, lidos do aparelho (funciona sem rede). Mesmos números do BKO: a conta é a do domínio.
 */
import { Cartao, colors, EstadoVazio, fonte, ProgressBar, type as t } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

import { textoDaLinha, textoNecessidadeDiaria } from '../lib/metas-formato';
import { usePainelMetas } from '../lib/usar-painel-metas';

export function PainelMetas() {
  const painel = usePainelMetas();
  if (!painel) return null;
  const i = painel.indicadores;
  return (
    <View style={{ gap: 10 }} testID="painel-metas">
      <Text style={t.h2}>Indicadores do mês</Text>
      <Cartao preenchimento={0}>
        <View style={styles.linha} testID="indicador-visitados">
          <Text style={styles.nome}>Visitados na rota</Text>
          <Text style={styles.valor}>
            {i.visitados} de {i.planejados}
          </Text>
        </View>
        <Text style={[t.small, { paddingHorizontal: 14, paddingBottom: 12 }]} testID="indicador-necessidade">
          {textoNecessidadeDiaria(i)}
        </Text>
      </Cartao>
      {painel.metas.length === 0 ? (
        <EstadoVazio testID="painel-metas-vazio" icone="target" titulo="Sem metas neste mês" texto="Seu gestor ainda não definiu as metas." />
      ) : (
        <Cartao preenchimento={0}>
          {painel.metas.map((m) => {
            const x = textoDaLinha(m);
            return (
              <View key={m.indicador} style={styles.meta} testID={`meta-${m.indicador}`}>
                <View style={styles.linha}>
                  <Text style={styles.nome}>{x.rotulo}</Text>
                  <Text style={styles.valor}>{x.atingimento}</Text>
                </View>
                <ProgressBar pct={(m.atingimento_pct ?? 0) / 100} color={colors.accent} />
                <Text style={t.small}>
                  {x.realizado} de {x.meta}
                </Text>
              </View>
            );
          })}
        </Cartao>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: 14 },
  meta: { gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  nome: { ...fonte.semibold, fontSize: 16, color: colors.ink, flex: 1 },
  valor: t.number,
});
