/**
 * Etapa "Pesquisa obrigatória" na folha de checkout do Core (slot `visita.etapas_checkout`; RF-PES-03, RN-PES-03).
 * Lista as obrigatórias desta visita: pendente (botão Responder), concluída ou dispensada (cliente fechado,
 * RN-CORE-14). O `concluida()` da etapa usa o mesmo cálculo (`etapaConcluida`, app/lib/local.ts).
 */
import type { ContextoCheckout } from '@macuxi/core/contracts';
import { Badge, Button, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';
import { etapaDoCheckout } from '../lib/local';
import { irParaResponder } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export function EtapaPesquisaCheckout({ contexto }: { contexto: ContextoCheckout }) {
  // o hook carrega o retrato local e o mantém em dia (sincronização e fila) para o `concluida()` do Core
  const { carregado } = usePesquisa();
  const r = etapaDoCheckout(contexto);
  if (!carregado || !r) return <Text style={t.small}>Carregando as pesquisas da visita…</Text>;
  if (r.itens.length === 0) return <Text style={t.small} testID="pesquisa.etapa-vazia">Nenhuma pesquisa obrigatória nesta visita.</Text>;
  return (
    <View style={{ gap: 8 }} testID="pesquisa.etapa">
      {r.itens.map((i, n) => (
        <View key={i.questionario_id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[t.bodyStrong, { flex: 1 }]}>{i.titulo}</Text>
            <Badge label={i.estado === 'pendente' ? 'Pendente' : i.estado === 'concluida' ? 'Respondida' : 'Dispensada'} tone={i.estado === 'pendente' ? 'warning' : i.estado === 'concluida' ? 'success' : 'neutral'} />
          </View>
          {i.estado === 'pendente' ? (
            <Button testID={`pesquisa.etapa-responder-${n + 1}`} label="Responder agora" icon="edit" height={48} onPress={() => irParaResponder({ questionario: i.questionario_id, cliente: contexto.clienteId, visita: contexto.visitaId })} />
          ) : null}
        </View>
      ))}
      {r.mensagem ? <Text style={t.small}>{r.mensagem}</Text> : null}
    </View>
  );
}
