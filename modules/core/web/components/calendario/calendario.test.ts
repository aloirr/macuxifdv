/**
 * Parâmetros › Calendário (T-0170; desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2 e §6.5), com a API simulada:
 * os feriados nacionais do ano em leitura (D4: contam sempre), os do tenant com incluir e remover, cada erro no seu campo.
 * O almoço (RN-CORE-44, D5) tem teste próprio em `almoco-padrao.test.ts`.
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { criarApiSimulada, novoQueryClient, renderizar, trecho } from '../tarefas/api-simulada';
import { CHAVE_CALENDARIO, criarApiCalendario, type ParametrosCalendario } from './api';
import { CalendarioPage } from './calendario-page';
import { feriadosDoAno, incluirFeriado } from './calendario';

const HOJE = '2026-11-13';
const PARAMETROS: ParametrosCalendario = { feriados: [{ data: '2026-09-05', nome: 'Elevação do Amazonas' }] };

describe('feriados do ano', () => {
  it('2026: os nacionais (Finados e Consciência Negra inclusive) e o do tenant, em ordem de data', () => {
    const linhas = feriadosDoAno(2026, PARAMETROS.feriados);
    expect(linhas.find((l) => l.data === '2026-11-02')).toMatchObject({ nacional: true });
    expect(linhas.find((l) => l.data === '2026-11-20')).toMatchObject({ nacional: true });
    expect(linhas.find((l) => l.data === '2026-09-05')).toEqual({ data: '2026-09-05', nome: 'Elevação do Amazonas', nacional: false });
    expect(linhas.map((l) => l.data)).toEqual([...linhas.map((l) => l.data)].sort());
    expect(feriadosDoAno(2027, PARAMETROS.feriados).some((l) => !l.nacional)).toBe(false);
  });

  it('incluir: data inválida, nacional ou repetida e nome vazio ficam no campo; o nome vai sem espaços', () => {
    const lista = PARAMETROS.feriados;
    expect(incluirFeriado(lista, { data: '', nome: 'X' })).toEqual({ ok: false, campo: 'data', erro: 'Escolha a data.' });
    expect(incluirFeriado(lista, { data: '2026-11-02', nome: 'Finados' })).toEqual({ ok: false, campo: 'data', erro: 'Esta data já é feriado nacional.' });
    expect(incluirFeriado(lista, { data: '2026-09-05', nome: 'De novo' })).toEqual({ ok: false, campo: 'data', erro: 'Esta data já está na lista.' });
    expect(incluirFeriado(lista, { data: '2026-12-08', nome: '  ' })).toEqual({ ok: false, campo: 'nome', erro: 'Escreva o nome.' });
    expect(incluirFeriado(lista, { data: '2026-12-08', nome: ' Nossa Senhora da Conceição ' })).toEqual({
      ok: true,
      lista: [lista[0], { data: '2026-12-08', nome: 'Nossa Senhora da Conceição' }],
    });
  });

  it('no máximo 60 feriados do tenant por ano', () => {
    const cheia = Array.from({ length: 60 }, (_, i) => ({ data: `2027-${String(Math.floor(i / 28) + 3).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, nome: `F${i}` }));
    expect(incluirFeriado(cheia, { data: '2027-08-10', nome: 'Mais um' })).toEqual({ ok: false, campo: 'data', erro: 'O ano já tem 60 feriados.' });
  });
});

describe('página com a API simulada', () => {
  async function tela(acoes: string[]) {
    const sim = criarApiSimulada({ 'GET /core/parametros/calendario': PARAMETROS, 'PUT /core/parametros/calendario': { ok: true } });
    const api = criarApiCalendario(sim.chamar);
    const qc = novoQueryClient();
    await qc.prefetchQuery({ queryKey: CHAVE_CALENDARIO, queryFn: api.ler });
    return { sim, api, html: renderizar(createElement(CalendarioPage, { cliente: api, hoje: HOJE }), acoes, qc) };
  }

  it('nacional em leitura, o do tenant com Remover; o painel de almoço aparece uma vez só', async () => {
    const { html } = await tela(['parametro.inicio']);
    const finados = trecho(html, 'calendario.linha.2026-11-02');
    expect(finados).toContain('2 de novembro');
    expect(finados).toContain('Nacional');
    expect(finados).not.toContain('calendario.remover');
    expect(trecho(html, 'calendario.linha.2026-09-05')).toContain('data-testid="calendario.remover.2026-09-05"');
    expect(html).not.toContain('calendario.almoco-padrao.inicio'); // o almoço é o painel próprio (RD-1872)
    expect(html).not.toContain('calendario.almoco.corte');
  });

  it('o PUT leva os feriados', async () => {
    const { sim, api } = await tela(['parametro.inicio']);
    const r = incluirFeriado(PARAMETROS.feriados, { data: '2026-12-08', nome: 'Conceição' });
    if (!r.ok) throw new Error('feriado recusado');
    await api.gravar({ ...PARAMETROS, feriados: r.lista });
    expect(sim.chamadas.at(-1)).toEqual({ metodo: 'PUT', caminho: '/core/parametros/calendario', query: undefined, corpo: { ...PARAMETROS, feriados: r.lista } });
  });

  it('sem parametro.inicio a página não aparece', async () => {
    expect((await tela([])).html).toBe('');
  });
});
