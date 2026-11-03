/**
 * Ranking da equipe (RF-GES-03): indicador e período em chips (até 3 toques), posições já desempatadas pelo domain.
 * Online busca a API; offline mostra o último ranking guardado da mesma combinação.
 */
import { formatBRL0 } from '@macuxi/comum';
import { BackLink, Banner, Card, Chip, colors, Empty, Loading, Screen, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { INDICADORES_RANKING, PERIODOS_RANKING, type IndicadorRanking, type PeriodoRanking, type RankingEquipe } from '../../contracts';
import { INDICADOR_ROTULO, PERIODO_ROTULO, valorDoIndicador } from '../lib/apresentacao';
import { CAMINHO_EQUIPE } from '../rotas';
import { useGestor } from '../state/use-gestor';

export default function RankingScreen() {
  const g = useGestor();
  const [indicador, setIndicador] = useState<IndicadorRanking>('vendas_cents');
  const [periodo, setPeriodo] = useState<PeriodoRanking>('mensal');
  const [r, setR] = useState<{ ranking: RankingEquipe | null; erro: string | null } | null>(null);
  useEffect(() => {
    if (!g.carregado) return;
    setR(null);
    void g.ranking(indicador, periodo).then(setR);
  }, [g.carregado, g.ranking, indicador, periodo]);

  return (
    <Screen testID="gestor-ranking">
      <BackLink label="Equipe" fallback={`/m/${CAMINHO_EQUIPE}`} />
      <Text style={t.h1}>Ranking</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsConteudo}>
        {PERIODOS_RANKING.map((p) => (
          <Chip key={p} testID={`ranking-periodo-${p}`} label={PERIODO_ROTULO[p]} active={p === periodo} onPress={() => setPeriodo(p)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsConteudo}>
        {INDICADORES_RANKING.map((i) => (
          <Chip key={i} testID={`ranking-indicador-${i}`} label={INDICADOR_ROTULO[i]} active={i === indicador} onPress={() => setIndicador(i)} />
        ))}
      </ScrollView>
      {g.offline ? <Banner>Sem conexão: mostrando o último ranking guardado no aparelho.</Banner> : null}
      {r?.erro ? <Banner tone="danger">{r.erro}</Banner> : null}
      {!r ? <Loading /> : null}
      {r && !r.ranking ? <Empty text="Sem ranking guardado para esta combinação. Conecte-se e tente de novo." /> : null}
      {r?.ranking ? (
        <Card style={{ overflow: 'hidden' }}>
          {r.ranking.linhas.length === 0 ? <Empty text="Ninguém da equipe tem este número ainda." /> : null}
          {r.ranking.linhas.map((l, i) => (
            <View key={l.usuario_id} testID={`ranking-linha-${l.usuario_id}`} style={[styles.linha, i < r.ranking!.linhas.length - 1 && styles.divisor]}>
              <Text style={[t.h2, styles.posicao]}>{l.posicao ?? '—'}</Text>
              <Text style={[t.bodyStrong, { flex: 1 }]} numberOfLines={1}>
                {l.nome}
              </Text>
              <Text style={t.bodyStrong}>{valorDoIndicador(indicador, l.valor, formatBRL0)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { marginHorizontal: -20, flexGrow: 0 },
  chipsConteudo: { gap: 6, paddingHorizontal: 20 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  posicao: { width: 28, textAlign: 'center' },
});
