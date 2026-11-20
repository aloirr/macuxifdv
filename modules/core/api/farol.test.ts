import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { calcularFarol, rotasDeFarol } from './farol';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = '0b000000-0000-4000-8000-000000000009';
const V1 = '0b000000-0000-4000-8000-000000000001';
const V2 = '0b000000-0000-4000-8000-000000000002';
const C1 = '0c000000-0000-4000-8000-000000000001';
const C2 = '0c000000-0000-4000-8000-000000000002';
const C3 = '0c000000-0000-4000-8000-000000000003';

type Linha = { modulo: string; chave: string; valor: unknown };
function fakeDb(respostas: { parametros?: Linha[]; usuarios?: unknown[]; vinculos?: unknown[]; historico?: unknown[]; diario?: unknown[]; notas?: unknown[]; notasExistem?: boolean }) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      let rows: unknown[] = [];
      if (sql.includes('from plataforma.parametro')) rows = respostas.parametros ?? [];
      else if (sql.includes('from core.usuario')) rows = respostas.usuarios ?? [];
      else if (sql.includes('from core.carteira')) rows = respostas.vinculos ?? [];
      else if (sql.includes('from core.historico_compra')) rows = respostas.historico ?? [];
      else if (sql.includes('from core.indicador_diario')) rows = respostas.diario ?? [];
      else if (sql.includes('select distinct usuario_id, cliente_id from core.nota_erp')) rows = respostas.notas ?? [];
      else if (sql.includes('from core.nota_erp')) rows = respostas.notasExistem ? [{ '?column?': 1 }] : [];
      return { rows: rows as never[], rowCount: rows.length };
    },
  };
  return { db, chamadas };
}

const AGORA = new Date('2026-11-05T15:00:00Z');
const entrada = (extra: object = {}) => ({ usuariosVisiveis: 'tenant' as const, clientesVisiveis: 'tenant' as const, agora: AGORA, fuso: 'America/Manaus', integracaoNoTenant: false, query: {}, ...extra });
const usuarios = [
  { id: V1, nome: 'Ana', equipe_id: null },
  { id: V2, nome: 'Beto', equipe_id: null },
];
const vinc = (cliente_id: string, usuario_id: string, razao_social: string, external_id: string | null = null) => ({ cliente_id, usuario_id, razao_social, nome_fantasia: null, external_id, documento: '12345678000199' });
const compra = (cliente_id: string, ultima: string) => ({ cliente_id, ano_mes: ultima.slice(0, 7), valor_cents: 100, pedidos: 1, ultima_compra_em: ultima });

describe('RN-CORE-28: permissões do farol', () => {
  const permissoes = criarPermissoes([manifest]);
  const quem = (acao: string, modulos: Array<'core'> = ['core']) => PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, permissoes, acao).ok);
  it('RN-CORE-28: vendedor e promotor não têm a rota do farol; só analista e admin editam os parâmetros', () => {
    expect(quem('farol.ver')).toEqual(['supervisor', 'gerente', 'analista', 'assistente', 'admin']);
    expect(quem('parametro.farol')).toEqual(['analista', 'admin']);
  });
  it('RN-CORE-03: sem o módulo core licenciado nenhuma ação do farol vale', () => {
    expect(quem('farol.ver', [])).toEqual([]);
    expect(quem('parametro.farol', [])).toEqual([]);
  });
  it('RN-CORE-28: as três rotas usam as ações certas; o farol filtra no domínio (escopo de carteira)', () => {
    expect(rotasDeFarol.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.carteira}`)).toEqual([
      'GET farol farol.ver filtrar_no_dominio',
      'GET parametros/farol parametro.farol nao_se_aplica',
      'PUT parametros/farol parametro.farol nao_se_aplica',
    ]);
  });
});

describe('RN-CORE-28: GET /v1/core/farol (cálculo)', () => {
  it('RN-CORE-28: cor pelos dias sem compra, positivado no mês verde e cliente de dois vendedores uma vez no total', async () => {
    const { db } = fakeDb({
      usuarios,
      vinculos: [vinc(C1, V1, 'Alfa'), vinc(C1, V2, 'Alfa'), vinc(C2, V1, 'Beta'), vinc(C3, V2, 'Gama')],
      historico: [compra(C1, '2026-08-01'), compra(C2, '2026-09-20')], // C1: 96 dias; C2: 46 dias; C3 sem compra
      diario: [{ usuario_id: V1, ids: [C1] }],
    });
    const f = await calcularFarol(db, {}, entrada());
    expect(f.periodo).toBe('2026-11');
    expect(f.hoje).toBe('2026-11-05');
    expect(f.fonte_positivacao).toBe('pedido');
    expect(f.resumo).toMatchObject({ carteira: 3, positivados: 1, por_cor: { verde: 1, amarelo: 0, vermelho: 1, sem_compra: 1 } });
    // C1 aparece nas duas linhas (V1 positivou; V2 não): a do V2 é vermelha, mas no total o cliente conta positivado uma vez
    expect(f.vendedores.map((v) => [v.nome, v.carteira, v.positivados])).toEqual([['Ana', 2, 1], ['Beto', 2, 0]]);
    expect(f.clientes.map((c) => [c.nome, c.cor])).toEqual([['Alfa', 'vermelho'], ['Beta', 'vermelho'], ['Gama', 'sem_compra'], ['Alfa', 'verde']]);
    expect(f.clientes.every((c) => c.documento_mascarado === '12.345.678/****-**')).toBe(true);
  });
  it('RN-CORE-28: sem linha de parâmetro vale 30/45; com parâmetro do tenant mudam as faixas', async () => {
    const base = { usuarios, vinculos: [vinc(C2, V1, 'Beta')], historico: [compra(C2, '2026-09-20')] };
    expect((await calcularFarol(fakeDb(base).db, {}, entrada())).clientes[0]?.cor).toBe('vermelho');
    const largo = fakeDb({ ...base, parametros: [{ modulo: 'core', chave: 'farol.amarelo_ate_dias', valor: 60 }] });
    const f = await calcularFarol(largo.db, {}, entrada());
    expect(f.parametros).toMatchObject({ verde_ate_dias: 30, amarelo_ate_dias: 60 });
    expect(f.clientes[0]?.cor).toBe('amarelo');
  });
  it('RN-CORE-27: com Integração e notas do ERP atribuídas a fonte é a nota, nunca somada ao read-model', async () => {
    const { db, chamadas } = fakeDb({
      usuarios,
      vinculos: [vinc(C1, V1, 'Alfa'), vinc(C2, V1, 'Beta')],
      notasExistem: true,
      notas: [{ usuario_id: V1, cliente_id: C2 }],
      diario: [{ usuario_id: V1, ids: [C1] }],
    });
    const f = await calcularFarol(db, {}, entrada({ integracaoNoTenant: true }));
    expect(f.fonte_positivacao).toBe('nota_erp');
    expect(f.clientes.find((c) => c.cliente_id === C2)?.positivado_mes).toBe(true);
    expect(f.clientes.find((c) => c.cliente_id === C1)?.positivado_mes).toBe(false);
    expect(chamadas.some((c) => c.sql.includes('from core.indicador_diario'))).toBe(false);
  });
  it('RN-CORE-27: Vendedor licenciado no tenant = fonte do pedido (read-model) para qualquer perfil, mesmo com Integração e notas atribuídas', async () => {
    const { db, chamadas } = fakeDb({
      usuarios,
      vinculos: [vinc(C1, V1, 'Alfa'), vinc(C2, V1, 'Beta')],
      notasExistem: true,
      notas: [{ usuario_id: V1, cliente_id: C2 }],
      diario: [{ usuario_id: V1, ids: [C1] }],
    });
    const f = await calcularFarol(db, {}, entrada({ integracaoNoTenant: true, vendedorNoTenant: true }));
    expect(f.fonte_positivacao).toBe('pedido');
    expect(f.clientes.find((c) => c.cliente_id === C1)?.positivado_mes).toBe(true);
    expect(f.clientes.find((c) => c.cliente_id === C2)?.positivado_mes).toBe(false);
    expect(chamadas.some((c) => c.sql.includes('from core.nota_erp'))).toBe(false);
  });
  it('RN-CORE-27/28: a fonte não depende dos módulos de quem consulta (com ou sem consulta ao Vendedor o resultado é o mesmo)', async () => {
    const dados = { usuarios, vinculos: [vinc(C1, V1, 'Alfa')], notasExistem: true, notas: [{ usuario_id: V1, cliente_id: C1 }], diario: [] };
    const semConsulta = await calcularFarol(fakeDb(dados).db, {}, entrada({ integracaoNoTenant: true, vendedorNoTenant: true }));
    const comConsulta = await calcularFarol(fakeDb(dados).db, { consultar: (async () => ({ pedidos: [], faturamentos: [] })) as never }, entrada({ integracaoNoTenant: true, vendedorNoTenant: true }));
    expect(comConsulta).toEqual(semConsulta);
  });
  it('RN-CORE-28: sem lista de positivação no mês a fonte é nula e ninguém aparece positivado', async () => {
    const f = await calcularFarol(fakeDb({ usuarios, vinculos: [vinc(C1, V1, 'Alfa')] }).db, {}, entrada());
    expect(f.fonte_positivacao).toBeNull();
    expect(f.resumo.positivados).toBe(0);
  });
  it('RN-CORE-04: escopo e filtros viram parâmetros da consulta; escopo sem vendedor devolve vazio sem ler a carteira', async () => {
    const { db, chamadas } = fakeDb({ usuarios: [] });
    const f = await calcularFarol(db, {}, entrada({ usuariosVisiveis: new Set([V1]), query: { equipe_id: '0e000000-0000-4000-8000-000000000001' } }));
    expect(f.clientes).toEqual([]);
    expect(f.resumo.carteira).toBe(0);
    expect(chamadas.find((c) => c.sql.includes('from core.usuario'))!.valores[0]).toEqual([V1]);
    expect(chamadas.some((c) => c.sql.includes('from core.carteira'))).toBe(false);
  });
  it('RN-CORE-04: o escopo de clientes (supervisor) vai à consulta da carteira', async () => {
    const { db, chamadas } = fakeDb({ usuarios, vinculos: [vinc(C1, V1, 'Alfa')] });
    await calcularFarol(db, {}, entrada({ clientesVisiveis: new Set([C1]) }));
    expect(chamadas.find((c) => c.sql.includes('from core.carteira'))!.valores[2]).toEqual([C1]);
  });
  it('RN-CORE-28: filtros de cor e busca valem só para a lista; resumo e vendedores seguem o recorte inteiro; paginação por cursor', async () => {
    const base = { usuarios, vinculos: [vinc(C1, V1, 'Alfa', 'C-001'), vinc(C2, V1, 'Beta', 'C-002'), vinc(C3, V1, 'Gama', 'C-003')], historico: [compra(C1, '2026-08-01'), compra(C2, '2026-09-20')] };
    const porCor = await calcularFarol(fakeDb(base).db, {}, entrada({ query: { cor: 'sem_compra' } }));
    expect(porCor.clientes.map((c) => c.nome)).toEqual(['Gama']);
    expect(porCor.resumo.carteira).toBe(3);
    expect((await calcularFarol(fakeDb(base).db, {}, entrada({ query: { busca: 'bet' } }))).clientes.map((c) => c.nome)).toEqual(['Beta']);
    expect((await calcularFarol(fakeDb(base).db, {}, entrada({ query: { busca: '12.345' } }))).clientes).toHaveLength(3);
    expect((await calcularFarol(fakeDb(base).db, {}, entrada({ query: { busca: 'c-002' } }))).clientes.map((c) => c.nome)).toEqual(['Beta']);
    const p1 = await calcularFarol(fakeDb(base).db, {}, entrada({ query: { limite: 2 } }));
    expect(p1.clientes).toHaveLength(2);
    expect(p1.proximo_cursor).toBe('2');
    const p2 = await calcularFarol(fakeDb(base).db, {}, entrada({ query: { limite: 2, cursor: '2' } }));
    expect(p2.clientes).toHaveLength(1);
    expect(p2.proximo_cursor).toBeNull();
  });
  it('RN-CORE-28: período futuro (depois do mês corrente no fuso do tenant) é recusado com 422 e a ação seguinte', async () => {
    const { db } = fakeDb({ usuarios, vinculos: [vinc(C1, V1, 'Alfa')] });
    await expect(calcularFarol(db, {}, entrada({ query: { periodo: '2026-12' } }))).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-28', message: expect.stringMatching(/Escolha/) });
    // virada do mês no fuso: 01/12 02:00Z ainda é 30/11 em Manaus (dezembro segue futuro); 01/12 05:00Z já é dezembro
    await expect(calcularFarol(db, {}, entrada({ agora: new Date('2026-12-01T02:00:00Z'), query: { periodo: '2026-12' } }))).rejects.toMatchObject({ codigo: 'RN-CORE-28' });
    await expect(calcularFarol(db, {}, entrada({ agora: new Date('2026-12-01T05:00:00Z'), query: { periodo: '2026-12' } }))).resolves.toMatchObject({ periodo: '2026-12' });
    // o mês atual e os passados valem
    await expect(calcularFarol(db, {}, entrada({ query: { periodo: '2026-11' } }))).resolves.toMatchObject({ periodo: '2026-11' });
    await expect(calcularFarol(db, {}, entrada({ query: { periodo: '2025-01' } }))).resolves.toMatchObject({ periodo: '2025-01' });
  });
  it('RN-CORE-28: vendedor desligado (ativo = false) com vínculo vivo continua no farol: a carteira só sai pela reatribuição', async () => {
    const { db, chamadas } = fakeDb({ usuarios: [{ id: V1, nome: 'Ana (desligada)', equipe_id: null }], vinculos: [vinc(C1, V1, 'Alfa')] });
    const f = await calcularFarol(db, {}, entrada());
    expect(f.vendedores.map((v) => [v.nome, v.carteira])).toEqual([['Ana (desligada)', 1]]);
    expect(f.clientes.map((c) => c.nome)).toEqual(['Alfa']);
    expect(chamadas.find((c) => c.sql.includes('from core.usuario'))!.sql).not.toMatch(/\bativo\b/);
  });
  it('RN-CORE-28: a leitura do read-model usa faixa de datas (índice por data), não to_char', async () => {
    const { db, chamadas } = fakeDb({ usuarios, vinculos: [vinc(C1, V1, 'Alfa')] });
    await calcularFarol(db, {}, entrada({ query: { periodo: '2026-10' } }));
    const consulta = chamadas.find((c) => c.sql.includes('from core.indicador_diario'))!;
    expect(consulta.sql).not.toContain('to_char');
    expect(consulta.valores[1]).toBe('2026-10-01');
  });
  it('RN-CORE-28: recorte acima do teto de vínculos é recusado com a ação seguinte', async () => {
    const muitos = Array.from({ length: 5001 }, (_, i) => vinc(`0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`, V1, 'X'));
    await expect(calcularFarol(fakeDb({ usuarios, vinculos: muitos }).db, {}, entrada())).rejects.toThrow(/Escolha uma equipe ou um vendedor/);
  });
});

const rota = (metodo: 'GET' | 'PUT') => rotasDeFarol.find((r) => r.caminho === 'parametros/farol' && r.metodo === metodo)!;
const chamarParametros = (metodo: 'GET' | 'PUT', db: ClienteBanco, corpo?: unknown) => {
  const r = rota(metodo);
  const ctx = {
    usuario: { id: ADMIN, tenant_id: TENANT, perfil: 'admin' },
    requestId: 'req-1',
    comTenant: async (fn: (d: ClienteBanco) => Promise<unknown>) => fn(db),
    corpo: r.corpo ? r.corpo.parse(corpo) : {},
    query: {},
    params: {},
  } as unknown as ContextoBase;
  return r.executar(ctx as never) as Promise<unknown>;
};
const padrao = { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 };
const ehAuditoria = (c: { sql: string }) => c.sql.includes('plataforma.auditoria');
const ehEscrita = (c: { sql: string }) => c.sql.includes('plataforma.parametro (tenant_id');

describe('RN-CORE-28 / RN-AUD-01: parametros/farol', () => {
  it('RN-CORE-28: GET sem linha devolve o padrão 30/45 e 70/50', async () => {
    expect(await chamarParametros('GET', fakeDb({}).db)).toEqual(padrao);
  });
  it('RN-AUD-01: PUT grava as quatro chaves e audita antes/depois', async () => {
    const { db, chamadas } = fakeDb({});
    const novo = { ...padrao, verde_ate_dias: 20, amarelo_ate_dias: 40 };
    expect(await chamarParametros('PUT', db, novo)).toEqual(novo);
    expect(chamadas.filter(ehEscrita)).toHaveLength(4);
    const aud = chamadas.filter(ehAuditoria);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('parametro.farol');
    expect(JSON.parse(aud[0]!.valores[4] as string)).toEqual(padrao);
    expect(JSON.parse(aud[0]!.valores[5] as string)).toEqual(novo);
  });
  it('RN-AUD-01: repetir o mesmo valor não audita de novo', async () => {
    const { db, chamadas } = fakeDb({ parametros: Object.entries(padrao).map(([k, valor]) => ({ modulo: 'core', chave: `farol.${k}`, valor })) });
    await chamarParametros('PUT', db, padrao);
    expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-28: PUT incoerente é recusado (422) por campo e não grava nada', async () => {
    const { db, chamadas } = fakeDb({});
    await expect(chamarParametros('PUT', db, { ...padrao, verde_ate_dias: 50 })).rejects.toMatchObject({ codigo: 'RN-CORE-28' });
    expect(chamadas.filter(ehEscrita)).toHaveLength(0);
  });
  it('RN-CORE-28: PUT com campo estranho é recusado pelo contrato estrito', () => {
    expect(() => rota('PUT').corpo!.parse({ ...padrao, extra: 1 })).toThrow();
  });
});
