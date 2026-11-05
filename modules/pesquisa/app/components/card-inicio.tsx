/**
 * Card no Início (slot `inicio.cards`): quantas pesquisas avulsas estão disponíveis e quantas respostas esperam sinal.
 * Também carrega o retrato local cedo, para a etapa obrigatória do checkout já saber o que pedir (RN-PES-03).
 * Visual T-0072: Cartao, fila como ChipEstado, ação secundária (o principal é da tela hospedeira).
 */
import { Botao, Cartao, ChipEstado, type as t } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { Text } from 'react-native';
import { irParaPesquisas } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export function CardPesquisas() {
  const { carregado, oferta, pendentesNaFila, offline } = usePesquisa();
  const n = useMemo(() => oferta({ cliente_id: null, visita_id: null }).disponiveis.length, [oferta]);
  if (!carregado || (n === 0 && pendentesNaFila === 0)) return null;
  return (
    <Cartao testID="inicio.card-pesquisas" gap={8}>
      <Text style={t.title16}>{n === 1 ? '1 pesquisa para responder' : `${n} pesquisas para responder`}</Text>
      {pendentesNaFila > 0 ? (
        <ChipEstado tom={offline ? 'aviso' : 'neutro'} icone={offline ? 'wifiOff' : 'sync'} texto={`${pendentesNaFila} na fila`} rotuloAcessivel={`${pendentesNaFila === 1 ? '1 resposta' : `${pendentesNaFila} respostas`} na fila${offline ? ', sem sinal' : ', enviando'}`} />
      ) : null}
      <Botao testID="inicio.card-pesquisas-abrir" rotulo="Abrir pesquisas" onPress={irParaPesquisas} />
    </Cartao>
  );
}
