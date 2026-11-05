/**
 * Seção "Pesquisas" na ficha do cliente (slot `cliente.abas`; RF-PES-03): avulsas que valem para este cliente agora,
 * ligadas à visita aberta (se houver). Offline: lê o que o aparelho já tem.
 * Visual T-0072: ação secundária e ChipEstado nos indisponíveis (motivo FREQUENCIA = já respondida, RN-PES-02).
 */
import type { ContextoCliente } from '@macuxi/core/contracts';
import { Botao, ChipEstado, type as t } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { dataBr } from '../lib/entrada';
import { irParaResponder } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export function AbaPesquisasCliente({ contexto }: { contexto: ContextoCliente }) {
  const { carregado, oferta } = usePesquisa();
  const { disponiveis, indisponiveis } = useMemo(() => oferta({ cliente_id: contexto.clienteId, visita_id: contexto.visitaId }), [oferta, contexto.clienteId, contexto.visitaId]);
  if (!carregado) return <Text style={t.small}>Carregando…</Text>;
  if (disponiveis.length === 0 && indisponiveis.length === 0) return <Text style={t.small}>Nenhuma pesquisa agora</Text>;
  return (
    <View style={{ gap: 10 }} testID="pesquisa.ficha">
      {disponiveis.map((d, i) => (
        <View key={d.questionario_id} style={{ gap: 6 }}>
          <Text style={t.bodyStrong}>{d.titulo}</Text>
          <Botao testID={`pesquisa.ficha-responder-${i + 1}`} rotulo="Responder" icone="edit" onPress={() => irParaResponder({ questionario: d.questionario_id, cliente: contexto.clienteId, visita: contexto.visitaId })} />
        </View>
      ))}
      {indisponiveis.map((d) => (
        <View key={d.questionario_id} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[t.body, { flex: 1 }]}>{d.titulo}</Text>
            {d.motivo === 'FREQUENCIA' ? (
              <ChipEstado pequeno tom="sucesso" icone="check" texto="Respondida" />
            ) : (
              <ChipEstado pequeno tom="neutro" texto="Não se aplica" rotuloAcessivel="Não vale para este cliente" />
            )}
          </View>
          {d.motivo === 'FREQUENCIA' ? (
            d.liberada_em ? <Text style={t.small}>Volta em {dataBr(d.liberada_em)}</Text> : null
          ) : (
            <Text style={t.small}>Não vale para este cliente</Text>
          )}
        </View>
      ))}
    </View>
  );
}
