/** T-0187 (supervisor em campo): "Em nome de", nível de aprovação do autor e dono da venda. Funções puras. */
import { describe, expect, it } from 'vitest';
import { donoDaVenda, elevarAoNivelDoAutor, nivelMinimoDoAutor, opcoesEmNome, vendedorPadraoEmNome } from './pedido-em-nome';

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

describe('RN-VEN-10 e RN-GES-04: ninguém aprova o próprio pedido; o motivo sobe um nível', () => {
  it('o nível mínimo de quem decide o pedido do autor', () => {
    expect(nivelMinimoDoAutor('supervisor')).toBe('gerente');
    expect(nivelMinimoDoAutor('gerente')).toBe('analista');
    expect(nivelMinimoDoAutor('vendedor')).toBeNull();
  });
  it('supervisor autor: motivo no nível supervisor vai ao gerente; o que já era gerente fica', () => {
    const r = elevarAoNivelDoAutor([{ motivo: 'credito', nivel: 'supervisor', texto: 'a' }, { motivo: 'inadimplencia', nivel: 'gerente', texto: 'b' }], 'supervisor');
    expect(r.map((a) => a.nivel)).toEqual(['gerente', 'gerente']);
  });
  it('gerente autor: motivo no nível gerente vai ao analista', () => {
    expect(elevarAoNivelDoAutor([{ motivo: 'credito', nivel: 'gerente', texto: 'a' }], 'gerente')[0]?.nivel).toBe('analista');
  });
  it('vendedor autor: nada muda', () => {
    const a = [{ motivo: 'credito' as const, nivel: 'supervisor' as const, texto: 'a' }];
    expect(elevarAoNivelDoAutor(a, 'vendedor')).toEqual(a);
  });
});

describe('RN-VEN-35 (P3 A): a venda conta para o vendedor de "Em nome de"', () => {
  it('em nome: o dono é o vendedor escolhido; sem vendedor, o autor', () => {
    expect(donoDaVenda({ autor_id: 'sup', vendedor_id: 'carla' })).toBe('carla');
    expect(donoDaVenda({ autor_id: 'v1', vendedor_id: null })).toBe('v1');
    expect(donoDaVenda({ autor_id: 'v1', vendedor_id: 'v1' })).toBe('v1');
  });
});

describe('RN-GES-04: a aprovação do pedido em nome sobe ao nível do autor para cima', () => {
  it('o nível do pedido acompanha as aprovações elevadas', async () => {
    const { comNivelDoAutor } = await import('./aprovacao');
    const r = { status: 'pending_approval', nivel: 'supervisor', motivos: ['credito'], aprovacoes: [{ motivo: 'credito', nivel: 'supervisor', texto: 'x' }], aprovacao_automatica: false, pending_reason: 'x', historico: [] } as unknown as Parameters<typeof comNivelDoAutor>[0];
    expect(comNivelDoAutor(r, 'supervisor')).toMatchObject({ nivel: 'gerente', aprovacoes: [{ nivel: 'gerente' }] });
  });
});

describe('RN-VEN-35 e RN-PRO-01 (T-0187): trava do promotor e pendência do vendedor', () => {
  it('RN-PRO-01: promotor como autor é recusado antes de qualquer outra checagem', async () => {
    const { verificarPedidoEmNome } = await import('./pedido-em-nome');
    expect(verificarPedidoEmNome({ autor: { id: 'p', perfil: 'promotor' }, vendedor_id: 'carla', vendedor: { id: 'carla', perfil: 'vendedor' }, visiveis: 'tenant' })).toMatchObject({ codigo: 'RN-PRO-01', http: 403 });
  });
  it('RN-VEN-35: vendedor de outra equipe volta "Vendedor fora da sua equipe"', async () => {
    const { verificarPedidoEmNome } = await import('./pedido-em-nome');
    const r = verificarPedidoEmNome({ autor: { id: 'sup', perfil: 'supervisor' }, vendedor_id: 'x', vendedor: { id: 'x', perfil: 'vendedor' }, visiveis: new Set(['sup']) });
    expect(r).toMatchObject({ codigo: 'FORA_DA_EQUIPE', http: 403, mensagem: 'Vendedor fora da sua equipe' });
  });
  it('RN-VEN-35: sem vendedor em "Em nome de" falta o "Vendedor" na aba Venda', async () => {
    const { pendenciasDePreenchimento } = await import('./pendencias-preenchimento');
    const p = pendenciasDePreenchimento({ itens: 1, quantidade_invalida: false, pagamento: { tipo: 'ok' }, frete: 'ok', erros_calculo: [], em_nome_sem_vendedor: true });
    expect(p).toEqual([{ id: 'vendedor', texto: 'Vendedor', aba: 'venda' }]);
  });
});
