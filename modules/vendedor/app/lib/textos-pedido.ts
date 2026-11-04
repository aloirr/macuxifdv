/**
 * Textos da referência enxuta do novo pedido (T-0071, desenho §6.1). Cada texto sai de uma função com teste: a tela não escreve
 * frase própria. Rótulo curto, número em destaque, nada de explicação na tela.
 */
import { formatBRL, formatPct } from '@macuxi/comum';

import type { SituacaoCliente, SituacaoOrcamento } from '../../domain/orcamento';
import type { CalculoPedido } from './novo-pedido';

export type AbaNovoPedido = 'itens' | 'detalhes' | 'resumo';

/** Abas do novo pedido: Itens (com a contagem), Detalhes e Resumo. */
export function abasDoPedido(itens: number): Array<{ id: AbaNovoPedido; rotulo: string; contador?: number | null }> {
  return [
    { id: 'itens', rotulo: 'Itens', contador: itens > 0 ? itens : null },
    { id: 'detalhes', rotulo: 'Detalhes' },
    { id: 'resumo', rotulo: 'Resumo' },
  ];
}

/** RN-VEN-14: "28 dias" → "28 d"; "28/56 dias" → "28/56"; "À vista" e o que não segue o padrão ficam como estão. */
export function rotuloCurtoDaCondicao(descricao: string): string {
  const d = descricao.trim();
  const um = /^(\d+)\s*dias?$/i.exec(d);
  if (um) return `${um[1]} d`;
  const varios = /^(\d+(?:\/\d+)+)(?:\s*dias?)?$/i.exec(d);
  if (varios) return varios[1]!;
  return d;
}

export interface FaixaDaAlcada {
  texto: string;
  tom: 'ok' | 'aviso' | 'erro';
  /** o ícone do tom (a `Faixa` do ui desenha o ✓); null = sem ícone */
  icone: 'check' | 'alert' | null;
}

/** RN-VEN-10 / RN-VEN-03: a faixa da aba Resumo. Zero = sem faixa (null). */
export function textoDaFaixa(c: Pick<CalculoPedido, 'desconto_efetivo_pct' | 'nivel' | 'bloqueado'>, _limiteVendedor: number): FaixaDaAlcada | null {
  const pct = c.desconto_efetivo_pct;
  if (pct === 0) return null;
  if (pct < 0) return { texto: `Acréscimo ${formatPct(-pct)}`, tom: 'ok', icone: null };
  if (c.bloqueado) return { texto: `${formatPct(pct)} · acima da alçada`, tom: 'erro', icone: 'alert' };
  if (c.nivel) return { texto: `${formatPct(pct)} · vai para o ${c.nivel}`, tom: 'aviso', icone: 'alert' };
  return { texto: `${formatPct(pct)} · dentro da alçada`, tom: 'ok', icone: 'check' };
}

export function tituloDaFolhaSalvar(): string {
  return 'Salvar pedido';
}

/** Selo do orçamento (tela 5 e lista): "Orçamento · até 10/11", "Vencido", "Cancelado", "Virou pedido 000015". */
export function seloDoOrcamento(e: { situacao: SituacaoOrcamento; validade_data: string; pedido_numero?: string | null }): { texto: string; tom: 'roxo' | 'neutro' | 'sucesso' } {
  const [, m, d] = e.validade_data.split('-');
  switch (e.situacao) {
    case 'aberto':
      return { texto: `Orçamento · até ${d}/${m}`, tom: 'roxo' };
    case 'expirado':
      return { texto: 'Vencido', tom: 'neutro' };
    case 'cancelado':
      return { texto: 'Cancelado', tom: 'neutro' };
    case 'convertido':
      return { texto: e.pedido_numero ? `Virou pedido ${e.pedido_numero}` : 'Virou pedido', tom: 'sucesso' };
  }
}

/** RN-VEN-13 / RN-CORE-17: situação do cliente (linha do sync) para a folha do Salvar. Não achou no aparelho = só orçamento. */
export function situacaoDoClienteSync(c: { ativo?: boolean; cadastro_incompleto?: boolean; cadastro_campos_faltantes?: readonly string[] } | null | undefined): SituacaoCliente {
  if (!c) return { ativo: false, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] };
  return { ativo: c.ativo !== false, bloqueado: false, cadastro_incompleto: c.cadastro_incompleto === true, campos_faltantes: c.cadastro_campos_faltantes ?? [] };
}

/** Item compacto do Resumo: "Água mineral 500 ml · 3 FD". */
export function itemCompacto(nome: string, quantidade: number, medida: string): string {
  return `${nome} · ${quantidade} ${medida}`;
}

/** Linha de entrega do Resumo: "CIF · 28 dias · Av. Ajuricaba, 1200" (o que falta fica de fora). */
export function linhaDeEntrega(e: { modalidade: 'CIF' | 'FOB'; prazo: string; endereco: string | null }): string {
  return [e.modalidade, e.prazo.trim(), e.endereco?.trim()].filter((x) => x && x.length > 0).join(' · ');
}

/** Totais do Resumo em até 3 linhas (Tabela, Descontos ou Acréscimos) mais o Total à parte. */
export function linhasDeTotais(c: Pick<CalculoPedido, 'total_tabela_cents' | 'desconto_cents' | 'acrescimo_cents' | 'total_cents'>): { linhas: Array<{ id: string; rotulo: string; valor: string }>; total: { rotulo: string; valor: string } } {
  const linhas = [{ id: 'tabela', rotulo: 'Tabela', valor: formatBRL(c.total_tabela_cents) }];
  if (c.desconto_cents > 0) linhas.push({ id: 'descontos', rotulo: 'Descontos', valor: `− ${formatBRL(c.desconto_cents)}` });
  if (c.acrescimo_cents > 0) linhas.push({ id: 'acrescimos', rotulo: 'Acréscimos', valor: `+ ${formatBRL(c.acrescimo_cents)}` });
  return { linhas, total: { rotulo: 'Total', valor: formatBRL(c.total_cents) } };
}
