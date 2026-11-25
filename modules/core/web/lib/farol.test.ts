import { describe, expect, it } from 'vitest';
import { protegerFormula } from '@macuxi/comum/csv';
import type { FarolCliente } from '../../contracts';
import { aoEscolherEquipe, avisoDoMesPassado, consultaDoFarol, csvDoFarol, filtrosDaUrl, dicaDaPositivacao, estadoDaPositivacao, legendaDoCliente, corAoClicarNoContador, tomDoContador, aoEscolherVendedor, mesMaximo, rotuloDoExportar, rotuloDaCor, ORDEM_DOS_CONTADORES, ROTULO_PLURAL_DA_COR, textoDeDias, textoDePositivacao, textosDosParametros, tomDaCor, validarFormularioDoFarol } from './farol';

const PADRAO = { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 };
const url = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe('RN-CORE-28: apresentação do farol no BKO', () => {
  it('RN-CORE-28: contadores da carteira na ordem Vermelhos, Amarelos, Sem compra, Verdes', () => {
    expect(ORDEM_DOS_CONTADORES.map((c) => ROTULO_PLURAL_DA_COR[c])).toEqual(['Vermelhos', 'Amarelos', 'Sem compra', 'Verdes']);
  });
  it('RN-CORE-28: dias sem compra em texto e "sem compra" quando não há compra', () => {
    expect([textoDeDias(null), textoDeDias(0), textoDeDias(1), textoDeDias(46)]).toEqual(['—', 'hoje', '1 dia', '46 dias']);
  });
  it('RN-CORE-28: positivação em pontos-base vira percentual pt-BR', () => {
    expect([textoDePositivacao(10000), textoDePositivacao(3333), textoDePositivacao(0), textoDePositivacao(7000)]).toEqual(['100%', '33,3%', '0%', '70%']);
  });
  it('RN-CORE-28: positivação 489/699 (69,95%) mostra 69,9%, nunca 70% com a cor abaixo de 70%', () => {
    expect([textoDePositivacao(6995), textoDePositivacao(6999), textoDePositivacao(4999)]).toEqual(['69,9%', '69,9%', '49,9%']);
  });
  it('RN-CORE-28: a cor tem sempre texto e tom (Verde neutro: só amarelo e vermelho pedem ação); carteira vazia é "Sem carteira"', () => {
    expect([rotuloDaCor('vermelho'), rotuloDaCor('sem_compra'), rotuloDaCor(null)]).toEqual(['Vermelho', 'Sem compra', 'Sem carteira']);
    expect([tomDaCor('verde'), tomDaCor('amarelo'), tomDaCor('vermelho'), tomDaCor('sem_compra'), tomDaCor(null)]).toEqual(['neutral', 'warning', 'danger', 'neutral', 'neutral']);
  });
  it('RN-CORE-28: filtros vêm da URL; cor inválida e busca longa são descartadas; só o preenchido vai à API', () => {
    const f = filtrosDaUrl(url({ mes: '2026-10', equipe: 'e1', cor: 'roxo', q: 'x'.repeat(100) }));
    expect(f.cor).toBe('');
    expect(f.busca).toHaveLength(60);
    expect(consultaDoFarol({ mes: '2026-10', equipe: 'e1', vendedor: '', cor: 'vermelho', busca: ' loja ' })).toEqual({ periodo: '2026-10', equipe_id: 'e1', cor: 'vermelho', busca: 'loja' });
    expect(consultaDoFarol({ mes: 'lixo', equipe: '', vendedor: 'v1', cor: '', busca: '' }, '200')).toEqual({ usuario_id: 'v1', cursor: '200' });
  });
  it('RN-CORE-28: trocar a equipe limpa o vendedor escolhido', () => {
    expect(aoEscolherEquipe('e2')).toEqual({ equipe: 'e2', vendedor: null });
    expect(aoEscolherEquipe('')).toEqual({ equipe: null, vendedor: null });
  });
  it('RN-CORE-28: CSV com BOM, ponto e vírgula e aspas duplicadas', () => {
    const c: FarolCliente = { cliente_id: 'c1', nome: 'Loja "Boa"', documento_mascarado: '12.345.678/****-**', usuario_id: 'v1', ultima_compra_em: '2026-10-02', dias_sem_compra: 34, positivado_mes: false, cor: 'amarelo' };
    const csv = csvDoFarol([c, { ...c, ultima_compra_em: null, dias_sem_compra: null, cor: 'sem_compra' }], () => 'Ana');
    const linhas = csv.slice(1).trimEnd().split('\r\n');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(linhas[1]).toBe('"Loja ""Boa""";"12.345.678/****-**";"Ana";"02/10/2026";"34";"Não";"Amarelo"');
    expect(linhas[2]).toBe('"Loja ""Boa""";"12.345.678/****-**";"Ana";"—";"sem compra";"Não";"Sem compra"');
  });
  it('T-0081: CSV protege contra fórmula no nome vindo do ERP', () => {
    const c: FarolCliente = { cliente_id: 'c1', nome: '=HYPERLINK("http://x")', documento_mascarado: null, usuario_id: 'v1', ultima_compra_em: null, dias_sem_compra: null, positivado_mes: false, cor: 'sem_compra' };
    const linhas = csvDoFarol([c, { ...c, nome: '@cmd' }, { ...c, nome: '-2+3' }], () => 'Ana').slice(1).trimEnd().split('\r\n');
    expect(linhas[1]!.startsWith('"\'=HYPERLINK(""http://x"")";')).toBe(true);
    expect(linhas[2]!.startsWith('"\'@cmd";')).toBe(true);
    expect(linhas[3]!.startsWith('"\'-2+3";')).toBe(true);
    expect(protegerFormula('Loja Boa')).toBe('Loja Boa');
  });
  it('RN-CORE-28: formulário válido volta aos números; verde ≥ amarelo e texto vazio ficam no campo certo', () => {
    expect(validarFormularioDoFarol(textosDosParametros(PADRAO))).toEqual({ ok: true, valores: PADRAO });
    const r = validarFormularioDoFarol({ ...textosDosParametros(PADRAO), verde_ate_dias: '50', positivacao_verde_pct: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['amarelo_ate_dias', 'positivacao_verde_pct']);
  });
  it('RN-CORE-28: a legenda é uma linha só, com a regra do cliente e os limites do tenant', () => {
    expect(legendaDoCliente(PADRAO)).toBe('Farol do cliente: verde até 30 dias sem compra ou positivado no mês · amarelo até 45 dias · vermelho acima de 45 dias.');
    expect(legendaDoCliente({ ...PADRAO, verde_ate_dias: 20 })).toContain('verde até 20 dias');
  });
  it('RN-CORE-28: clicar no contador ativo limpa o filtro; em outro, escolhe a cor', () => {
    expect(corAoClicarNoContador('', 'vermelho')).toBe('vermelho');
    expect(corAoClicarNoContador('vermelho', 'vermelho')).toBe('');
    expect(corAoClicarNoContador('vermelho', 'amarelo')).toBe('amarelo');
  });
  it('RN-CORE-28: a dica da positivação traz a regra do vendedor', () => {
    expect(dicaDaPositivacao(PADRAO)).toBe('Vendedor: verde a partir de 70%, amarelo a partir de 50%, vermelho abaixo de 50%.');
  });
  it('RN-CORE-28: positivação do mês só ganha cor abaixo do limite, sempre com texto; sem dados mostra o estado vazio', () => {
    const r = { carteira: 30, positivados: 0, positivacao_pct: 0, cor: 'vermelho' as const, por_cor: { verde: 30, amarelo: 0, vermelho: 0, sem_compra: 0 } };
    expect(estadoDaPositivacao(r, 'pedido', PADRAO)).toEqual({ valor: '0%', detalhe: '0 de 30 clientes', tom: 'danger', alerta: 'abaixo de 50%' });
    expect(estadoDaPositivacao({ ...r, positivados: 18, positivacao_pct: 6000, cor: 'amarelo' }, 'nota_erp', PADRAO)).toEqual({ valor: '60%', detalhe: '18 de 30 clientes', tom: 'warning', alerta: 'abaixo de 70%' });
    expect(estadoDaPositivacao({ ...r, positivados: 24, positivacao_pct: 8000, cor: 'verde' }, 'pedido', PADRAO)).toEqual({ valor: '80%', detalhe: '24 de 30 clientes', tom: 'neutral', alerta: null });
    expect(estadoDaPositivacao(r, null, PADRAO)).toEqual({ valor: '—', detalhe: 'Sem pedidos nem notas', tom: 'neutral', alerta: null });
  });
  it('RN-CORE-28: só Vermelhos e Amarelos acima de zero ganham cor nos contadores da carteira', () => {
    expect([tomDoContador('vermelho', 3), tomDoContador('vermelho', 0), tomDoContador('amarelo', 2), tomDoContador('amarelo', 0), tomDoContador('verde', 9), tomDoContador('sem_compra', 4)]).toEqual(['danger', 'neutral', 'warning', 'neutral', 'neutral', 'neutral']);
  });
  it('RN-CORE-28: mês passado avisa que carteira e dias sem compra são de hoje; mês atual não avisa', () => {
    expect(avisoDoMesPassado('2026-10', '2026-11-05')).toMatch(/carteira e os dias sem compra são os de hoje/);
    expect(avisoDoMesPassado('2026-11', '2026-11-05')).toBeNull();
  });
  it('RN-CORE-28: vendedor escolhido limpa a equipe; mês máximo é o atual; exportar diz quantos', () => {
    expect(aoEscolherVendedor('v1')).toEqual({ vendedor: 'v1', equipe: null });
    expect(mesMaximo('2026-11-05')).toBe('2026-11');
    expect(rotuloDoExportar(1, false)).toBe('Exportar CSV (1 cliente)');
    expect(rotuloDoExportar(200, true)).toContain('há mais');
  });
});
