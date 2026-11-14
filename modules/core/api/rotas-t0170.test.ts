/**
 * Frases do dia e metas de produtividade (T-0170) sem banco: ação, superfície e corpo de cada rota, e a lista de ações novas que
 * a costura precisa acrescentar ao manifesto (nenhuma rota de escrita sem `acao`). O comportamento sobre dados reais está nos
 * `*.db.test.ts` de cada rota.
 */
import { describe, expect, it } from 'vitest';
import { rotasDeFrases } from './frases';
import { rotasDeMetasProdutividade } from './metas-produtividade';
import { rotasDePerformance } from './performance';
import { rotasDeAvatar } from './avatar';
import { rotasDeTarefas } from './tarefas';

const resumo = (rotas: ReadonlyArray<{ metodo: string; caminho: string; acao?: string; superficie?: string }>) => rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao ?? '-'} ${r.superficie ?? '-'}`);

describe('rotas de frases e metas de produtividade', () => {
  it('RN-CORE-41: as 5 rotas de frase usam frase_dia.editar e são do BKO; a ordem vem antes de :id', () => {
    expect(resumo(rotasDeFrases)).toEqual([
      'GET frases frase_dia.editar bko',
      'POST frases frase_dia.editar bko',
      'PUT frases/ordem frase_dia.editar bko',
      'PUT frases/:id frase_dia.editar bko',
      'DELETE frases/:id frase_dia.editar bko',
    ]);
    expect(rotasDeFrases.find((r) => r.metodo === 'POST')!.status).toBe(201);
  });

  it('RN-CORE-41: o corpo da frase é o do contrato (texto livre para o domain validar, ordem com 1 a 366 ids)', () => {
    const post = rotasDeFrases.find((r) => r.metodo === 'POST')!;
    expect(post.corpo!.safeParse({ texto: 'Olá' }).success).toBe(true);
    expect(post.corpo!.parse({ texto: 'Olá' })).toEqual({ texto: 'Olá', ativa: true });
    expect(post.corpo!.safeParse({ texto: 'Olá', ordem: 3 }).success).toBe(false);
    const ordem = rotasDeFrases.find((r) => r.caminho === 'frases/ordem')!;
    expect(ordem.corpo!.safeParse({ ids: [] }).success).toBe(false);
    expect(ordem.corpo!.safeParse({ ids: ['0e300000-0000-4000-8000-000000000001'] }).success).toBe(true);
  });

  it('RN-CORE-45: leitura com meta.ver (qualquer perfil do escopo); gravar e voltar a herdar com meta_produtividade.editar, só BKO', () => {
    expect(resumo(rotasDeMetasProdutividade)).toEqual([
      'GET metas-produtividade meta.ver -',
      'PUT metas-produtividade meta_produtividade.editar bko',
      'DELETE metas-produtividade/:id meta_produtividade.editar bko',
    ]);
  });

  it('RN-CORE-45: o corpo do PUT valida faixa, indicador repetido e alvo coerente antes de a rota rodar', () => {
    const put = rotasDeMetasProdutividade.find((r) => r.metodo === 'PUT')!;
    const base = { escopo: 'tenant', vigencia_inicio: '2026-12', metas: [{ indicador: 'tma', valor: 20 }] };
    expect(put.corpo!.safeParse(base).success).toBe(true);
    expect(put.corpo!.safeParse({ ...base, metas: [{ indicador: 'tma', valor: 500 }] }).success).toBe(false);
    expect(put.corpo!.safeParse({ ...base, metas: [{ indicador: 'tma', valor: 20 }, { indicador: 'tma', valor: 21 }] }).success).toBe(false);
    expect(put.corpo!.safeParse({ ...base, escopo: 'equipe' }).success).toBe(false);
    expect(put.corpo!.safeParse({ ...base, metas: [{ indicador: 'itens_por_pedido', valor: 800 }] }).success).toBe(false);
  });

  it('toda rota de escrita declara a ação (a plataforma exige) e as ações novas são exatamente as que a costura põe no manifesto', () => {
    const todas = [...rotasDeTarefas, ...rotasDeFrases, ...rotasDeAvatar, ...rotasDeMetasProdutividade, ...rotasDePerformance];
    for (const r of todas.filter((x) => x.metodo !== 'GET')) expect(r.acao, `${r.metodo} ${r.caminho}`).toBeTruthy();
    const acoes = [...new Set(todas.map((r) => r.acao))].sort();
    expect(acoes).toEqual(['frase_dia.editar', 'meta.ver', 'meta_produtividade.editar', 'tarefa.acompanhar', 'tarefa.criar', 'tarefa.cancelar', 'tarefa.editar', 'usuario_avatar.trocar_outro'].sort());
  });
});
