import { describe, expect, it } from 'vitest';
import { botoesDoRodapeCliente, itensDoPedidoVisiveis, prazoMedioDoCliente, quemVisitouPorUltimo, resumoDeVisitas, ultimosItensComprados } from './performance-cliente';

const ped = (id: string, dias: number | null | undefined, status = 'approved', deleted_at: string | null = null) => ({ id, status, deleted_at, prazo_medio_dias: dias, data: '2026-11-01T10:00:00.000Z' });
const it_ = (produto_id: string, quando: string, quantidade: number, preco: number, unidade: string | null = 'CX') => ({ produto_id, produto_nome: `P ${produto_id}`, quantidade, unidade, preco_unitario_cents: preco, data: quando });

describe('RN-CORE-50: aba Performance do cliente', () => {
  it('RN-CORE-50: prazo médio é a média, em dias, do prazo dos pedidos do cliente; pedido sem prazo não entra', () => {
    expect(prazoMedioDoCliente([ped('a', 28), ped('b', 14), ped('c', null), ped('d', undefined)])).toBe(21);
    expect(prazoMedioDoCliente([ped('a', 10), ped('b', 15)])).toBe(13);
  });
  it('RN-CORE-50: sem pedido com prazo, o prazo médio é nulo (a seção não aparece)', () => {
    expect(prazoMedioDoCliente([])).toBeNull();
    expect(prazoMedioDoCliente([ped('a', null)])).toBeNull();
  });
  it('RN-CORE-50: rascunho, cancelado, rejeitado e pedido apagado não contam no prazo médio nem nos itens', () => {
    const peds = [ped('a', 30), ped('b', 0, 'draft'), ped('c', 0, 'cancelled'), ped('d', 0, 'rejected'), ped('e', 0, 'approved', '2026-11-02T00:00:00Z')];
    expect(prazoMedioDoCliente(peds)).toBe(30);
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
  it('RN-CORE-50: visitas sem o resumo do servidor: total, data e quem visitou por último, só do aparelho', () => {
    const v = [{ usuario_id: 'u1', checkin_em: '2026-11-03T12:00:00.000Z' }, { usuario_id: 'u2', checkin_em: '2026-11-10T12:00:00.000Z' }];
    expect(resumoDeVisitas(v, 'America/Sao_Paulo')).toEqual({ total: 2, ultima_data: '2026-11-10', ultimo_usuario_id: 'u2', ultimo_usuario_nome: null });
    expect(resumoDeVisitas([], 'America/Sao_Paulo')).toEqual({ total: 0, ultima_data: null, ultimo_usuario_id: null, ultimo_usuario_nome: null });
  });
  const resumo = (o: Partial<{ total_visitas: number; ultima_visita_em: string | null; ultima_visita_usuario_id: string | null; ultima_visita_usuario_nome: string | null }> = {}) => ({
    total_visitas: 37,
    ultima_visita_em: '2026-11-13T02:30:00.000000Z',
    ultima_visita_usuario_id: 'u9',
    ultima_visita_usuario_nome: 'Ana Souza',
    ...o,
  });
  it('RN-CORE-50: com o resumo do servidor, o total é o do servidor e a última visita traz data no fuso do tenant e nome', () => {
    const v = [{ usuario_id: 'u1', checkin_em: '2026-11-03T12:00:00.000Z' }];
    // 02:30 UTC de 13/11 = 22:30 de 12/11 em Manaus
    expect(resumoDeVisitas(v, 'America/Manaus', resumo())).toEqual({ total: 37, ultima_data: '2026-11-12', ultimo_usuario_id: 'u9', ultimo_usuario_nome: 'Ana Souza' });
  });
  it('RN-CORE-50: check-in do aparelho depois do resumo soma no total e vira a última visita', () => {
    const v = [
      { usuario_id: 'u1', checkin_em: '2026-11-10T12:00:00.000Z' },
      { usuario_id: 'u1', checkin_em: '2026-11-14T13:00:00.000Z' },
    ];
    expect(resumoDeVisitas(v, 'America/Manaus', resumo())).toEqual({ total: 38, ultima_data: '2026-11-14', ultimo_usuario_id: 'u1', ultimo_usuario_nome: null });
  });
  it('RN-CORE-50: resumo de cliente sem visita no servidor usa o que o aparelho tem', () => {
    const v = [{ usuario_id: 'u1', checkin_em: '2026-11-14T13:00:00.000Z' }];
    expect(resumoDeVisitas(v, 'America/Manaus', resumo({ total_visitas: 0, ultima_visita_em: null, ultima_visita_usuario_id: null, ultima_visita_usuario_nome: null }))).toEqual({ total: 1, ultima_data: '2026-11-14', ultimo_usuario_id: 'u1', ultimo_usuario_nome: null });
  });
  it('RN-CORE-50: quem visitou por último: "Você" para o próprio usuário, senão o nome do resumo ou dos pedidos', () => {
    const r = { total: 1, ultima_data: '2026-11-12', ultimo_usuario_id: 'u9', ultimo_usuario_nome: 'Ana Souza' };
    expect(quemVisitouPorUltimo(r, 'u9', new Map())).toBe('Você');
    expect(quemVisitouPorUltimo(r, 'u1', new Map([['u9', 'Outro']]))).toBe('Ana Souza');
    expect(quemVisitouPorUltimo({ ...r, ultimo_usuario_nome: null }, 'u1', new Map([['u9', 'Bruno']]))).toBe('Bruno');
    expect(quemVisitouPorUltimo({ ...r, ultimo_usuario_nome: null }, 'u1', new Map())).toBeNull();
    expect(quemVisitouPorUltimo({ ...r, ultimo_usuario_id: null }, 'u1', new Map())).toBeNull();
  });
});

describe('RN-CORE-51/52: rodapé da ficha do cliente', () => {
  const base = { temPesquisa: true, atendimentoAqui: false, checkinPermitido: true, visitadoHoje: false };
  it('RN-CORE-51: sem atendimento aberto neste cliente e com permissão, mostra Check-in (e Pesquisa se houver)', () => {
    expect(botoesDoRodapeCliente(base)).toEqual({ checkin: true, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...base, temPesquisa: false })).toEqual({ checkin: true, checkout: false, pesquisa: false });
  });
  it('RN-CORE-51: com atendimento aberto neste cliente mostra Checkout no lugar do Check-in; sem a extensão, sem Pesquisa', () => {
    expect(botoesDoRodapeCliente({ ...base, atendimentoAqui: true })).toEqual({ checkin: false, checkout: true, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...base, temPesquisa: false, atendimentoAqui: true })).toEqual({ checkin: false, checkout: true, pesquisa: false });
  });
  it('RN-CORE-52: sem permissão (cliente fora de rota) o Check-in some', () => {
    expect(botoesDoRodapeCliente({ ...base, checkinPermitido: false })).toEqual({ checkin: false, checkout: false, pesquisa: true });
  });
  it('RN-CORE-13: cliente já visitado hoje (sem atendimento aberto) não repete o Check-in', () => {
    expect(botoesDoRodapeCliente({ ...base, visitadoHoje: true })).toEqual({ checkin: false, checkout: false, pesquisa: true });
  });
});
