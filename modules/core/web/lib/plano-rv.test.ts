import { describe, expect, it } from 'vitest';
import type { RvPainel } from '../../contracts';
import { centavosDoTexto, corpoDoFormulario, csvDeRv, formDoPlano, formNovo, simularRv, somaDosPesos, textoDasFaixas, textoDePbp, textoDosPesos } from './plano-rv';

const preenchido = () => ({ ...formNovo('2026-12'), nome: 'Plano 2026', valor_maximo: '2.000,00' });

describe('RN-CORE-30: formulário do plano de RV', () => {
  it('RN-CORE-30: plano novo vem com venda 70 e positivação 30 e converte reais em centavos', () => {
    const r = corpoDoFormulario(preenchido());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corpo.valor_maximo_cents).toBe(200_000);
    expect(r.corpo.regras.map((x) => [x.indicador, x.peso_pct])).toEqual([['venda_cents', 70], ['positivacao', 30]]);
    expect(r.corpo.perfis).toEqual(['vendedor']);
  });
  it('RN-CORE-30: pesos que não fecham 100 voltam o erro do domain em português e o texto da soma', () => {
    const f = preenchido();
    f.regras[0]!.peso = '60';
    expect(somaDosPesos(f)).toBe(90);
    expect(textoDosPesos(f)).toBe('Pesos somam 90%: ajuste até fechar 100%.');
    const r = corpoDoFormulario(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join(' ')).toMatch(/somar 100%/);
  });
  it('RN-CORE-30: gatilho não tem peso nem faixas e fica de fora da soma', () => {
    const f = preenchido();
    const cobertura = f.regras.find((r) => r.indicador === 'cobertura_pct')!;
    cobertura.ativo = true;
    cobertura.gatilho = true;
    expect(somaDosPesos(f)).toBe(100);
    const r = corpoDoFormulario(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.corpo.regras.find((x) => x.indicador === 'cobertura_pct')).toEqual({ indicador: 'cobertura_pct', peso_pct: 0, gatilho: true, faixas: [] });
  });
  it('RN-CORE-30: nome vazio, valor zerado e faixa que não começa em 0% são recusados com a ação seguinte', () => {
    const f = { ...preenchido(), nome: ' ', valor_maximo: '0' };
    const r = corpoDoFormulario(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toEqual(expect.arrayContaining(['Dê um nome ao plano.', 'Informe o valor da RV com 100% em tudo, em reais, maior que zero.']));
    const g = preenchido();
    g.regras[0]!.faixas[0]!.de = '10';
    const r2 = corpoDoFormulario(g);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.erros.join(' ')).toMatch(/começar em 0%/);
  });
  it('RN-CORE-30: plano gravado volta ao formulário (nova versão é uma cópia com outro mês)', () => {
    const r = corpoDoFormulario(preenchido());
    if (!r.ok) throw new Error('esperava ok');
    const volta = formDoPlano({ id: 'x', ...r.corpo });
    expect(volta.valor_maximo).toBe('2.000,00');
    expect(volta.regras.filter((x) => x.ativo).map((x) => x.indicador)).toEqual(['venda_cents', 'positivacao']);
    expect(corpoDoFormulario(volta)).toEqual(r);
  });
  it('RN-CORE-30: valor em reais aceita vírgula e ponto de milhar; texto inválido é nulo', () => {
    expect(centavosDoTexto('1.234,56')).toBe(123_456);
    expect(centavosDoTexto('2000')).toBe(200_000);
    expect(centavosDoTexto('abc')).toBeNull();
  });
  it('RN-CORE-29: descrição curta das faixas usa o texto do motor', () => {
    expect(textoDasFaixas(preenchido().regras[0]!.faixas)).toBe('< 80%: 0 · 80–99%: proporcional · ≥ 100%: cheio');
  });
});

describe('RN-CORE-29: simulador', () => {
  const plano = () => {
    const r = corpoDoFormulario(preenchido());
    if (!r.ok) throw new Error('esperava ok');
    return { id: 'p', ...r.corpo };
  };
  it('RN-CORE-29: 100% nos dois indicadores paga o valor máximo; 90% de venda paga proporcional', () => {
    expect(simularRv(plano(), { venda_cents: '100', positivacao: '100' }).rv_cents).toBe(200_000);
    // venda 90% proporcional: 200000 x 70% x 90% = 126000; positivação 100% = 60000
    expect(simularRv(plano(), { venda_cents: '90', positivacao: '100' }).rv_cents).toBe(186_000);
  });
  it('RN-CORE-29: indicador sem atingimento digitado paga 0', () => {
    expect(simularRv(plano(), { venda_cents: '100' }).rv_cents).toBe(140_000);
  });
  it('RN-CORE-29: gatilho abaixo de 100% zera a RV', () => {
    const f = preenchido();
    const cobertura = f.regras.find((r) => r.indicador === 'cobertura_pct')!;
    cobertura.ativo = true;
    cobertura.gatilho = true;
    const r = corpoDoFormulario(f);
    if (!r.ok) throw new Error('esperava ok');
    const p = { id: 'p', ...r.corpo };
    expect(simularRv(p, { venda_cents: '120', positivacao: '100', cobertura_pct: '90' })).toMatchObject({ rv_cents: 0, bloqueada: true });
    expect(simularRv(p, { venda_cents: '100', positivacao: '100', cobertura_pct: '100' })).toMatchObject({ rv_cents: 200_000, bloqueada: false });
  });
});

describe('RN-CORE-29: textos e CSV da RV', () => {
  const painel: RvPainel = {
    periodo: '2026-10',
    situacao: 'fechado',
    fechamento_em: '2026-11-03',
    plano_id: '0d000000-0000-4000-8000-000000000001',
    pessoas: [
      {
        usuario_id: '0b000000-0000-4000-8000-000000000001',
        nome: 'Ana "A." Silva',
        equipe_id: null,
        rv_cents: 120_000,
        rv_bruta_cents: 120_000,
        bloqueada_por: [],
        indicadores: [{ indicador: 'venda_cents', meta: 100_000, realizado: 90_000, atingimento_pbp: 9000, projetado_pbp: 9000, pagamento_pct: 90, valor_cents: 120_000, gatilho: false, gatilho_ok: null, sem_meta: false }],
      },
    ],
  };
  it('RN-CORE-29: pontos-base viram porcentagem', () => {
    expect(textoDePbp(8500)).toBe('85%');
    expect(textoDePbp(8525)).toBe('85,25%');
  });
  it('RN-CORE-29: CSV com BOM, ponto e vírgula, aspas escapadas e valores em reais com vírgula', () => {
    const csv = csvDeRv(painel);
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    const [cab, linha] = csv.slice(1).split('\r\n');
    expect(cab).toContain('"Vendedor";"Indicador"');
    expect(linha).toContain('"Ana ""A."" Silva"');
    expect(linha).toContain('"1200,00"');
    expect(linha).toContain('"90%"');
  });
});
