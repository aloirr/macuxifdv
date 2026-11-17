/**
 * Parâmetros › Início › "Frases do dia" (T-0170; RN-CORE-41; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §2.1 e §3),
 * com a API simulada guardando as frases em memória: as 30 padrão, adicionar, editar, desativar, reordenar e remover nas
 * rotas e contratos da N-B, e a "Frase de hoje" recalculada depois de salvar.
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { FraseDiaSync } from '../../../contracts/frases';
import { FRASES_PADRAO } from '../../../domain/frase-avatar/frases-padrao';
import { criarApiSimulada, erro422, novoQueryClient, renderizar, trecho, type ChamadaSimulada } from '../tarefas/api-simulada';
import { CHAVE_FRASES, criarApiFrases } from './api';
import { FrasesDoDiaPanel } from './frases-do-dia-panel';
import { mensagemDoErroFrase, moverFrase } from './frases';

/** Exemplo do desenho §3: 12/11/2026 é o dia 20769; 20769 mod 30 = 9 → frase nº 10 com as 30 padrão ativas. */
const HOJE = '2026-11-12';
const id = (n: number) => `5a1b2c3d-4e5f-4a6b-8c7d-0000000000${String(n).padStart(2, '0')}`;
const ATUALIZADO = '2026-11-12T10:00:00.000Z';

/** API simulada com as frases em memória: as rotas da N-D alteram a lista como a API vai alterar o banco. */
function apiComFrases() {
  let frases: FraseDiaSync[] = FRASES_PADRAO.map((p, i) => ({ id: id(i + 1), texto: p.texto, ativa: true, ordem: i + 1, padrao_codigo: p.codigo, updated_at: ATUALIZADO, deleted_at: null, external_id: null }));
  const idDa = (c: ChamadaSimulada) => c.caminho.split('/').pop()!;
  const rotas: Record<string, unknown> = {
    'GET /core/frases': () => ({ itens: frases }),
    'POST /core/frases': (c: ChamadaSimulada) => {
      const corpo = c.corpo as { texto: string; ativa: boolean };
      frases = [...frases, { id: id(99), texto: corpo.texto, ativa: corpo.ativa, ordem: frases.length + 1, padrao_codigo: null, updated_at: ATUALIZADO, deleted_at: null, external_id: null }];
      return { id: id(99) };
    },
    'PUT /core/frases/ordem': (c: ChamadaSimulada) => {
      const ids = (c.corpo as { ids: string[] }).ids;
      frases = frases.map((f) => ({ ...f, ordem: ids.indexOf(f.id) + 1 }));
      return { ok: true };
    },
  };
  for (const f of frases) {
    rotas[`PUT /core/frases/${f.id}`] = (c: ChamadaSimulada) => {
      frases = frases.map((x) => (x.id === idDa(c) ? { ...x, ...(c.corpo as object) } : x));
      return { ok: true };
    };
    rotas[`DELETE /core/frases/${f.id}`] = (c: ChamadaSimulada) => {
      frases = frases.map((x) => (x.id === idDa(c) ? { ...x, deleted_at: ATUALIZADO } : x));
      return { ok: true };
    };
  }
  const sim = criarApiSimulada(rotas);
  return { sim, api: criarApiFrases(sim.chamar) };
}

/** Tela depois de (re)buscar a lista, como o `invalidateQueries` faz depois de cada salvamento. */
async function tela(api: ReturnType<typeof criarApiFrases>, acoes = ['frase_dia.editar']) {
  const qc = novoQueryClient();
  await qc.fetchQuery({ queryKey: CHAVE_FRASES, queryFn: api.listar });
  return renderizar(createElement(FrasesDoDiaPanel, { cliente: api, hoje: HOJE }), acoes, qc);
}

describe('as 30 padrão e a frase de hoje', () => {
  it('lista as 30 na ordem, com a frase nº 10 como frase de hoje em 12/11/2026 (exemplo do §3)', async () => {
    const { api } = apiComFrases();
    const html = await tela(api);
    for (let n = 1; n <= 30; n++) expect(html).toContain(`data-testid="frases.linha.${id(n)}"`);
    expect(trecho(html, `frases.linha.${id(10)}`, '</li>')).toContain('frases.hoje');
    expect(html.match(/data-testid="frases\.hoje"/g)).toHaveLength(1);
  });

  it('sem frase_dia.editar o painel não aparece', async () => {
    const { api } = apiComFrases();
    expect(await tela(api, [])).toBe('');
  });
});

describe('adicionar, editar, desativar, reordenar e remover pelas rotas da N-B', () => {
  it('cada ação vai na rota e no corpo do contrato', async () => {
    const { sim, api } = apiComFrases();
    await api.criar({ texto: 'Bora vender!', ativa: true });
    await api.editar(id(1), { texto: 'Cada visita conta.' });
    await api.editar(id(2), { ativa: false });
    await api.reordenar([id(2), id(1)]);
    await api.remover(id(3));
    expect(sim.chamadas.map((c) => [c.metodo, c.caminho, c.corpo])).toEqual([
      ['POST', '/core/frases', { texto: 'Bora vender!', ativa: true }],
      ['PUT', `/core/frases/${id(1)}`, { texto: 'Cada visita conta.' }],
      ['PUT', `/core/frases/${id(2)}`, { ativa: false }],
      ['PUT', '/core/frases/ordem', { ids: [id(2), id(1)] }],
      ['DELETE', `/core/frases/${id(3)}`, undefined],
    ]);
  });

  it('"Frase de hoje" depois de salvar: desativar a 1ª muda a conta (29 ativas → 20769 mod 29 = 5, a nº 7)', async () => {
    const { api } = apiComFrases();
    expect(trecho(await tela(api), `frases.linha.${id(10)}`, '</li>')).toContain('frases.hoje');
    await api.editar(id(1), { ativa: false });
    const depois = await tela(api);
    expect(trecho(depois, `frases.linha.${id(7)}`, '</li>')).toContain('frases.hoje');
    const primeira = trecho(depois, `frases.linha.${id(1)}`, '</li>');
    expect(primeira).toContain('Desativada');
    expect(primeira).toContain(`frases.acoes.${id(1)}`);
  });

  it('reordenar e remover também mudam a frase de hoje; a removida sai da lista', async () => {
    const { api } = apiComFrases();
    await api.reordenar(moverFrase(Array.from({ length: 30 }, (_, i) => id(i + 1)), id(10), -1)!);
    expect(trecho(await tela(api), `frases.linha.${id(9)}`, '</li>')).toContain('frases.hoje');
    await api.remover(id(9));
    const html = await tela(api);
    expect(html).not.toContain(`frases.linha.${id(9)}`);
    expect(html.match(/data-testid="frases\.hoje"/g)).toHaveLength(1);
  });

  it('sem frase ativa, nenhuma linha leva o selo Hoje', async () => {
    const { api } = apiComFrases();
    for (let n = 1; n <= 30; n++) await api.editar(id(n), { ativa: false });
    expect(await tela(api)).not.toContain('frases.hoje"');
  });

  it('cada linha tem o menu "⋯" no lugar dos botões soltos; só Adicionar fica como botão', async () => {
    const html = await tela(apiComFrases().api);
    expect(html).toContain(`frases.acoes.${id(1)}`);
    expect(html).not.toContain(`frases.editar.${id(1)}"`);
    expect(html).not.toContain('Frases do dia'); // o título do painel é do shell (RD-2013)
  });
});

describe('regras de tela', () => {
  it('moverFrase troca com a vizinha; na ponta devolve null', () => {
    expect(moverFrase(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moverFrase(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moverFrase(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moverFrase(['a', 'b', 'c'], 'c', 1)).toBeNull();
  });

  it('422 RN-CORE-41 da API vira a mesma mensagem da validação local', () => {
    expect(mensagemDoErroFrase(erro422('RN-CORE-41', 'Frase repetida.', { motivo: 'repetida' }))).toBe('Esta frase já está na lista.');
    expect(mensagemDoErroFrase(erro422('RN-CORE-41', 'Limite.', { motivo: 'limite' }))).toBe('A lista já tem 366 frases. Remova uma para adicionar outra.');
    expect(mensagemDoErroFrase(erro422('OUTRO', 'Tente de novo.'))).toBe('Tente de novo.');
  });
});
