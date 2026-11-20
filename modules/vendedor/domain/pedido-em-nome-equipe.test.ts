/** T-0187 (supervisor em campo): "Em nome de", nível de aprovação do autor. Funções puras. */
import { describe, expect, it } from 'vitest';
import { opcoesEmNome, vendedorPadraoEmNome } from './pedido-em-nome';

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

describe('RN-PRO-01 e RN-CORE-04 (T-0187 critérios 13 e 14): a equipe do "Em nome de" vem do papel da carteira', () => {
  const V = '11111111-1111-4111-8111-111111111111';
  const P = '22222222-2222-4222-8222-222222222222';
  const S = '33333333-3333-4333-8333-333333333333';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const hoje = '2026-11-20';
  const v = (usuario_id: string, papel: 'vendedor' | 'promotor', fim: string | null = null, extra: object = {}) => ({ usuario_id, cliente_id: C, papel, inicio: null, fim, ...extra });
  const nomes = new Map([[V, 'Carla'], [P, 'Paulo'], [S, 'Saulo']]);

  it('RN-PRO-01: o promotor da equipe não entra na lista nem vira o padrão (critério 13)', async () => {
    const { equipeEmNomeDaCarteira } = await import('./pedido-em-nome');
    const equipe = equipeEmNomeDaCarteira({ carteiras: [v(V, 'vendedor'), v(P, 'promotor')], hoje, nomes });
    expect(equipe.map((u) => u.id)).toEqual([V]);
    expect(vendedorPadraoEmNome({ clienteId: C, carteira: [{ usuario_id: P, cliente_id: C }], equipe })).toBeNull();
    expect(opcoesEmNome({ autor: { id: 'g', perfil: 'supervisor' }, clienteId: C, carteira: [], usuarios: equipe, visiveis: 'tenant' }).map((o) => o.id)).toEqual([V]);
  });

  it('RN-PRO-01: quem tem vínculo de promotor em qualquer cliente fica fora, mesmo com um de vendedor', async () => {
    const { equipeEmNomeDaCarteira } = await import('./pedido-em-nome');
    expect(equipeEmNomeDaCarteira({ carteiras: [v(P, 'vendedor'), v(P, 'promotor')], hoje, nomes })).toEqual([]);
  });

  it('RN-CORE-04: vendedor sem vínculo vigente (fim passado ou apagado) vem desligado, "Saiu da equipe" (critério 14)', async () => {
    const { equipeEmNomeDaCarteira } = await import('./pedido-em-nome');
    const equipe = equipeEmNomeDaCarteira({ carteiras: [v(V, 'vendedor'), v(S, 'vendedor', '2026-10-01')], hoje, nomes });
    expect(equipe.find((u) => u.id === S)?.ativo).toBe(false);
    expect(equipe.find((u) => u.id === V)?.ativo).toBe(true);
    const ops = opcoesEmNome({ autor: { id: 'g', perfil: 'supervisor' }, clienteId: C, carteira: [], usuarios: equipe, visiveis: 'tenant' });
    expect(ops.find((o) => o.id === S)).toMatchObject({ desligado: true, motivo: 'Saiu da equipe' });
    expect(vendedorPadraoEmNome({ clienteId: C, carteira: [{ usuario_id: S, cliente_id: C }], equipe })).toBeNull();
    const apagado = equipeEmNomeDaCarteira({ carteiras: [v(S, 'vendedor', null, { deleted_at: '2026-11-01T00:00:00Z' })], hoje, nomes });
    expect(apagado[0]?.ativo).toBe(false);
  });

  it('RN-CORE-04: vínculo que ainda não começou não traz o vendedor', async () => {
    const { equipeEmNomeDaCarteira } = await import('./pedido-em-nome');
    expect(equipeEmNomeDaCarteira({ carteiras: [v(V, 'vendedor', null, { inicio: '2026-12-01' })], hoje, nomes })).toEqual([]);
  });
});
