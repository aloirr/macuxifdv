/**
 * Aba Equipe do Macuxi Gestão (RF-GES-01): quem está em visita, em rota ou sem check-in, vendas e cobertura do dia, por
 * pessoa e (gerente) por equipe. Lê do cache do aparelho; puxar para atualizar busca a API quando há sinal.
 * Toque na pessoa = ficha (RF-GES-02/10). Escopo e números vêm prontos da API/domain (RN-CORE-04).
 */
import { formatBRL0 } from '@macuxi/comum';
import { Badge, Banner, Button, Card, colors, Empty, Loading, Screen, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MembroComPainel, ResumoEquipe } from '../../contracts';
import { fracao, STATUS_DIA_ROTULO } from '../lib/apresentacao';
import { irParaMembro, irParaRanking } from '../rotas';
import { useGestor } from '../state/use-gestor';

export default function EquipeScreen() {
  const g = useGestor();
  const [puxando, setPuxando] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void g.atualizar();
    }, [g.atualizar]),
  );
  if (!g.carregado) return <Loading />;
  const v = g.visao;
  return (
    <Screen
      testID="gestor-equipe"
      refreshing={puxando || g.atualizando}
      onRefresh={() => {
        setPuxando(true);
        void g.atualizar().finally(() => setPuxando(false));
      }}>
      <View style={styles.cabecalho}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={t.h1}>Equipe</Text>
          <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
        </View>
        <Button testID="gestor-abrir-ranking" label="Ranking" icon="target" variant="outline" onPress={irParaRanking} />
      </View>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {!v ? <Empty text={g.offline ? 'Sem dados no aparelho ainda. Conecte-se à internet e puxe para atualizar.' : 'Nenhum dado da equipe ainda. Puxe para atualizar.'} /> : null}
      {v ? <Resumo r={v.resumo} /> : null}
      {v && v.equipes.length > 0 ? (
        <Card testID="gestor-equipes">
          {v.equipes.map((e, i) => (
            <View key={e.gestor_id} style={[styles.linha, { minHeight: 40, paddingHorizontal: 14 }]}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>{v.gestores[i]?.nome ?? 'Equipe'}</Text>
              <Text style={t.small}>
                {e.membros} pessoas · {e.vendas_cents === null ? '—' : formatBRL0(e.vendas_cents)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {v ? (
        <Card style={{ overflow: 'hidden' }}>
          {v.membros.length === 0 ? <Empty text="Ninguém da sua equipe aparece aqui ainda." /> : null}
          {v.membros.map((m, i) => (
            <LinhaMembro key={m.membro.id} m={m} ultimo={i === v.membros.length - 1} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Resumo({ r }: { r: ResumoEquipe }) {
  return (
    <Card testID="gestor-resumo" style={{ gap: 8, padding: 14 }}>
      <View style={styles.linha}>
        <Indicador rotulo="Em visita" valor={String(r.em_visita)} cor={colors.success} />
        <Indicador rotulo="Em rota" valor={String(r.em_rota)} cor={colors.accent} />
        <Indicador rotulo="Sem check-in" valor={String(r.sem_checkin)} cor={colors.warning} />
      </View>
      <View style={styles.linha}>
        <Indicador rotulo="Vendas hoje" valor={r.vendas_cents === null ? '—' : formatBRL0(r.vendas_cents)} />
        <Indicador rotulo="Visitas" valor={fracao(r.visitas_realizadas, r.visitas_planejadas)} />
        <Indicador rotulo="Cobertura" valor={r.cobertura_pct === null ? '—' : `${Math.round(r.cobertura_pct)}%`} />
      </View>
      {r.atingimento_pct !== null ? <Text style={t.small}>Meta do mês: {Math.round(r.atingimento_pct)}% atingido</Text> : null}
    </Card>
  );
}

function Indicador({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[t.h2, cor ? { color: cor } : null]}>{valor}</Text>
      <Text style={t.small}>{rotulo}</Text>
    </View>
  );
}

function LinhaMembro({ m, ultimo }: { m: MembroComPainel; ultimo: boolean }) {
  const s = STATUS_DIA_ROTULO[m.painel.status_dia];
  const p = m.painel;
  const detalhe =
    m.membro.perfil === 'promotor'
      ? `Promotor · ${p.trade ? `${p.trade.lojas_visitadas} lojas` : `${p.visitas.realizadas} visitas`}`
      : `${fracao(p.visitas.realizadas, p.visitas.planejadas)} visitas · ${p.vendas ? formatBRL0(p.vendas.vendas_cents) : '—'}`;
  return (
    <Pressable
      testID={`gestor-membro-${m.membro.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${m.membro.nome}, ${s.label}`}
      onPress={() => irParaMembro(m.membro.id)}
      style={({ pressed }) => [styles.membro, !ultimo && styles.divisor, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {m.membro.nome}
        </Text>
        <Text style={t.small} numberOfLines={1}>
          {detalhe}
        </Text>
      </View>
      <Badge label={s.label} tone={s.tom} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  membro: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
