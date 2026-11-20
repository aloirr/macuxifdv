/** T-0187 (supervisor em campo): "Em nome de", nível de aprovação do autor. Funções puras. */
import { describe, expect, it } from 'vitest';
import { equipeEmNomeDosMembros, MSG_SEM_VENDEDORES_EM_NOME, opcoesEmNome, vendedorPadraoEmNome } from './pedido-em-nome';

const equipe = [
  { id: 'carla', nome: 'Carla Lima', ativo: true, perfil: 'vendedor' },
  { id: 'joao', nome: 'João Melo', ativo: true, perfil: 'vendedor' },
  { id: 'paulo', nome: 'Paulo Reis', ativo: true, perfil: 'vendedor' },
];
const carteira = (u: string, c = 'c1') => ({ usuario_id: u, cliente_id: c });

describe('RN-VEN-35: o vendedor padrão é o da carteira do cliente', () => {
  it('um único vendedor da equipe com o cliente na carteira: é o padrão', () => {
    expect(vendedorPadraoEmNome({ clienteId: 'c1', carteira: [carteira('carla'), carteira('outro-time')], equipe })).toBe('carla');
  });
  it('dois vendedores da equipe com o cliente: sem padrão (o campo vem vazio)', () => {
    expect(vendedorPadraoEmNome({ clienteId: 'c1', carteira: [carteira('carla'), carteira('joao')], equipe })).toBeNull();
  });
  it('nenhum vendedor da equipe com o cliente, ou vendedor inativo: sem padrão', () => {
    expect(vendedorPadraoEmNome({ clienteId: 'c1', carteira: [carteira('fora')], equipe })).toBeNull();
    expect(vendedorPadraoEmNome({ clienteId: 'c1', carteira: [carteira('carla')], equipe: [{ ...equipe[0]!, ativo: false }] })).toBeNull();
  });
  it('RN-PRO-01: promotor nunca é o padrão', () => {
    expect(vendedorPadraoEmNome({ clienteId: 'c1', carteira: [carteira('pro')], equipe: [{ id: 'pro', nome: 'Pro', ativo: true, perfil: 'promotor' }] })).toBeNull();
  });
});

describe('RN-CORE-04 e RN-VEN-35: "Em nome de" lista só a equipe do autor', () => {
  const base = { autor: { id: 'sup', perfil: 'supervisor' }, clienteId: 'c1', carteira: [carteira('carla')], usuarios: [...equipe, { id: 'sup', nome: 'Marcos Dias', ativo: true, perfil: 'supervisor' }, { id: 'pro', nome: 'Ana', ativo: true, perfil: 'promotor' }, { id: 'fora', nome: 'Zé', ativo: true, perfil: 'vendedor' }], visiveis: new Set(['sup', 'carla', 'joao', 'paulo', 'pro']) as ReadonlySet<string> };
  it('ordem alfabética, sem o autor, sem promotor (RN-PRO-01) e sem vendedor de outra equipe', () => {
    expect(opcoesEmNome(base).map((o) => o.id)).toEqual(['carla', 'joao', 'paulo']);
  });
  it('marca "Carteira deste cliente" em quem tem o cliente', () => {
    const o = opcoesEmNome(base);
    expect(o.find((x) => x.id === 'carla')?.da_carteira).toBe(true);
    expect(o.find((x) => x.id === 'joao')?.da_carteira).toBe(false);
  });
  it('vendedor inativo fica desligado com "Saiu da equipe"', () => {
    const o = opcoesEmNome({ ...base, usuarios: base.usuarios.map((u) => (u.id === 'joao' ? { ...u, ativo: false } : u)) }).find((x) => x.id === 'joao');
    expect(o).toMatchObject({ desligado: true, motivo: 'Saiu da equipe' });
  });
  it('visiveis = tenant (admin) não filtra por equipe, mas segue sem promotor e sem o autor', () => {
    expect(opcoesEmNome({ ...base, visiveis: 'tenant' }).map((o) => o.id)).toEqual(['carla', 'joao', 'paulo', 'fora']);
  });
});

describe('RN-GES-04: a aprovação do pedido em nome sobe ao nível do autor para cima', () => {
  it('o nível do pedido acompanha as aprovações elevadas', async () => {
    const { comNivelDoAutor } = await import('./aprovacao');
    const r = { status: 'pending_approval', nivel: 'supervisor', motivos: ['credito'], aprovacoes: [{ motivo: 'credito', nivel: 'supervisor', texto: 'x' }], aprovacao_automatica: false, pending_reason: 'x', historico: [] } as unknown as Parameters<typeof comNivelDoAutor>[0];
    expect(comNivelDoAutor(r, 'supervisor')).toMatchObject({ nivel: 'gerente', aprovacoes: [{ nivel: 'gerente' }] });
  });
});

describe('RN-VEN-35 e RN-PRO-01 (T-0187): pendência do vendedor', () => {
  it('RN-VEN-35: sem vendedor em "Em nome de" falta o "Vendedor" na aba Venda', async () => {
    const { pendenciasDePreenchimento } = await import('./pendencias-preenchimento');
    const p = pendenciasDePreenchimento({ itens: 1, quantidade_invalida: false, pagamento: { tipo: 'ok' }, frete: 'ok', erros_calculo: [], em_nome_sem_vendedor: true });
    expect(p).toEqual([{ id: 'vendedor', texto: 'Vendedor', aba: 'venda' }]);
  });
});

describe('RN-PRO-01 e RN-CORE-04 (T-0187 critérios 13 e 14): a equipe do "Em nome de" vem da consulta gestor.membros_da_equipe@1', () => {
  const V = '11111111-1111-4111-8111-111111111111';
  const P = '22222222-2222-4222-8222-222222222222';
  const S = '33333333-3333-4333-8333-333333333333';
  const W = '44444444-4444-4444-8444-444444444444';
  const L1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const L2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const m = (usuario_id: string, nome: string, perfil: string, equipe_id: string | null, ativo = true) => ({ usuario_id, nome, perfil, equipe_id, ativo });
  const membros = [m(V, 'Carla', 'vendedor', L1), m(P, 'Paulo', 'promotor', L1), m(S, 'Saulo', 'vendedor', L1, false), m(W, 'Wilma', 'vendedor', L2), m('g', 'Rui', 'supervisor', L2)];
  const equipes = [{ equipe_id: L1, nome: 'Marcos Dias' }, { equipe_id: L2, nome: 'Ana Reis' }];

  it('RN-PRO-01: o promotor e o supervisor da lista não entram e nunca viram o padrão (critério 13)', () => {
    const eq = equipeEmNomeDosMembros({ autor: { id: 'sup', perfil: 'supervisor' }, membros, equipes });
    expect(eq.map((u) => u.id).sort()).toEqual([V, S, W].sort());
    expect(vendedorPadraoEmNome({ clienteId: C, carteira: [{ usuario_id: P, cliente_id: C }], equipe: eq })).toBeNull();
  });

  it('o próprio autor não entra, mesmo vendedor', () => {
    expect(equipeEmNomeDosMembros({ autor: { id: V, perfil: 'supervisor' }, membros, equipes }).map((u) => u.id)).not.toContain(V);
  });

  it('RN-CORE-04: vendedor inativo vem desligado, "Saiu da equipe", e não é o padrão (critério 14)', () => {
    const eq = equipeEmNomeDosMembros({ autor: { id: 'sup', perfil: 'supervisor' }, membros, equipes });
    const ops = opcoesEmNome({ autor: { id: 'sup', perfil: 'supervisor' }, clienteId: C, carteira: [], usuarios: eq, visiveis: 'tenant' });
    expect(ops.find((o) => o.id === S)).toMatchObject({ desligado: true, motivo: 'Saiu da equipe' });
    expect(vendedorPadraoEmNome({ clienteId: C, carteira: [{ usuario_id: S, cliente_id: C }], equipe: eq })).toBeNull();
  });

  it('RN-CORE-04: o supervisor não vê grupo; o gerente vê agrupado por equipe, na ordem da equipe e do nome', () => {
    const sup = equipeEmNomeDosMembros({ autor: { id: 'sup', perfil: 'supervisor' }, membros, equipes });
    expect(sup.every((u) => u.grupo === null)).toBe(true);
    const ger = equipeEmNomeDosMembros({ autor: { id: 'ger', perfil: 'gerente' }, membros, equipes });
    const ops = opcoesEmNome({ autor: { id: 'ger', perfil: 'gerente' }, clienteId: C, carteira: [{ usuario_id: W, cliente_id: C }], usuarios: ger, visiveis: 'tenant' });
    expect(ops.map((o) => [o.grupo, o.nome])).toEqual([['Ana Reis', 'Wilma'], ['Marcos Dias', 'Carla'], ['Marcos Dias', 'Saulo']]);
    expect(ops.find((o) => o.id === W)?.da_carteira).toBe(true);
    expect(vendedorPadraoEmNome({ clienteId: C, carteira: [{ usuario_id: W, cliente_id: C }], equipe: ger })).toBe(W);
  });

  it('cache vazio (lista vazia): nenhuma opção e a linha com a ação', () => {
    expect(equipeEmNomeDosMembros({ autor: { id: 'sup', perfil: 'supervisor' }, membros: [], equipes: [] })).toEqual([]);
    expect(MSG_SEM_VENDEDORES_EM_NOME).toBe('Nenhum vendedor na lista. Sincronize e tente de novo.');
  });
});
