/**
 * Lista Rascunhos do Vendedor (RN-VEN-38/39, T-0141 F; spec docs/design/pedido-v3.md §F). Funções puras, sem React: as regras de
 * quem aparece e quando some são do domain (`domain/rascunhos.ts`); aqui só os textos de cada linha. Tudo do aparelho (vale offline).
 * T-0171 (RD-0214): a linha mostra cliente + total e, embaixo, um único fato + o selo "Some em" (sem código do cliente nem nº de itens).
 */
import { formatHHMM, localIsoDate } from '@macuxi/comum/fuso';

import { minutosParaSumir, rascunhosParaLista, textoSomeEm } from '../../domain/rascunhos';
import type { Rascunho } from './pedidos';

export const TEXTOS_RASCUNHOS = {
  titulo: 'Rascunhos',
  voltar: 'Pedidos',
  foraDaCarteira: 'Cliente fora da sua carteira',
  vazio: { titulo: 'Nenhum rascunho', apoio: 'O pedido que você deixa sem enviar fica aqui por 24 h.', acao: 'Voltar a Pedidos' },
  erro: { titulo: 'Não foi possível abrir os rascunhos', apoio: 'Puxe a tela para tentar de novo.' },
  dica: 'Continuar o pedido',
} as const;

export interface LinhaDeRascunho {
  /** chave do mapa de rascunhos: é por ela que o app retoma */
  chave: string;
  customer_id: string;
  edicao_de: string | null;
  cliente: string;
  /** `null` = sem tabela de preço no aparelho para calcular */
  total_cents: number | null;
  /** o único fato da linha de baixo: "Alterado hoje às 05:51"; edição: "Edição do pedido 000013"; fora da carteira, a frase da carteira */
  fato: string;
  /** "Some em 2 h" / "Some em 40 min" nas últimas 3 h */
  someEm: string | null;
  foraDaCarteira: boolean;
}

/** "Alterado hoje às 05:51" / "ontem às ..." / "07/11 às ..." no fuso do tenant. */
export function textoDaAlteracao(iso: string, agora: Date, tz: string): string {
  const dia = localIsoDate(iso, tz);
  const hoje = localIsoDate(agora, tz);
  const ontem = localIsoDate(new Date(agora.getTime() - 86_400_000), tz);
  const quando = dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  return `Alterado ${quando} às ${formatHHMM(iso, tz)}`;
}

export function linhasDosRascunhos(a: {
  rascunhos: Readonly<Record<string, Rascunho>>;
  clientes: ReadonlyArray<{ id: string; trade_name: string; erp_code: string }>;
  pedidos: ReadonlyArray<{ id: string; number: string; tipo?: 'pedido' | 'orcamento' }>;
  totalDoRascunho: (r: Rascunho) => number | null;
  agora: Date;
  tz: string;
}): LinhaDeRascunho[] {
  return rascunhosParaLista(a.rascunhos, a.agora).map((l): LinhaDeRascunho => {
    const r = a.rascunhos[l.chave]!;
    const cliente = a.clientes.find((c) => c.id === l.customer_id);
    let fato: string;
    if (!cliente) fato = TEXTOS_RASCUNHOS.foraDaCarteira;
    else if (l.edicao_de) {
      const registro = a.pedidos.find((p) => p.id === l.edicao_de);
      const tipo = (registro?.tipo ?? r.tipo) === 'orcamento' ? 'orçamento' : 'pedido';
      fato = `Edição do ${tipo}${registro?.number ? ` ${registro.number}` : ''}`;
    } else fato = textoDaAlteracao(l.atualizado_em, a.agora, a.tz);
    return {
      chave: l.chave,
      customer_id: l.customer_id,
      edicao_de: l.edicao_de,
      cliente: cliente?.trade_name ?? 'Cliente',
      total_cents: a.totalDoRascunho(r),
      fato,
      someEm: textoSomeEm(minutosParaSumir(r, a.agora)),
      foraDaCarteira: !cliente,
    };
  });
}
