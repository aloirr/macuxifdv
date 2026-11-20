import { beforeEach, describe, expect, it } from 'vitest';
import { anoCivilNoFuso } from './ano-civil';
import { estimarMemoriaRanking, esquecerMemoriaRanking, LIMITE_MEMO_APLICACAO, pontuacaoTextual, type DocBusca } from './ranking';
import { expandirSinonimos } from './texto';

const doc = (o: Partial<DocBusca> & { id: string }): DocBusca => ({
  sku: o.id.toUpperCase(), ean: null, nome: 'Produto', marca: '', categoria: '', atributos: '', aplicacao: '', referencias: [], estoque: 10, vendas: 0, campanha: false, preco_cents: 1000, ...o,
});
const g = (q: string) => expandirSinonimos(q, []);
const nota = (q: string, d: DocBusca, anoAtual = 2026) => pontuacaoTextual(g(q), d, { anoAtual });

beforeEach(() => esquecerMemoriaRanking());

describe('RN-CAT-12: prefixo no campo aplicação (palavras com "d" e com dígitos)', () => {
  const d = doc({ id: 'a', nome: 'Pastilha', aplicacao: 'Fiat Uno dianteiro; Palio 1.0 traseiro' });
  it('RN-CAT-12: "dian" casa o prefixo de "dianteiro" (palavra com "d")', () => {
    const r = nota('dian', d);
    expect(r.casados).toBe(1);
    expect(r.pontos).toBeCloseTo(0.7 * 0.5, 5);
    expect(r.so_aplicacao).toBe(true);
  });
  it('RN-CAT-12: "tras" e "fia" casam por prefixo; "dei" e "del" não (nada começa assim)', () => {
    expect(nota('tras', d).casados).toBe(1);
    expect(nota('fia', d).casados).toBe(1);
    expect(nota('dei', d).casados).toBe(0);
    expect(nota('del', d).casados).toBe(0);
  });
  it('RN-CAT-12: palavra com dígito só casa exata (prefixo "10" de "100" e medida "5ml" não valem)', () => {
    const e = doc({ id: 'b', nome: 'Pastilha', aplicacao: 'Motor 100 flex 500ml' });
    expect(nota('motor 10', e).casados).toBe(1); // só "motor"
    expect(nota('50ml', e).casados).toBe(0);
    expect(nota('500ml', e).casados).toBe(1);
    expect(nota('100', e).casados).toBe(1);
  });
});

describe('RN-CAT-12: sem tolerância de digitação na aplicação', () => {
  it('RN-CAT-12: "dianteira" (1 letra de diferença) casa no nome, mas não na aplicação', () => {
    const naAplicacao = doc({ id: 'a', nome: 'Pastilha', aplicacao: 'Fiat Uno dianteiro' });
    const noNome = doc({ id: 'n', nome: 'Pastilha dianteiro' });
    expect(nota('dianteira', naAplicacao).pontos).toBe(0);
    expect(nota('dianteira', noNome).pontos).toBeGreaterThan(0);
  });
});

describe('RN-CAT-12: atalho quando os outros campos já cobrem a consulta', () => {
  it('RN-CAT-12: nome com nota >= peso da aplicação dá o mesmo resultado, sem guardar análise na memória', () => {
    const d = doc({ id: 'x', nome: 'Pastilha Uno', aplicacao: 'Fiat Uno 1.0 2010–2014; Palio 2012–2016' });
    const sem = doc({ id: 'x', nome: 'Pastilha Uno', aplicacao: '' });
    expect(nota('pastilha uno', d)).toEqual(nota('pastilha uno', sem));
    expect(estimarMemoriaRanking().entradas).toBe(0);
  });
  it('RN-CAT-12 + R-20261120-103142: ano da consulta que a aplicação não cobre é só "o grupo do ano não casa"', () => {
    const d = doc({ id: 'y', nome: 'Pastilha', aplicacao: 'Fiat Uno 2010–2014' });
    expect(nota('uno 2020', d)).toMatchObject({ casados: 1, total: 2 });
    expect(nota('uno 2012', d)).toMatchObject({ casados: 2, total: 2 });
    expect(nota('uno 2012', d).pontos).toBeGreaterThan(nota('uno 2020', d).pontos);
  });
});

describe('RF-CAT-02: memória do ranking (T-0084 §4.5)', () => {
  const trecho = (k: number) => `Fiat ${['Uno', 'Palio', 'Gol', 'Fox'][k % 4]} 1.${k % 9} ${1990 + (k % 30)}–${2000 + (k % 25)} dianteiro motor flex`;
  const longa = (k: number) => Array.from({ length: 45 }, (_, i) => trecho(k * 7 + i)).join('; ');
  const docs = Array.from({ length: 3000 }, (_, k) => doc({ id: `id-${k}`, nome: 'Pastilha', aplicacao: longa(k) }));

  it('RF-CAT-02: 3.000 produtos de ~2.000 caracteres: no máximo 800 entradas e estimativa abaixo de 20 MB', () => {
    expect(longa(1).length).toBeGreaterThan(1900);
    for (const d of docs) pontuacaoTextual(g('uno 2012'), d, { anoAtual: 2026 });
    const m = estimarMemoriaRanking();
    expect(m.entradas).toBeLessThanOrEqual(LIMITE_MEMO_APLICACAO);
    expect(m.bytes).toBeLessThan(20 * 1024 * 1024);
  });
  it('RF-CAT-02: a chave é curta (produto e ano), a entrada vale só para o mesmo texto e o menos usado sai primeiro (LRU)', () => {
    const a = docs[0]!;
    const r1 = pontuacaoTextual(g('uno 2012'), a, { anoAtual: 2026 });
    expect(pontuacaoTextual(g('uno 2012'), a, { anoAtual: 2026 })).toEqual(r1);
    // cadastro mudou (mesmo id, outro texto): não usa a análise velha
    const mudou = { ...a, aplicacao: 'Renault Clio 2005–2008' };
    expect(pontuacaoTextual(g('uno 2012'), mudou, { anoAtual: 2026 }).pontos).toBe(0);
    expect(pontuacaoTextual(g('clio 2006'), mudou, { anoAtual: 2026 }).pontos).toBeGreaterThan(0);
    // enche a memória mantendo o primeiro em uso: ele sobrevive
    esquecerMemoriaRanking();
    pontuacaoTextual(g('uno 2012'), a, { anoAtual: 2026 });
    for (let k = 1; k < 2000; k++) {
      pontuacaoTextual(g('uno 2012'), docs[k]!, { anoAtual: 2026 });
      if (k % 100 === 0) pontuacaoTextual(g('uno 2012'), a, { anoAtual: 2026 });
    }
    const antes = estimarMemoriaRanking().entradas;
    expect(antes).toBe(LIMITE_MEMO_APLICACAO);
    pontuacaoTextual(g('uno 2012'), a, { anoAtual: 2026 });
    expect(estimarMemoriaRanking().entradas).toBe(LIMITE_MEMO_APLICACAO); // acerto: não cresce
  });
});

describe('RN-CORE-11: ano civil no fuso do tenant', () => {
  it('RN-CORE-11: 01/01 02:00 UTC ainda é 31/12 em Manaus (UTC-4) e já é 2027 em UTC; fuso inválido cai em Manaus', () => {
    const instante = '2027-01-01T02:00:00.000Z';
    expect(anoCivilNoFuso(instante, 'America/Manaus')).toBe(2026);
    expect(anoCivilNoFuso(instante, 'UTC')).toBe(2027);
    expect(anoCivilNoFuso(new Date(instante), 'fuso/invalido')).toBe(2026);
    expect(anoCivilNoFuso(instante)).toBe(2026);
  });
});
