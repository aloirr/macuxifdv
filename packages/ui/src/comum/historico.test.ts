import { describe, expect, it } from 'vitest';

import { leituraDoHistorico, leituraDoQuando, motivoEmUmaLinha, quandoCurto, rotulosDoHistorico, tagDoHistorico, tagsDoHistorico } from './historico';

const TZ = 'America/Manaus';
// 08/11/2026 10:35 em Manaus (UTC−4)
const AGORA = '2026-11-08T18:00:00Z';
const ctxPedido = { tipo: 'pedido' as const, tz: TZ, agora: AGORA };
const ctxOrc = { tipo: 'orcamento' as const, tz: TZ, agora: AGORA };

describe('histórico em tags (RN-VEN-30, T-0133)', () => {
  it('cobre todos os rótulos do pedido e do orçamento da RN-VEN-30, sem texto técnico', () => {
    expect(rotulosDoHistorico('pedido')).toEqual(['Salvo', 'Na fila', 'Enviado', 'Em aprovação', 'Aprovado', 'Rejeitado', 'Recebido no ERP', 'Faturado parcial', 'Faturado', 'Cancelado']);
    expect(rotulosDoHistorico('orcamento')).toEqual(['Salvo', 'Transformado em pedido nº', 'Vencido', 'Cancelado']);
    for (const r of [...rotulosDoHistorico('pedido'), ...rotulosDoHistorico('orcamento')]) expect(r).not.toMatch(/servidor|recebido pelo/i);
  });

  it('data e hora curtas no fuso do tenant; de outro ano, com o ano de 2 dígitos', () => {
    expect(quandoCurto('2026-11-08T14:35:00Z', AGORA, TZ)).toBe('08/11 10:35');
    // 22h em Manaus já é o dia seguinte em UTC: a tag mostra o dia de Manaus
    expect(quandoCurto('2026-11-09T02:10:00Z', AGORA, TZ)).toBe('08/11 22:10');
    expect(quandoCurto('2025-12-30T15:00:00Z', AGORA, TZ)).toBe('30/12/25 11:00');
    expect(quandoCurto('não é data', AGORA, TZ)).toBe('');
    expect(leituraDoQuando('2026-11-08T14:35:00Z', AGORA, TZ)).toBe('8 de novembro às 10:35');
    expect(leituraDoQuando('2025-12-30T15:00:00Z', AGORA, TZ)).toBe('30 de dezembro de 2025 às 11:00');
  });

  it('a tag do orçamento salvo segue o desenho do dono do produto: "Salvo · 08/11 10:35"', () => {
    const t = tagDoHistorico({ status: 'salvo', em: '2026-11-08T14:35:00Z' }, ctxOrc);
    expect(t).toMatchObject({ rotulo: 'Salvo', texto: 'Salvo · 08/11 10:35', tom: 'neutro', motivo: null });
    expect(t?.leitura).toBe('Salvo, 8 de novembro às 10:35');
  });

  it('aceita o vocabulário do contrato e os ids do banco, com o mesmo rótulo', () => {
    const pares: Array<[string, string, string]> = [
      ['rascunho', 'draft', 'Salvo'],
      ['na_fila', 'queued', 'Na fila'],
      ['recebido', 'received', 'Enviado'],
      ['em_aprovacao', 'pending_approval', 'Em aprovação'],
      ['aprovado', 'approved', 'Aprovado'],
      ['rejeitado', 'rejected', 'Rejeitado'],
      ['integrado_erp', 'integrated', 'Recebido no ERP'],
      ['faturado_parcial', 'invoiced_partial', 'Faturado parcial'],
      ['faturado_total', 'invoiced', 'Faturado'],
      ['cancelado', 'cancelled', 'Cancelado'],
    ];
    for (const [contrato, banco, rotulo] of pares) {
      expect(tagDoHistorico({ status: contrato, em: AGORA }, ctxPedido)?.rotulo, contrato).toBe(rotulo);
      expect(tagDoHistorico({ status: banco, em: AGORA }, ctxPedido)?.rotulo, banco).toBe(rotulo);
    }
    expect(tagDoHistorico({ status: 'FATURADO', em: AGORA }, ctxPedido)?.rotulo).toBe('Faturado');
  });

  it('cor sempre com texto: tons por status', () => {
    const tom = (status: string) => tagDoHistorico({ status, em: AGORA }, ctxPedido)?.tom;
    expect(tom('rascunho')).toBe('neutro');
    expect(tom('na_fila')).toBe('aviso');
    expect(tom('recebido')).toBe('neutro');
    expect(tom('em_aprovacao')).toBe('destaque');
    expect(tom('aprovado')).toBe('sucesso');
    expect(tom('rejeitado')).toBe('erro');
    expect(tom('integrado_erp')).toBe('sucesso');
    expect(tom('cancelado')).toBe('erro');
    expect(tagDoHistorico({ status: 'vencido', em: AGORA }, ctxOrc)?.tom).toBe('aviso');
    expect(tagDoHistorico({ status: 'convertido', em: AGORA }, ctxOrc)?.tom).toBe('sucesso');
  });

  it('Rejeitado e Cancelado levam o motivo em 1 linha; os outros status ignoram o motivo', () => {
    const r = tagDoHistorico({ status: 'rejeitado', em: '2026-11-08T18:02:00Z', motivo: '  Desconto acima\nda alçada  ' }, ctxPedido);
    expect(r?.motivo).toBe('Desconto acima da alçada');
    expect(r?.leitura).toBe('Rejeitado, 8 de novembro às 14:02. Motivo: Desconto acima da alçada');
    expect(tagDoHistorico({ status: 'cancelado', em: AGORA, motivo: 'Cliente desistiu' }, ctxOrc)?.motivo).toBe('Cliente desistiu');
    expect(tagDoHistorico({ status: 'aprovado', em: AGORA, motivo: 'qualquer' }, ctxPedido)?.motivo).toBeNull();
    expect(tagDoHistorico({ status: 'rejeitado', em: AGORA, motivo: '   ' }, ctxPedido)?.motivo).toBeNull();
    expect(motivoEmUmaLinha(null)).toBeNull();
  });

  it('o autor só aparece quando não é o vendedor do pedido', () => {
    const gestor = tagDoHistorico({ status: 'aprovado', em: '2026-11-08T15:20:00Z', autor: 'Carla Souza' }, ctxPedido);
    expect(gestor?.texto).toBe('Aprovado · 08/11 11:20 · Carla Souza');
    expect(gestor?.leitura).toBe('Aprovado, 8 de novembro às 11:20, por Carla Souza');
    const vendedor = tagDoHistorico({ status: 'aprovado', em: '2026-11-08T15:20:00Z', autor: 'Lucas Andrade', autorEhVendedor: true }, ctxPedido);
    expect(vendedor?.texto).toBe('Aprovado · 08/11 11:20');
  });

  it('orçamento transformado mostra o número do pedido gerado', () => {
    expect(tagDoHistorico({ status: 'convertido', em: '2026-11-09T13:00:00Z', numeroPedido: '000013' }, ctxOrc)?.texto).toBe('Transformado em pedido nº 000013 · 09/11 09:00');
    expect(tagDoHistorico({ status: 'convertido', em: '2026-11-09T13:00:00Z' }, ctxOrc)?.rotulo).toBe('Transformado em pedido');
  });

  it('status sem tag, evento técnico ou data inválida não aparecem (nunca o código cru)', () => {
    expect(tagDoHistorico({ status: 'enviado_erp', em: AGORA }, ctxPedido)).toBeNull();
    expect(tagDoHistorico({ status: 'edited', em: AGORA }, ctxPedido)).toBeNull();
    expect(tagDoHistorico({ status: 'qualquer_coisa', em: AGORA }, ctxPedido)).toBeNull();
    expect(tagDoHistorico({ status: 'aprovado', em: 'ontem' }, ctxPedido)).toBeNull();
    // o orçamento não tem "Aprovado"
    expect(tagDoHistorico({ status: 'aprovado', em: AGORA }, ctxOrc)).toBeNull();
    expect(tagDoHistorico({ status: 'constructor', em: AGORA }, ctxPedido)).toBeNull();
  });

  it('tagsDoHistorico ordena do mais antigo ao mais recente e tira o que não tem tag', () => {
    const tags = tagsDoHistorico(
      [
        { id: 'c', status: 'aprovado', em: '2026-11-08T15:20:00Z' },
        { id: 'a', status: 'rascunho', em: '2026-11-08T14:35:00Z' },
        { id: 'x', status: 'enviado_erp', em: '2026-11-08T15:21:00Z' },
        { id: 'b', status: 'recebido', em: '2026-11-08T14:36:00Z' },
      ],
      ctxPedido,
    );
    expect(tags.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(tags.map((t) => t.texto)).toEqual(['Salvo · 08/11 10:35', 'Enviado · 08/11 10:36', 'Aprovado · 08/11 11:20']);
    expect(leituraDoHistorico('Histórico', 3)).toBe('Histórico: 3 etapas');
    expect(leituraDoHistorico('Histórico', 1)).toBe('Histórico: 1 etapa');
  });
});
