/**
 * Presença e ruptura do mix obrigatório da loja (RF-PRO-06, RN-PRO-05).
 * Ruptura (%) = itens do mix em ruptura ÷ itens do mix × 100. A ruptura na gôndola COM produto no
 * depósito (falha de reposição) também é contada à parte, para atribuir a causa.
 */
import { ehInteiroNaoNegativo, percentual } from './numeros';

export const STATUS_PRESENCA = ['presente', 'ruptura_gondola', 'ruptura_total'] as const;
export type StatusPresenca = (typeof STATUS_PRESENCA)[number];

export const ROTULO_PRESENCA: Readonly<Record<StatusPresenca, string>> = {
  presente: 'Presente',
  ruptura_gondola: 'Ruptura na gôndola (tem no depósito)',
  ruptura_total: 'Ruptura total',
};

/** RF-PRO-06: na gôndola = presente; fora dela, com produto no depósito = falha de reposição; sem produto = ruptura total. */
export function classificarPresenca(c: { na_gondola: boolean; no_deposito: boolean | null }): StatusPresenca {
  if (c.na_gondola) return 'presente';
  if (c.no_deposito === null) throw new RangeError('Produto fora da gôndola: confira o depósito e informe se há estoque.');
  return c.no_deposito ? 'ruptura_gondola' : 'ruptura_total';
}

/** Quantidade reposta: inteiro ≥ 0; em ruptura total não há o que repor (0). */
export function quantidadeRepostaValida(status: StatusPresenca, quantidade: number): boolean {
  if (!ehInteiroNaoNegativo(quantidade)) return false;
  return status === 'ruptura_total' ? quantidade === 0 : true;
}

export interface ItemMix {
  status: StatusPresenca;
  quantidade_reposta?: number;
}

export interface ResumoRuptura {
  total: number;
  presentes: number;
  ruptura_gondola: number;
  ruptura_total: number;
  em_ruptura: number;
  /** RN-PRO-05 */
  ruptura_pct: number | null;
  /** só ruptura total ÷ mix */
  ruptura_total_pct: number | null;
  /** ruptura na gôndola com produto no depósito ÷ mix (contada à parte) */
  falha_reposicao_pct: number | null;
  quantidade_reposta: number;
}

export interface OpcoesRuptura {
  /**
   * `true` (padrão): `ruptura_pct` conta ruptura total + ruptura na gôndola (o cliente não acha o produto).
   * `false`: `ruptura_pct` conta só a ruptura total; a falha de reposição aparece só em `falha_reposicao_pct`.
   */
  incluirFalhaDeReposicao?: boolean;
}

export function resumirRuptura(itens: readonly ItemMix[], opcoes: OpcoesRuptura = {}): ResumoRuptura {
  const incluir = opcoes.incluirFalhaDeReposicao ?? true;
  const total = itens.length;
  const gondola = itens.filter((i) => i.status === 'ruptura_gondola').length;
  const totalRup = itens.filter((i) => i.status === 'ruptura_total').length;
  const presentes = total - gondola - totalRup;
  const emRuptura = incluir ? gondola + totalRup : totalRup;
  return {
    total,
    presentes,
    ruptura_gondola: gondola,
    ruptura_total: totalRup,
    em_ruptura: emRuptura,
    ruptura_pct: percentual(emRuptura, total),
    ruptura_total_pct: percentual(totalRup, total),
    falha_reposicao_pct: percentual(gondola, total),
    quantidade_reposta: itens.reduce((s, i) => s + (i.quantidade_reposta ?? 0), 0),
  };
}
