/**
 * T-0090 (modelo A, R-20261106-064752): parte pura do filtro de período da lista de Pedidos — calendário, selo do botão,
 * leituras do TalkBack e o comportamento da folha Período (critério 6: o atalho aplica e fecha; "Escolher dia, mês ou ano"
 * abre Dia, Mês e Ano; "Limpar" volta ao padrão). A `FolhaPeriodo` só executa o resultado de `eventoDaFolha`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  anosAte,
  celulaMarcada,
  depoisDeHoje,
  deslocarMes,
  estadoAoAbrirFolha,
  eventoDaFolha,
  gradeDoMes,
  leituraDoBotaoFiltro,
  leituraDoDia,
  leituraDoMes,
  mesesDoAno,
  textoDoSelo,
  tituloDoMes,
} from './periodo';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');
const HOJE = '2026-11-06';

describe('calendário (aba Dia), grade Mês e aba Ano', () => {
  it('novembro de 2026 começa no domingo e tem 5 semanas de 7 posições', () => {
    const g = gradeDoMes('2026-11');
    expect(g).toHaveLength(5);
    for (const s of g) expect(s).toHaveLength(7);
    expect(g[0]![0]).toBe('2026-11-01');
    expect(g[4]![1]).toBe('2026-11-30');
    expect(g[4]![2]).toBeNull();
  });

  it('fevereiro de 2026 começa no domingo e tem 4 semanas; outubro de 2026 começa na quinta', () => {
    expect(gradeDoMes('2026-02')).toHaveLength(4);
    const out = gradeDoMes('2026-10');
    expect(out[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[0]![4]).toBe('2026-10-01');
  });

  it('mês ±1 atravessa o ano; meses e anos da grade', () => {
    expect(deslocarMes('2026-01', -1)).toBe('2025-12');
    expect(deslocarMes('2026-12', 1)).toBe('2027-01');
    expect(mesesDoAno('2026')).toHaveLength(12);
    expect(mesesDoAno('2026')[10]).toBe('2026-11');
    expect(anosAte('2026')).toEqual(['2026', '2025', '2024', '2023', '2022']);
  });

  it('depois de hoje fica sem toque (dia, mês e ano)', () => {
    expect(depoisDeHoje({ tipo: 'dia', valor: '2026-11-07' }, HOJE)).toBe(true);
    expect(depoisDeHoje({ tipo: 'dia', valor: HOJE }, HOJE)).toBe(false);
    expect(depoisDeHoje({ tipo: 'mes', valor: '2026-12' }, HOJE)).toBe(true);
    expect(depoisDeHoje({ tipo: 'mes', valor: '2026-11' }, HOJE)).toBe(false);
    expect(depoisDeHoje({ tipo: 'ano', valor: '2027' }, HOJE)).toBe(true);
  });

  it('textos e leituras: "Novembro 2026", "sexta, 6 de novembro de 2026", "novembro de 2026"', () => {
    expect(tituloDoMes('2026-11')).toBe('Novembro 2026');
    expect(leituraDoDia('2026-11-06')).toBe('sexta, 6 de novembro de 2026');
    expect(leituraDoMes('2026-03')).toBe('março de 2026');
    expect(celulaMarcada({ tipo: 'mes', valor: '2026-11' }, { tipo: 'mes', valor: '2026-11' })).toBe(true);
    expect(celulaMarcada({ tipo: 'dia', valor: '2026-11' }, { tipo: 'mes', valor: '2026-11' })).toBe(false);
  });
});

describe('botão de filtro com selo', () => {
  it('selo só com filtro ativo; acima de 9, "9+"; leitura com a contagem', () => {
    expect(textoDoSelo(0)).toBeNull();
    expect(textoDoSelo(1)).toBe('1');
    expect(textoDoSelo(12)).toBe('9+');
    expect(leituraDoBotaoFiltro('Filtrar', 0)).toBe('Filtrar');
    expect(leituraDoBotaoFiltro('Filtrar', 1)).toBe('Filtrar, 1 filtro ativo');
    expect(leituraDoBotaoFiltro('Filtrar', 2)).toBe('Filtrar, 2 filtros ativos');
  });
});

describe('folha Período: comportamento (critérios 2 e 6 da T-0090)', () => {
  it('abre nos atalhos quando vale um atalho; com dia, mês ou ano em vigor, abre direto na aba dele', () => {
    expect(estadoAoAbrirFolha(null, HOJE)).toEqual({ modo: 'atalhos', aba: 'mes', mesVisto: '2026-11', anoVisto: '2026' });
    expect(estadoAoAbrirFolha({ tipo: 'dia', valor: '2026-09-15' }, HOJE)).toEqual({ modo: 'escolher', aba: 'dia', mesVisto: '2026-09', anoVisto: '2026' });
    expect(estadoAoAbrirFolha({ tipo: 'ano', valor: '2024' }, HOJE)).toMatchObject({ modo: 'escolher', aba: 'ano', anoVisto: '2024' });
  });

  it('tocar num atalho aplica e fecha', () => {
    const r = eventoDaFolha(estadoAoAbrirFolha(null, HOJE), { tipo: 'atalho', id: 'ontem' }, HOJE);
    expect(r.atalho).toBe('ontem');
    expect(r.fechar).toBe(true);
    expect(r.escolha).toBeUndefined();
  });

  it('"Escolher dia, mês ou ano" abre as abas Dia, Mês e Ano sem aplicar nem fechar', () => {
    let e = estadoAoAbrirFolha(null, HOJE);
    let r = eventoDaFolha(e, { tipo: 'abrirEscolha' }, HOJE);
    expect(r).toEqual({ estado: { ...e, modo: 'escolher' }, fechar: false });
    e = r.estado;
    for (const aba of ['dia', 'mes', 'ano'] as const) {
      r = eventoDaFolha(e, { tipo: 'aba', aba }, HOJE);
      expect(r.estado.aba).toBe(aba);
      expect(r.fechar).toBe(false);
    }
    expect(eventoDaFolha(r.estado, { tipo: 'voltar' }, HOJE).estado.modo).toBe('atalhos');
  });

  it('dia, mês ou ano aplica e fecha; depois de hoje não aplica', () => {
    const e = { ...estadoAoAbrirFolha(null, HOJE), modo: 'escolher' as const };
    const r = eventoDaFolha(e, { tipo: 'celula', escolha: { tipo: 'dia', valor: '2026-11-02' } }, HOJE);
    expect(r.escolha).toEqual({ tipo: 'dia', valor: '2026-11-02' });
    expect(r.fechar).toBe(true);
    const futuro = eventoDaFolha(e, { tipo: 'celula', escolha: { tipo: 'mes', valor: '2026-12' } }, HOJE);
    expect(futuro.escolha).toBeUndefined();
    expect(futuro.fechar).toBe(false);
  });

  it('as setas não passam do mês e do ano de hoje', () => {
    const e = estadoAoAbrirFolha(null, HOJE);
    expect(eventoDaFolha(e, { tipo: 'mesVisto', passo: 1 }, HOJE).estado.mesVisto).toBe('2026-11');
    expect(eventoDaFolha(e, { tipo: 'mesVisto', passo: -1 }, HOJE).estado.mesVisto).toBe('2026-10');
    expect(eventoDaFolha(e, { tipo: 'anoVisto', passo: 1 }, HOJE).estado.anoVisto).toBe('2026');
    expect(eventoDaFolha(e, { tipo: 'anoVisto', passo: -1 }, HOJE).estado.anoVisto).toBe('2025');
  });

  it('"Limpar" volta ao padrão, mostra os atalhos e a folha fica aberta', () => {
    const e = { ...estadoAoAbrirFolha({ tipo: 'mes', valor: '2026-09' }, HOJE) };
    const r = eventoDaFolha(e, { tipo: 'limpar' }, HOJE);
    expect(r.limpar).toBe(true);
    expect(r.fechar).toBe(false);
    expect(r.estado.modo).toBe('atalhos');
  });
});

describe('filtro.tsx: conferência estática', () => {
  const f = ler('./filtro.tsx');

  it('a folha executa o resultado de eventoDaFolha (onAtalho, onEscolher, onLimpar e onFechar)', () => {
    expect(f).toContain('const r = eventoDaFolha(estado, evento, hoje);');
    expect(f).toContain('if (r.atalho !== undefined) onAtalho(r.atalho);');
    expect(f).toContain('if (r.escolha) onEscolher(r.escolha);');
    expect(f).toContain('if (r.limpar) onLimpar();');
    expect(f).toContain('if (r.fechar) onFechar();');
    expect(f).toContain("onPress={() => tocar({ tipo: 'atalho', id: a.id })}");
    expect(f).toContain("onPress={() => tocar({ tipo: 'abrirEscolha' })}");
  });

  it('etiqueta removível: o toque chama onRemover, ✕ visível e alvo de 44 dp sem hitSlop', () => {
    const et = /export function EtiquetaFiltro[\s\S]*?\n}\n/.exec(f)?.[0] ?? '';
    expect(et).toContain('onPress={onRemover}');
    expect(et).toContain('<Icon name="close"');
    expect(et).not.toContain('hitSlop');
    expect(f).toMatch(/etiquetaAlvo: \{[^}]*minHeight: ALVO_ETIQUETA/);
    expect(f).toContain('const ALVO_ETIQUETA = 44;');
  });

  it('botão de filtro de 48 dp com selo; nenhum hitSlop e nenhum texto fixo no arquivo', () => {
    expect(f).toMatch(/botao: \{ width: ALVO_TOQUE, height: ALVO_TOQUE/);
    expect(f).not.toContain('hitSlop');
    expect(f).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
    expect(ler('./icon.tsx')).toMatch(/case 'filtro':/);
  });
});
