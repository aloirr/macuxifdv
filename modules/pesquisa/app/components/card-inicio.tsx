/**
 * Card no Início (slot `inicio.cards`): quantas pesquisas avulsas estão disponíveis e quantas respostas esperam sinal.
 * Também carrega o retrato local cedo, para a etapa obrigatória do checkout já saber o que pedir (RN-PES-03).
 */
import { Button, Card, type as t } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { Text } from 'react-native';
import { irParaPesquisas } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export function CardPesquisas() {
  const { carregado, oferta, pendentesNaFila } = usePesquisa();
  const n = useMemo(() => oferta({ cliente_id: null, visita_id: null }).disponiveis.length, [oferta]);
  if (!carregado || (n === 0 && pendentesNaFila === 0)) return null;
  return (
    <Card testID="inicio.card-pesquisas" style={{ padding: 16, gap: 8 }}>
      <Text style={t.title16}>{n === 1 ? '1 pesquisa para responder' : `${n} pesquisas para responder`}</Text>
      {pendentesNaFila > 0 ? <Text style={t.small}>{pendentesNaFila === 1 ? '1 resposta aguardando' : `${pendentesNaFila} respostas aguardando`} sinal para enviar.</Text> : null}
      <Button testID="inicio.card-pesquisas-abrir" label="Abrir pesquisas" variant="outline" height={48} onPress={irParaPesquisas} />
    </Card>
  );
}
