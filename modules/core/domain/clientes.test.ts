import { describe, expect, it } from 'vitest';
import { documentoCasa, escopoDeUsuarios, listarClientes, papelCompativel, type ClienteLista } from './clientes';

const cli = (id: string, razao_social: string, extra: Partial<ClienteLista> = {}): ClienteLista => ({
  id,
  razao_social,
  nome_fantasia: null,
  documento: null,
  cidade: null,
  segmento: null,
  external_id: null,
  ...extra,
});
const todos = [
  cli('c1', 'Mercado São João', { nome_fantasia: 'Mercadinho do João', documento: '12.345.678/0001-90', external_id: 'C-0042', cidade: 'Manaus', segmento: 'varejo' }),
  cli('c2', 'Atacado Norte', { cidade: 'Parintins', segmento: 'atacado' }),
  cli('c3', 'Padaria Aurora', { cidade: 'Manaus', segmento: 'varejo' }),
];

describe('lista de clientes no escopo da carteira (RN-CORE-04)', () => {
  const c = { propria: new Set(['c1']), equipe: new Set(['c2']), equipesAbaixo: new Set(['c3']) };

  it('RN-CORE-04: vendedor só enxerga a própria carteira (sem vazar c2 nem c3)', () => {
    expect(listarClientes(todos, 'vendedor', c).map((x) => x.id)).toEqual(['c1']);
  });
  it('RN-CORE-04: supervisor enxerga a equipe; gerente, as equipes abaixo', () => {
    expect(listarClientes(todos, 'supervisor', c).map((x) => x.id).sort()).toEqual(['c1', 'c2']);
    expect(listarClientes(todos, 'gerente', c).map((x) => x.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });
  it('RN-CORE-04: analista, assistente e admin enxergam o tenant inteiro', () => {
    expect(listarClientes(todos, 'analista', c)).toHaveLength(3);
  });
  it('RN-CORE-04: carteira vazia não vê nada', () => {
    expect(listarClientes(todos, 'promotor', { propria: new Set(), equipe: new Set(), equipesAbaixo: new Set() })).toEqual([]);
  });
});

describe('busca e filtros da lista de clientes (RF-CORE-02)', () => {
  const c = { propria: new Set(['c1', 'c2', 'c3']), equipe: new Set<string>(), equipesAbaixo: new Set<string>() };

  it('busca por nome ignorando acento e caixa', () => {
    expect(listarClientes(todos, 'vendedor', c, { q: 'sao joao' }).map((x) => x.id)).toEqual(['c1']);
  });
  it('busca por nome fantasia', () => {
    expect(listarClientes(todos, 'vendedor', c, { q: 'mercadinho' }).map((x) => x.id)).toEqual(['c1']);
  });
  it('RF-CORE-02: busca por código do cliente (external_id), com ou sem caixa; sem código não quebra', () => {
    expect(listarClientes(todos, 'vendedor', c, { q: 'c-0042' }).map((x) => x.id)).toEqual(['c1']);
    expect(listarClientes(todos, 'vendedor', c, { q: '0042' }).map((x) => x.id)).toEqual(['c1']);
    expect(listarClientes(todos, 'vendedor', c, { q: 'C-0099' })).toEqual([]);
  });
  it('RF-CORE-02: a cidade não casa na busca (só código, CNPJ, razão social e nome fantasia); o filtro de cidade segue', () => {
    expect(listarClientes(todos, 'vendedor', c, { q: 'parintins' })).toEqual([]);
    expect(listarClientes(todos, 'vendedor', c, { cidade: 'Parintins' }).map((x) => x.id)).toEqual(['c2']);
  });
  it('RF-CORE-02: documentoCasa — dígitos do termo (3 ou mais) contidos nos do documento, com ou sem máscara', () => {
    expect(documentoCasa('12.345.678', '12345678000190')).toBe(true);
    expect(documentoCasa('12345678000190', '12.345.678/0001-90')).toBe(true);
    expect(documentoCasa('12', '12345678000190')).toBe(false);
    expect(documentoCasa('abc', '12345678000190')).toBe(false);
    expect(documentoCasa('123', null)).toBe(false);
  });
  it('RF-CORE-02: o CNPJ casa com e sem máscara, inteiro ou em parte', () => {
    for (const q of ['12.345.678/0001-90', '12345678000190', '12.345.678', '345678/0001', '0001-90']) {
      expect(listarClientes(todos, 'vendedor', c, { q }).map((x) => x.id)).toEqual(['c1']);
    }
    const semMascara = [cli('s1', 'Loja Sem Máscara', { documento: '98765432000110' })];
    const so = { propria: new Set(['s1']), equipe: new Set<string>(), equipesAbaixo: new Set<string>() };
    expect(listarClientes(semMascara, 'vendedor', so, { q: '98.765.432/0001-10' }).map((x) => x.id)).toEqual(['s1']);
    expect(listarClientes(semMascara, 'vendedor', so, { q: '98765432' }).map((x) => x.id)).toEqual(['s1']);
  });
  it('filtra por cidade e segmento', () => {
    expect(listarClientes(todos, 'vendedor', c, { cidade: 'Manaus', segmento: 'varejo' }).map((x) => x.id)).toEqual(['c1', 'c3']);
  });
  it('filtros "bloqueados" e "vencidos" usam os conjuntos calculados do financeiro', () => {
    const extra = { bloqueados: new Set(['c2']), comVencidos: new Set(['c3']) };
    expect(listarClientes(todos, 'vendedor', c, { bloqueado: true }, extra).map((x) => x.id)).toEqual(['c2']);
    expect(listarClientes(todos, 'vendedor', c, { comVencidos: true }, extra).map((x) => x.id)).toEqual(['c3']);
  });
  it('o filtro nunca amplia o escopo: busca por cliente de fora não acha', () => {
    const so1 = { propria: new Set(['c1']), equipe: new Set<string>(), equipesAbaixo: new Set<string>() };
    expect(listarClientes(todos, 'vendedor', so1, { q: 'atacado' })).toEqual([]);
  });
  it('ordena por nome (fantasia, se houver, senão razão social) em português', () => {
    expect(listarClientes(todos, 'vendedor', c).map((x) => x.id)).toEqual(['c2', 'c1', 'c3']);
  });
});

describe('escopo de usuários — de quem são as visitas, rotas e metas (RN-CORE-04)', () => {
  const c = { proprio: 'u1', equipe: new Set(['u2', 'u3']), equipesAbaixo: new Set(['u4']) };
  it('RN-CORE-04: vendedor e promotor veem só a si mesmos', () => {
    expect([...(escopoDeUsuarios('vendedor', c) as Set<string>)]).toEqual(['u1']);
  });
  it('RN-CORE-04: supervisor vê a si e a equipe; gerente soma as equipes abaixo', () => {
    expect([...(escopoDeUsuarios('supervisor', c) as Set<string>)].sort()).toEqual(['u1', 'u2', 'u3']);
    expect([...(escopoDeUsuarios('gerente', c) as Set<string>)].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });
  it('RN-CORE-04: analista, assistente e admin veem o tenant', () => {
    expect(escopoDeUsuarios('admin', c)).toBe('tenant');
  });
});

describe('papel do vínculo da carteira (RN-CORE-04, RN-PRO-01)', () => {
  it('RN-CORE-04: vendedor só recebe carteira no papel vendedor; promotor, no papel promotor', () => {
    expect(papelCompativel('vendedor', 'vendedor')).toBe(true);
    expect(papelCompativel('promotor', 'promotor')).toBe(true);
  });
  it('RN-PRO-01: promotor não pode ter vínculo no papel vendedor, nem o contrário; supervisor não carrega carteira', () => {
    expect(papelCompativel('promotor', 'vendedor')).toBe(false);
    expect(papelCompativel('vendedor', 'promotor')).toBe(false);
    expect(papelCompativel('supervisor', 'vendedor')).toBe(false);
  });
});
