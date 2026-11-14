import { describe, expect, it } from 'vitest';
import { itensDoPedidoVisiveis, prazoMedioDias, resumoDeVisitas, ultimosItensComprados } from './performance-cliente';

const ped = (id: string, dias: number | null | undefined, status = 'approved', deleted_at: string | null = null) => ({ id, status, deleted_at, prazo_medio_dias: dias, data: '2026-11-01T10:00:00.000Z' });
const it_ = (produto_id: string, quando: string, quantidade: number, preco: number, unidade: string | null = 'CX') => ({ produto_id, produto_nome: `P ${produto_id}`, quantidade, unidade, preco_unitario_cents: preco, data: quando });

describe('RN-CORE-50: aba Performance do cliente', () => {
  it('RN-CORE-50: prazo médio é a média, em dias, do prazo dos pedidos do cliente; pedido sem prazo não entra', () => {
    expect(prazoMedioDias([ped('a', 28), ped('b', 14), ped('c', null), ped('d', undefined)])).toBe(21);
    expect(prazoMedioDias([ped('a', 10), ped('b', 15)])).toBe(13);
  });
  it('RN-CORE-50: sem pedido com prazo, o prazo médio é nulo (a seção não aparece)', () => {
    expect(prazoMedioDias([])).toBeNull();
    expect(prazoMedioDias([ped('a', null)])).toBeNull();
  });
  it('RN-CORE-50: rascunho, cancelado, rejeitado e pedido apagado não contam no prazo médio nem nos itens', () => {
    const peds = [ped('a', 30), ped('b', 0, 'draft'), ped('c', 0, 'cancelled'), ped('d', 0, 'rejected'), ped('e', 0, 'approved', '2026-11-02T00:00:00Z')];
    expect(prazoMedioDias(peds)).toBe(30);
    const itens = [{ pedido_id: 'a', produto_id: 'p1' }, { pedido_id: 'b', produto_id: 'p2' }, { pedido_id: 'e', produto_id: 'p3' }];
    expect(itensDoPedidoVisiveis(peds, itens).map((i) => i.produto_id)).toEqual(['p1']);
  });
  it('RN-CORE-50: últimos itens comprados são um por produto, do mais recente ao mais antigo, com volume, data e último preço da última compra', () => {
    const r = ultimosItensComprados([it_('p1', '2026-09-01T10:00:00Z', 2, 1000), it_('p2', '2026-10-05T10:00:00Z', 5, 300, 'UN'), it_('p1', '2026-10-20T10:00:00Z', 3, 1100)], 20);
    expect(r.map((x) => x.produto_id)).toEqual(['p1', 'p2']);
    expect(r[0]).toMatchObject({ quantidade: 3, unidade: 'CX', preco_unitario_cents: 1100, data: '2026-10-20T10:00:00Z' });
  });
  it('RN-CORE-50: a lista de itens tem no máximo 20 produtos', () => {
    const muitos = Array.from({ length: 25 }, (_, i) => it_(`p${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`, 1, 100));
    const r = ultimosItensComprados(muitos, 20);
    expect(r).toHaveLength(20);
    expect(r[0]!.produto_id).toBe('p24');
  });
  it('RN-CORE-50: visitas: total, data e quem visitou por último (a data do sync vale se for mais recente)', () => {
    const v = [{ usuario_id: 'u1', checkin_em: '2026-11-03T12:00:00.000Z' }, { usuario_id: 'u2', checkin_em: '2026-11-10T12:00:00.000Z' }];
    expect(resumoDeVisitas(v, 'America/Sao_Paulo', null)).toEqual({ total: 2, ultima_data: '2026-11-10', ultimo_usuario_id: 'u2' });
    expect(resumoDeVisitas(v, 'America/Sao_Paulo', '2026-11-12')).toEqual({ total: 2, ultima_data: '2026-11-12', ultimo_usuario_id: null });
    expect(resumoDeVisitas([], 'America/Sao_Paulo', null)).toEqual({ total: 0, ultima_data: null, ultimo_usuario_id: null });
  });
});

describe('RN-CORE-51: botão Pesquisa no rodapé e checkout só com atendimento aberto', () => {
  it('RN-CORE-51: o rodapé mostra Pesquisa se a extensão existe; Checkout só com atendimento aberto neste cliente', async () => {
    const { botoesDoRodapeCliente } = await import('./performance-cliente');
    expect(botoesDoRodapeCliente({ temPesquisa: true, atendimentoAqui: false, checkinPermitido: false })).toEqual({ checkin: false, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ temPesquisa: false, atendimentoAqui: true, checkinPermitido: true })).toEqual({ checkin: false, checkout: true, pesquisa: false });
  });
});
