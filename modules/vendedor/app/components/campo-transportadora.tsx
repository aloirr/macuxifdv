/**
 * T-0165 (docs/design/pedido-v4.md §5.6, RN-VEN-16): a Transportadora do frete FOB em lista, pelo `CampoEscolha` do kit (campo de 48 dp,
 * folha com busca e "Outra (digitar)" por último). As transportadoras ativas do cadastro do BKO vêm baixadas no aparelho (vale sem sinal).
 * T-0166/RD-0170: `falta` ("Obrigatório") só chega depois da tentativa de avançar ou enviar; antes, o campo fica no estado normal.
 */
import { CampoEscolha } from '@macuxi/ui/mobile';

import { OUTRA_TRANSPORTADORA, textoDoCampoTransportadora, transportadorasAtivas, type FreteDoRascunho, type TransportadoraDaTela } from '../lib/novo-pedido';

export function CampoTransportadora({ frete, transportadoras, aoEscolher, aoEscolherOutra, falta = null }: { frete: FreteDoRascunho; transportadoras: readonly TransportadoraDaTela[]; aoEscolher: (t: TransportadoraDaTela) => void; aoEscolherOutra: () => void; falta?: string | null }) {
  const outra = frete.transportadora_digitada != null && !frete.transportadora_id;
  return (
    <CampoEscolha
      testID="transportadora"
      rotulo="Transportadora"
      titulo="Transportadora"
      opcoes={transportadorasAtivas(transportadoras).map((t) => ({ id: t.id, rotulo: t.nome, origem: t }))}
      valor={frete.transportadora_id ?? null}
      onEscolher={(o) => aoEscolher(o.origem)}
      opcaoFinal={{ rotulo: OUTRA_TRANSPORTADORA, onPress: aoEscolherOutra, testID: 'transp-outra' }}
      rotuloLivre={outra ? (textoDoCampoTransportadora(frete, transportadoras) ?? 'Outra') : null}
      placeholder="Escolher"
      placeholderBusca="Nome da transportadora"
      rotuloFechar="Fechar"
      rotuloLimpar="Limpar a busca"
      falta={falta}
    />
  );
}
