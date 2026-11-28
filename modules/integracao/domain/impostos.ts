/**
 * ADR 0077 (decisão 63 A): ST e IPI vindos do ERP. O Hub só confere a `sequencia` de cada linha contra o pedido enviado e repassa
 * os valores como chegaram (0 fica 0, ausente fica ausente, null fica null). Nenhuma alíquota, base, MVA nem conta: nada aqui opera
 * sobre os valores (a varredura de `sem-calculo-imposto.test.ts` trava).
 */
import { type EstadoPedidoErp, type ImpostoItemDescartado, type ImpostoItemRetorno, type ImpostosRetorno, STATUS_COM_IMPOSTOS } from '../contracts';

export interface ImpostosDoRetorno {
  /** `undefined` = sem bloco no evento (status sem impostos ou Conector/ERP antigo): o consumidor não apaga nada. */
  impostos: ImpostosRetorno | undefined;
  descartados: ImpostoItemDescartado[];
}

const valeNoStatus = (status: EstadoPedidoErp): boolean => (STATUS_COM_IMPOSTOS as readonly string[]).includes(status);

export function impostosDoRetorno(itensDoPedido: readonly { sequencia: number }[], status: EstadoPedidoErp, impostos: ImpostosRetorno | null | undefined): ImpostosDoRetorno {
  if (!impostos || !valeNoStatus(status)) return { impostos: undefined, descartados: [] };
  const existentes = new Set(itensDoPedido.map((i) => i.sequencia));
  const vezes = new Map<number, number>();
  for (const l of impostos.itens) vezes.set(l.sequencia, (vezes.get(l.sequencia) ?? 0) + 1);
  const itens: ImpostoItemRetorno[] = [];
  const descartados: ImpostoItemDescartado[] = [];
  impostos.itens.forEach((l, indice) => {
    const campo = `impostos.itens[${indice}].sequencia`;
    if ((vezes.get(l.sequencia) ?? 0) > 1) {
      descartados.push({ indice, sequencia: l.sequencia, codigo: 'sequencia_repetida', campo, motivo: `A sequência ${l.sequencia} aparece mais de uma vez nos impostos do retorno e não dá para saber qual linha vale; as linhas dela foram descartadas e o item fica "não informado". Informe cada sequência uma vez só na consulta de impostos do Conector.` });
    } else if (!existentes.has(l.sequencia)) {
      descartados.push({ indice, sequencia: l.sequencia, codigo: 'sequencia_inexistente', campo, motivo: `A sequência ${l.sequencia} dos impostos do retorno não existe no pedido enviado ao ERP. Confira a consulta de impostos no Conector.` });
    } else {
      itens.push(l);
    }
  });
  // cópia das chaves que vieram, sem trocar nenhum valor (ausente continua ausente)
  const { itens: _itens, ...total } = impostos;
  return { impostos: { ...total, itens }, descartados };
}
