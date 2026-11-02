/**
 * Seção "Pesquisas" na ficha do cliente (slot `cliente.abas`; RF-PES-03): avulsas que valem para este cliente agora,
 * ligadas à visita aberta (se houver). Offline: lê o que o aparelho já tem.
 */
import type { ContextoCliente } from '@macuxi/core/contracts';
import { Button, type as t } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { dataBr } from '../lib/entrada';
import { irParaResponder } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export function AbaPesquisasCliente({ contexto }: { contexto: ContextoCliente }) {
  const { carregado, oferta } = usePesquisa();
  const { disponiveis, indisponiveis } = useMemo(() => oferta({ cliente_id: contexto.clienteId, visita_id: contexto.visitaId }), [oferta, contexto.clienteId, contexto.visitaId]);
  if (!carregado) return <Text style={t.small}>Carregando…</Text>;
  if (disponiveis.length === 0 && indisponiveis.length === 0) return <Text style={t.small}>Nenhuma pesquisa para este cliente agora.</Text>;
  return (
    <View style={{ gap: 10 }} testID="pesquisa.ficha">
      {disponiveis.map((d, i) => (
        <View key={d.questionario_id} style={{ gap: 6 }}>
          <Text style={t.bodyStrong}>{d.titulo}</Text>
          <Button testID={`pesquisa.ficha-responder-${i + 1}`} label="Responder" icon="edit" height={48} variant="outline" onPress={() => irParaResponder({ questionario: d.questionario_id, cliente: contexto.clienteId, visita: contexto.visitaId })} />
        </View>
      ))}
      {indisponiveis.map((d) => (
        <Text key={d.questionario_id} style={t.small}>
          {d.titulo}: {d.mensagem}
          {d.liberada_em ? ` Volta em ${dataBr(d.liberada_em)}.` : ''}
        </Text>
      ))}
    </View>
  );
}
