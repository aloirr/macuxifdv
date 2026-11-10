import { formatBRL } from '@macuxi/comum';
import { rotuloCurtoOk, rotulosDoHistorico, tagsDoHistorico } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES } from '../../domain/order';
import {
  acoesDoDetalhe,
  autorEhOVendedor,
  clienteComCodigo,
  eventosDoOrcamento,
  eventosDoPedido,
  itensVisiveis,
  linhaDoAjusteDoItem,
  linhaDoVendedor,
  linhaFormaPrazoFrete,
  motivoDoEvento,
  rotuloDoDescontoNoDetalhe,
  siglaDaMedida,
  type EntradaAcoesDoDetalhe,
} from './detalhe-pedido';

const TZ = 'America/Manaus';
const AGORA = '2026-11-08T20:00:00.000Z';
const ev = (status: string, at: string, by = 'Lucas Andrade', note = '') => ({ at, status, by, note });
const tags = (eventos: ReturnType<typeof eventosDoPedido>, tipo: 'pedido' | 'orcamento' = 'pedido') => tagsDoHistorico(eventos, { tipo, tz: TZ, agora: AGORA });

describe('RN-VEN-30 (T-0138): histórico do pedido só em tags, sem texto técnico', () => {
  it('RN-VEN-30: "Recebido pelo servidor." nunca aparece, nem como tag nem como motivo', () => {
    const t = tags(eventosDoPedido([ev('received', '2026-11-08T14:00:00.000Z', 'Lucas Andrade', 'Recebido pelo servidor.')], { vendedorNome: 'Lucas Andrade' }));
    expect(t.map((x) => x.texto)).toEqual(['Enviado · 08/11 10:00']);
    expect(JSON.stringify(t)).not.toMatch(/servidor/i);
  });

  it('RN-VEN-30: Rejeitado e Cancelado levam o motivo em 1 linha; os outros não mostram nota', () => {
    const t = tags(
      eventosDoPedido(
        [ev('received', '2026-11-08T14:00:00.000Z', 'Lucas Andrade', 'Recebido pelo servidor.'), ev('pending_approval', '2026-11-08T14:00:01.000Z', 'Lucas Andrade', 'Desconto acima da alçada'), ev('rejected', '2026-11-08T15:00:00.000Z', 'Carla Souza', 'Desconto\n  acima da alçada'), ev('cancelled', '2026-11-08T16:00:00.000Z', 'Lucas Andrade', 'Cliente desistiu')],
        { vendedorNome: 'Lucas Andrade' },
      ),
    );
    expect(t.map((x) => x.rotulo)).toEqual(['Enviado', 'Em aprovação', 'Rejeitado', 'Cancelado']);
    expect(t.map((x) => x.motivo)).toEqual([null, null, 'Desconto acima da alçada', 'Cliente desistiu']);
  });

  it('RN-VEN-30: o autor só aparece quando não é o vendedor (gestor), e nunca "aparelho" ou "ERP"', () => {
    const t = tags(eventosDoPedido([ev('received', '2026-11-08T14:00:00.000Z', 'Carla Souza'), ev('approved', '2026-11-08T14:05:00.000Z', 'lucas andrade'), ev('integrated', '2026-11-08T15:00:00.000Z', 'ERP'), ev('queued', '2026-11-08T13:00:00.000Z', 'aparelho')], { vendedorNome: 'Lucas Andrade' }));
    expect(t.map((x) => x.texto)).toEqual(['Na fila · 08/11 09:00', 'Enviado · 08/11 10:00 · Carla Souza', 'Aprovado · 08/11 10:05', 'Recebido no ERP · 08/11 11:00']);
    expect(autorEhOVendedor('Lucas Andrade', 'Lucas Andrade')).toBe(true);
    expect(autorEhOVendedor('Carla Souza', 'Lucas Andrade')).toBe(false);
  });

  it('RN-VEN-30: enviado_erp, Editado e status desconhecido não aparecem; a mesma etapa repetida entra uma vez', () => {
    const t = tags(eventosDoPedido([ev('received', '2026-11-08T14:00:00.000Z'), ev('received', '2026-11-08T14:00:00.000Z'), ev('sent_to_erp', '2026-11-08T14:10:00.000Z'), ev('edited', '2026-11-08T14:20:00.000Z'), ev('xyz', '2026-11-08T14:30:00.000Z')], { vendedorNome: 'Lucas Andrade' }));
    expect(t.map((x) => x.rotulo)).toEqual(['Enviado']);
  });

  it('RN-VEN-30: todo status do contrato tem tag, menos enviado_erp (passo interno)', () => {
    const rotulos = ORDER_STATUSES.map((st) => tags(eventosDoPedido([ev(st, '2026-11-08T14:00:00.000Z')], { vendedorNome: 'x' }))[0]?.rotulo ?? null);
    expect(rotulos).toEqual(ORDER_STATUSES.map((st) => (st === 'sent_to_erp' ? null : expect.any(String))));
    expect(rotulosDoHistorico('pedido')).toEqual(expect.arrayContaining(['Salvo', 'Na fila', 'Enviado', 'Em aprovação', 'Aprovado', 'Rejeitado', 'Recebido no ERP', 'Faturado parcial', 'Faturado', 'Cancelado']));
  });

  it('RN-VEN-30: sem nota no evento, Rejeitado e Cancelado usam o motivo do pedido (rejection_reason); os outros não', () => {
    const t = tags(eventosDoPedido([ev('received', '2026-11-08T14:00:00.000Z'), ev('rejected', '2026-11-08T15:00:00.000Z', 'Carla Souza', '')], { vendedorNome: 'Lucas Andrade', motivoDoFechamento: 'Títulos vencidos' }));
    expect(t.map((x) => x.motivo)).toEqual([null, 'Títulos vencidos']);
  });

  it('motivoDoEvento: vazio e frases técnicas viram null', () => {
    expect(motivoDoEvento('  ')).toBeNull();
    expect(motivoDoEvento('Recebido pelo servidor')).toBeNull();
    expect(motivoDoEvento('Aguardando envio')).toBeNull();
    expect(motivoDoEvento('Cliente  fechou\nem outro lugar')).toBe('Cliente fechou em outro lugar');
  });
});

describe('RN-VEN-30/18 (T-0138): histórico do orçamento', () => {
  const base = { vendedorNome: 'Lucas Andrade', criadoEm: '2026-11-08T14:35:00.000Z' };
  const t = (h: Parameters<typeof eventosDoOrcamento>[0], extra: Partial<Parameters<typeof eventosDoOrcamento>[1]> & { situacao: Parameters<typeof eventosDoOrcamento>[1]['situacao'] }) => tags(eventosDoOrcamento(h, { ...base, ...extra }), 'orcamento').map((x) => x.texto);

  it('RN-VEN-30: aberto mostra só "Salvo"', () => {
    expect(t([ev('received', '2026-11-08T14:35:00.000Z', 'Lucas Andrade', 'Recebido pelo servidor.')], { situacao: 'aberto' })).toEqual(['Salvo · 08/11 10:35']);
  });
  it('RN-VEN-30: sem eventos usa a criação; transformado vem da situação calculada; orçamento nunca vence (RN-VEN-18)', () => {
    expect(t([], { situacao: 'aberto' })).toEqual(['Salvo · 08/11 10:35']);
    expect(t([], { situacao: 'convertido', convertidoEm: '2026-11-09T13:00:00.000Z', numeroPedido: '000013' })).toEqual(['Salvo · 08/11 10:35', 'Transformado em pedido nº 000013 · 09/11 09:00']);
  });
  it('RN-VEN-30: cancelado leva o motivo', () => {
    const tg = tags(eventosDoOrcamento([ev('received', '2026-11-08T14:35:00.000Z'), ev('cancelled', '2026-11-08T18:00:00.000Z', 'Lucas Andrade', 'Cliente desistiu')], { ...base, situacao: 'cancelado' }), 'orcamento');
    expect(tg.map((x) => x.rotulo)).toEqual(['Salvo', 'Cancelado']);
    expect(tg[1]!.motivo).toBe('Cliente desistiu');
  });
});

describe('RF-VEN-05 (T-0138): cabeçalho, itens e total', () => {
  it('cliente com código e vendedor', () => {
    expect(clienteComCodigo('Mercadinho São Jorge', 'C5002')).toBe('Mercadinho São Jorge · cód. C5002');
    expect(clienteComCodigo('Mercadinho São Jorge', ' ')).toBe('Mercadinho São Jorge');
    expect(linhaDoVendedor('Lucas Andrade')).toBe('Vendedor: Lucas Andrade');
    expect(linhaDoVendedor('')).toBe('');
  });
  it('mais de 8 itens: os 8 primeiros e "Ver os 23 itens"', () => {
    const itens = Array.from({ length: 23 }, (_, i) => i);
    expect(itensVisiveis(itens, false)).toMatchObject({ visiveis: itens.slice(0, 8), rotuloVerTodos: 'Ver os 23 itens' });
    expect(itensVisiveis(itens, true).visiveis).toHaveLength(23);
    expect(itensVisiveis(itens.slice(0, 8), false).rotuloVerTodos).toBeNull();
  });
  it('desconto do item na 2ª linha, com R$ por unidade e a sigla da medida', () => {
    expect(siglaDaMedida('CX c/ 12')).toBe('CX');
    expect(siglaDaMedida('')).toBe('UN');
    expect(linhaDoAjusteDoItem({ discount_pct: 5, unit_price_cents: 2000, unit_label: 'FD' })).toBe(`Desc 5,0% · −${formatBRL(100)}/FD`);
    expect(linhaDoAjusteDoItem({ surcharge_pct: 3, unit_price_cents: 2000, unit_label: 'CX c/ 12' })).toBe(`Acrésc 3,0% · +${formatBRL(60)}/CX`);
    expect(linhaDoAjusteDoItem({ discount_pct: 0, unit_price_cents: 2000 })).toBeNull();
  });
  it('forma · prazo · frete (FOB leva a transportadora; parte vazia sai)', () => {
    expect(linhaFormaPrazoFrete({ forma: 'Pix', prazo: 'À vista', modalidade: 'CIF' })).toBe('Pix · À vista · CIF');
    expect(linhaFormaPrazoFrete({ forma: 'Boleto', prazo: '28/56 dias', modalidade: 'FOB', transportadora: 'Transportes Rio Negro' })).toBe('Boleto · 28/56 dias · FOB · Transportes Rio Negro');
    expect(linhaFormaPrazoFrete({ prazo: '28 dias', modalidade: null })).toBe('28 dias');
  });
});

describe('RF-VEN-05 / RN-VEN-31 (T-0138): onde fica cada ação (pedido-v2 §4.3)', () => {
  const base: EntradaAcoesDoDetalhe = { tipo: 'pedido', status: 'received', situacao: null, naFila: false, recusado: false, somenteLeitura: false, podeEditar: false, podeCancelar: false, podeDuplicar: true, podePdf: true, podeConverter: false, pedidoGeradoId: null };
  const ids = (a: ReturnType<typeof acoesDoDetalhe>) => ({ principal: a.principal?.id ?? null, icones: a.icones.map((x) => x.id), menu: a.menu.map((x) => x.id) });

  it('RF-VEN-05: orçamento aberto: Transformar em pedido grande; Editar, PDF, Duplicar em ícone; Cancelar no ⋮', () => {
    expect(ids(acoesDoDetalhe({ ...base, tipo: 'orcamento', situacao: 'aberto', podeConverter: true, podeEditar: true, podeCancelar: true }))).toEqual({ principal: 'transformar', icones: ['editar', 'pdf', 'duplicar'], menu: ['cancelar'] });
  });
  it('RN-VEN-18 (T-0141 G): com o preço congelado vencido, o principal Transformar traz o apoio "Entra pelos preços de hoje"; vigente, sem apoio', () => {
    const e = { ...base, tipo: 'orcamento' as const, situacao: 'aberto' as const, podeConverter: true };
    expect(acoesDoDetalhe({ ...e, precoVencido: true }).principal?.apoio).toBe('Entra pelos preços de hoje');
    expect(acoesDoDetalhe({ ...e, precoVencido: false }).principal?.apoio).toBeUndefined();
    expect(acoesDoDetalhe(e).principal?.apoio).toBeUndefined();
  });
  it('RN-VEN-18: orçamento transformado: PDF, Duplicar e "Pedido" (abre o gerado)', () => {
    expect(ids(acoesDoDetalhe({ ...base, tipo: 'orcamento', situacao: 'convertido', pedidoGeradoId: 'p1' }))).toEqual({ principal: null, icones: ['pdf', 'duplicar', 'pedido'], menu: [] });
  });
  it('RN-VEN-30: pedido na fila é só leitura (PDF); o recusado volta com Corrigir pedido e cancela pelo ⋮', () => {
    expect(ids(acoesDoDetalhe({ ...base, status: 'queued', naFila: true, podeEditar: true, podeCancelar: true }))).toEqual({ principal: null, icones: ['pdf'], menu: [] });
    expect(ids(acoesDoDetalhe({ ...base, status: 'queued', naFila: true, recusado: true, podeEditar: true, podeCancelar: true }))).toEqual({ principal: 'corrigir', icones: ['pdf', 'duplicar'], menu: ['cancelar'] });
  });
  it('RF-VEN-05: rascunho (Salvo): Continuar pedido grande e Descartar pedido no ⋮', () => {
    const a = acoesDoDetalhe({ ...base, status: 'draft', podeEditar: true, podeCancelar: true });
    expect(ids(a)).toEqual({ principal: 'continuar', icones: [], menu: ['cancelar'] });
    expect(a.menu[0]!.rotulo).toBe('Descartar pedido');
  });
  it('RN-VEN-31: pedido enviado: Cancelar pedido só aparece no ⋮ quando o domain libera (aceite do conector)', () => {
    expect(ids(acoesDoDetalhe({ ...base, status: 'integrated', podeCancelar: false }))).toEqual({ principal: null, icones: ['pdf', 'duplicar'], menu: [] });
    expect(ids(acoesDoDetalhe({ ...base, status: 'integrated', podeCancelar: true }))).toEqual({ principal: null, icones: ['pdf', 'duplicar'], menu: ['cancelar'] });
  });
  it('RF-VEN-05: rejeitado: Corrigir pedido (se editável), PDF, Duplicar e Cancelar pedido no ⋮', () => {
    expect(ids(acoesDoDetalhe({ ...base, status: 'rejected', podeEditar: true, podeCancelar: true }))).toEqual({ principal: 'corrigir', icones: ['pdf', 'duplicar'], menu: ['cancelar'] });
  });
  it('RN-PRO-01: sem permissão de escrita (promotor) não há nenhuma ação', () => {
    expect(ids(acoesDoDetalhe({ ...base, somenteLeitura: true, podeEditar: true, podeCancelar: true }))).toEqual({ principal: null, icones: [], menu: [] });
  });
  it('RF-VEN-05: todo rótulo de ícone é curto (1 palavra, até 10 letras); Cancelar nunca é ícone nem principal', () => {
    const todas = [
      acoesDoDetalhe({ ...base, tipo: 'orcamento', situacao: 'aberto', podeConverter: true, podeEditar: true, podeCancelar: true }),
      acoesDoDetalhe({ ...base, tipo: 'orcamento', situacao: 'convertido', pedidoGeradoId: 'p' }),
      acoesDoDetalhe({ ...base, status: 'rejected', podeEditar: true, podeCancelar: true }),
    ];
    for (const a of todas) {
      for (const i of a.icones) expect(rotuloCurtoOk(i.rotulo)).toBe(true);
      expect(a.icones.concat(a.principal ? [a.principal] : []).some((i) => i.id === 'cancelar')).toBe(false);
      expect(a.icones.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('T-0151 (RN-VEN-03): o rótulo do desconto do detalhe sai dos centavos', () => {
  it('RN-VEN-03: tabela 1.000,00 e total 899,00 (item com desconto e pedido com 15% digitado) mostra "Desconto 10,1%", não 15,0%', () => {
    expect(rotuloDoDescontoNoDetalhe({ subtotal_cents: 100_000, total_cents: 89_900 })).toBe('Desconto 10,1%');
  });
  it('RN-VEN-03: 8,8% também sai do total gravado, igual ao Resumo e ao PDF', () => {
    expect(rotuloDoDescontoNoDetalhe({ subtotal_cents: 100_000, total_cents: 91_200 })).toBe('Desconto 8,8%');
  });
});
