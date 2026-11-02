/**
 * Aba Alertas do Macuxi Gestão (RF-GES-07): alertas abertos e dispensados da equipe, do mais urgente ao menos.
 * Dispensar silencia enquanto a condição persistir (encerra sozinho quando normaliza); precisa de internet e da ação
 * `alerta_equipe.dispensar` (supervisor e gerente).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { SePode } from '@macuxi/platform-sdk/react';
import { Badge, Banner, Button, Card, colors, Empty, Loading, relativeWhen, Screen, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Alerta } from '../../contracts';
import { nomesDaVisao, SEVERIDADE_TOM, TIPO_ALERTA_ROTULO } from '../lib/apresentacao';
import { useGestor } from '../state/use-gestor';

const relogio = relogioReal();

export default function AlertasScreen() {
  const g = useGestor();
  const [puxando, setPuxando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  if (!g.carregado) return <Loading />;
  const nomes = nomesDaVisao(g.visao);
  const itens = g.alertas?.itens ?? [];
  const dispensar = async (a: Alerta) => {
    setEnviando(a.id);
    const r = await g.dispensar(a.id);
    setEnviando(null);
    setAviso(r.ok ? null : r.mensagem);
  };
  return (
    <Screen
      testID="gestor-alertas"
      refreshing={puxando || g.sincronizando}
      onRefresh={() => {
        setPuxando(true);
        void g.sincronizar().finally(() => setPuxando(false));
      }}>
      <View style={{ gap: 2 }}>
        <Text style={t.h1}>Alertas</Text>
        <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
      </View>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {aviso ? <Banner tone="danger">{aviso}</Banner> : null}
      <Card style={{ overflow: 'hidden' }}>
        {itens.length === 0 ? <Empty text={g.alertas ? 'Nenhum alerta na sua equipe agora.' : 'Sem dados no aparelho ainda. Puxe para baixo para sincronizar.'} /> : null}
        {itens.map((a, i) => (
          <View key={a.id} testID={`gestor-alerta-${a.id}`} style={[styles.item, i < itens.length - 1 && styles.divisor]}>
            <View style={styles.linha}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>{TIPO_ALERTA_ROTULO[a.tipo]}</Text>
              <Badge label={a.status === 'dispensado' ? 'Dispensado' : a.severidade === 'critica' ? 'Crítico' : a.severidade === 'atencao' ? 'Atenção' : 'Info'} tone={a.status === 'dispensado' ? 'neutral' : SEVERIDADE_TOM[a.severidade]} />
            </View>
            <Text style={t.body}>{a.mensagem}</Text>
            <Text style={t.small}>
              {a.responsavel_id ? `${nomes.get(a.responsavel_id) ?? 'Equipe'} · ` : ''}desde {relativeWhen(a.aberto_em, relogio.agora(), g.tz)}
            </Text>
            {a.status === 'aberto' ? (
              <SePode acao="alerta_equipe.dispensar">
                <Button testID={`gestor-dispensar-${a.id}`} label="Dispensar" variant="outline" loading={enviando === a.id} disabled={g.offline} onPress={() => void dispensar(a)} />
              </SePode>
            ) : null}
          </View>
        ))}
      </Card>
      {g.offline ? <Text style={[t.small, { textAlign: 'center', color: colors.warning }]}>Sem conexão: dispensar precisa de internet.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
