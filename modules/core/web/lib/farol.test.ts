import { describe, expect, it } from 'vitest';
import type { FarolCliente } from '../../contracts';
import { aoEscolherEquipe, consultaDoFarol, csvDoFarol, filtrosDaUrl, legendaDasFaixas, legendaEmLinhas, aoEscolherVendedor, protegerFormula, mesMaximo, rotuloDoExportar, rotuloDaCor, ROTULO_COR_PLURAL, textoDeDias, textoDePositivacao, textoDoResumo, textosDosParametros, tomDaCor, validarFormularioDoFarol } from './farol';

const PADRAO = { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 };
const url = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe('RN-CORE-28: apresentação do farol no BKO', () => {
  it('RN-CORE-28: rótulos no plural cobrem as 4 cores, inclusive "Clientes sem compra"', () => {
    expect(ROTULO_COR_PLURAL).toEqual({ verde: 'Clientes verdes', amarelo: 'Clientes amarelos', vermelho: 'Clientes vermelhos', sem_compra: 'Clientes sem compra' });
  });
  it('RN-CORE-28: dias sem compra em texto e "sem compra" quando não há compra', () => {
    expect([textoDeDias(null), textoDeDias(0), textoDeDias(1), textoDeDias(46)]).toEqual(['—', 'hoje', '1 dia', '46 dias']);
  });
  it('RN-CORE-28: positivação em pontos-base vira percentual pt-BR', () => {
    expect([textoDePositivacao(10000), textoDePositivacao(3333), textoDePositivacao(0), textoDePositivacao(7000)]).toEqual(['100%', '33,3%', '0%', '70%']);
  });
  it('RN-CORE-28: a cor tem sempre texto e tom; carteira vazia é "Sem carteira"', () => {
    expect([rotuloDaCor('vermelho'), rotuloDaCor('sem_compra'), rotuloDaCor(null)]).toEqual(['Vermelho', 'Sem compra', 'Sem carteira']);
    expect([tomDaCor('verde'), tomDaCor('amarelo'), tomDaCor('vermelho'), tomDaCor('sem_compra'), tomDaCor(null)]).toEqual(['success', 'warning', 'danger', 'neutral', 'neutral']);
  });
  it('RN-CORE-28: resumo em frase', () => {
    expect(textoDoResumo({ carteira: 3, positivados: 1, positivacao_pct: 3333, cor: 'vermelho', por_cor: { verde: 1, amarelo: 0, vermelho: 1, sem_compra: 1 } })).toBe('1 de 3 clientes positivados no mês (33,3%)');
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
  it('RN-CORE-28: a legenda cita os limites do tenant', () => {
    expect(legendaDasFaixas({ ...PADRAO, verde_ate_dias: 20 })).toContain('até 20 dias');
  });
  it('RN-CORE-28: a legenda em linhas separa cliente e vendedor com os limites do tenant', () => {
    const l = legendaEmLinhas(PADRAO);
    expect(l.map((x) => x.rotulo)).toEqual(['Cliente', 'Vendedor']);
    expect(l[0]?.faixas[2]).toEqual({ cor: 'vermelho', texto: 'acima de 45 dias' });
    expect(l[1]?.faixas[0]?.texto).toBe('a partir de 70%');
  });
  it('RN-CORE-28: vendedor escolhido limpa a equipe; mês máximo é o atual; exportar diz quantos', () => {
    expect(aoEscolherVendedor('v1')).toEqual({ vendedor: 'v1', equipe: null });
    expect(mesMaximo('2026-11-05')).toBe('2026-11');
    expect(rotuloDoExportar(1, false)).toBe('Exportar CSV (1 cliente)');
    expect(rotuloDoExportar(200, true)).toContain('há mais');
  });
});
