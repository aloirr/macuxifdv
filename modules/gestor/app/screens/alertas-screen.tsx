/**
 * Aba Alertas do Macuxi Gestão (RF-GES-07): alertas abertos e dispensados da equipe, do mais urgente ao menos.
 * Dispensar silencia enquanto a condição persistir (encerra sozinho quando normaliza); precisa de internet e da ação
 * `alerta_equipe.dispensar` (supervisor e gerente).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { SePode } from '@macuxi/platform-sdk/react';
import { AvisoRodape, Banner, Botao, Cartao, ChipEstado, colors, EstadoVazio, Loading, relativeWhen, Screen, SyncStamp, type as t, useAvisoRodape } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Alerta } from '../../contracts';
import { SEVERIDADE_TOM, TIPO_ALERTA_ROTULO, TOM_PARA_CHIP } from '../lib/apresentacao';
import { irParaCliente } from '../rotas';
import { useGestor } from '../state/use-gestor';

const relogio = relogioReal();
const SEM_SINAL = 'Sem sinal. Precisa de internet.';

export default function AlertasScreen() {
  const g = useGestor({ pendencias: true });
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const avisoRodape = useAvisoRodape();
  if (!g.carregado) return <Loading />;
  const itens = g.alertas?.itens ?? [];
  const pendencias = g.pendencias;
  const dispensar = async (a: Alerta) => {
    setEnviando(a.id);
    const r = await g.dispensar(a.id);
    setEnviando(null);
    setAviso(r.ok ? null : r.mensagem);
    if (r.ok) avisoRodape.mostrar({ texto: 'Alerta dispensado' });
  };
  return (
    <View style={{ flex: 1 }}>
      <Screen
        testID="gestor-alertas"
        refreshing={g.auto.puxando}
        onRefresh={() => {
          setAviso(null);
          g.auto.puxar();
        }}>
        <View style={{ gap: 2 }}>
          <Text style={t.h1}>Alertas</Text>
          <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
        </View>
        {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
        {aviso ? <Banner tone="danger">{aviso}</Banner> : null}
        <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
          {pendencias.map((p, i) => (
            <Pressable
              key={p.id}
              testID={`gestor-pendencia-${p.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${p.titulo}. ${p.mensagem}`}
              onPress={() => irParaCliente(p.cliente_id)}
              style={[styles.item, styles.alvo, (i < pendencias.length - 1 || itens.length > 0) && styles.divisor]}>
              <View style={styles.linha}>
                <Text style={[t.bodyStrong, { flex: 1 }]}>{p.titulo}</Text>
              </View>
              <Text style={t.body}>{p.mensagem}</Text>
              <Text style={t.small}>desde {relativeWhen(p.aberto_em, relogio.agora(), g.tz)}</Text>
            </Pressable>
          ))}
          {itens.length === 0 && pendencias.length === 0 ? (
            g.alertas ? (
              <EstadoVazio icone="alert" titulo="Nenhum alerta na sua equipe" texto="Os alertas novos aparecem aqui quando houver algo para ver." />
            ) : (
              <EstadoVazio icone="alert" titulo="Sem dados no aparelho ainda" texto="Puxe para baixo para sincronizar." />
            )
          ) : null}
          {itens.map((a, i) => (
            <View key={a.id} testID={`gestor-alerta-${a.id}`} style={[styles.item, i < itens.length - 1 && styles.divisor]}>
              <View style={styles.linha}>
                <Text style={[t.bodyStrong, { flex: 1 }]}>{TIPO_ALERTA_ROTULO[a.tipo]}</Text>
                <ChipEstado
                  pequeno
                  texto={a.status === 'dispensado' ? 'Dispensado' : a.severidade === 'critica' ? 'Crítico' : a.severidade === 'atencao' ? 'Atenção' : 'Info'}
                  tom={TOM_PARA_CHIP[a.status === 'dispensado' ? 'neutral' : SEVERIDADE_TOM[a.severidade]]}
                />
              </View>
              <Text style={t.body}>{a.mensagem}</Text>
              {a.status === 'aberto' ? (
                <SePode acao="alerta_equipe.dispensar">
                  {g.offline ? (
                    <Pressable testID={`gestor-dispensar-sem-sinal-${a.id}`} accessibilityRole="button" accessibilityLabel="Dispensar. Sem sinal." onPress={() => setAviso(SEM_SINAL)}>
                      <View pointerEvents="none">
                        <Botao testID={`gestor-dispensar-${a.id}`} rotulo="Dispensar" nivel="neutro" desligado />
                      </View>
                    </Pressable>
                  ) : (
                    <Botao testID={`gestor-dispensar-${a.id}`} rotulo="Dispensar" nivel="neutro" ocupado={enviando === a.id} onPress={() => void dispensar(a)} />
                  )}
                </SePode>
              ) : null}
            </View>
          ))}
        </Cartao>
      </Screen>
      <AvisoRodape {...avisoRodape.props} respiroInferior={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  alvo: { minHeight: 48 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
