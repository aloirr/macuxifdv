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
