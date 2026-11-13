/** Extras do cartão de produto (T-0142): aplicação, "Equivale a" e etiquetas; "Mostrar mais"; leitura offline por produto. */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ProdutoConteudoSyncSchema, ProdutoReferenciaSyncSchema } from '../../contracts';
import { etiquetasDoItem, extrasLocais, MAXIMO_REFERENCIAS, montarExtras, SEM_EXTRAS, textoEquivale } from './extras-item';
import type { LeitorLocal } from './local';

const AGORA = '2026-11-09T12:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MARCA = (n: number) => uuid(700 + n);
const conteudo = (n: number, o: Record<string, unknown> = {}) => ProdutoConteudoSyncSchema.parse({ id: uuid(600 + n), updated_at: AGORA, deleted_at: null, external_id: null, produto_id: uuid(100 + n), descricao: null, ...o });
const ref = (n: number, ordem: number, o: Record<string, unknown> = {}) => ProdutoReferenciaSyncSchema.parse({ id: uuid(650 + n * 10 + ordem), updated_at: AGORA, deleted_at: null, external_id: null, produto_id: uuid(100 + n), marca_id: MARCA(ordem), codigo: `C${ordem}`, ordem, marca_nome: `M${ordem}`, ...o });

describe('RN-CAT-09: "Equivale a" no cartão', () => {
  it(`RN-CAT-09: o texto é "Equivale a: <marca_nome> <código>" e o corte defensivo é de ${MAXIMO_REFERENCIAS}`, () => {
    expect(textoEquivale(montarExtras(undefined, [ref(1, 1, { marca_nome: 'Bosch', codigo: 'CB 3401' })]).referencias)).toBe('Equivale a: Bosch CB 3401');
    expect(textoEquivale(montarExtras(undefined, [ref(1, 1), ref(1, 2), ref(1, 3)]).referencias)).toBe('Equivale a: M1 C1 · M2 C2 · M3 C3');
    const lixo = Array.from({ length: 5 }, (_, i) => ({ marca_id: MARCA(i), marca_nome: `M${i}`, codigo: `C${i}` }));
    expect(textoEquivale(lixo)?.split(' · ')).toHaveLength(MAXIMO_REFERENCIAS);
  });
  it('RN-CAT-09: sem referência a linha some; referência apagada ou sem retrato de marca fica de fora; ordem do cadastro', () => {
    expect(textoEquivale([])).toBeNull();
    const extras = montarExtras(undefined, [ref(1, 3), ref(1, 1, { marca_nome: null }), ref(1, 2, { deleted_at: AGORA }), ref(1, 1, { id: uuid(1), marca_nome: 'NGK', codigo: 'X9' })]);
    expect(extras.referencias).toEqual([{ marca_id: MARCA(1), marca_nome: 'NGK', codigo: 'X9' }, { marca_id: MARCA(3), marca_nome: 'M3', codigo: 'C3' }]);
  });
  it('RN-CAT-11: aplicação e etiquetas vêm do conteúdo; conteúdo removido ou ausente = vazio', () => {
    expect(montarExtras(conteudo(1, { aplicacao: ' Gol G5 ', etiquetas: ['Dianteira', 'Novo'] }), [])).toMatchObject({ aplicacao: 'Gol G5', etiquetas: ['Dianteira', 'Novo'] });
    expect(montarExtras(conteudo(1, { aplicacao: 'x', deleted_at: AGORA }), [])).toEqual(SEM_EXTRAS);
    expect(montarExtras(undefined, [])).toEqual(SEM_EXTRAS);
  });
  it('etiquetas: sem repetir (ignora maiúsculas); tamanho e quantidade ficam com o contrato (até 4 de 20)', () => {
    expect(etiquetasDoItem(['Novo', 'novo', ' ', 'Promo'])).toEqual(['Novo', 'Promo']);
    expect(ProdutoConteudoSyncSchema.safeParse({ ...conteudo(1), etiquetas: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
});

describe('RF-CAT-09: extras lidos do aparelho (offline)', () => {
  const tabelas: Record<string, LinhaSync[]> = {
    produto_conteudo: [conteudo(1, { aplicacao: 'Gol G5', etiquetas: ['Novo'] }), conteudo(2, { aplicacao: 'Uno' })],
    produto_referencia: [ref(1, 1, { marca_nome: 'Bosch', codigo: 'CB 1' })],
  };
  const pedidos: string[][] = [];
  const leitor: LeitorLocal = {
    linhas: async <L extends LinhaSync>(e: string) => (tabelas[e] ?? []) as L[],
    linhasPorCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly string[]) => {
      pedidos.push([...valores]);
      return (tabelas[e] ?? []).filter((l) => valores.includes((l as unknown as Record<string, string>)[campo]!)) as L[];
    },
  };
  it('RF-CAT-09: lê só os produtos pedidos e devolve vazio para quem não tem conteúdo', async () => {
    const r = await extrasLocais(leitor, [uuid(101), uuid(103)]);
    expect(r.get(uuid(101))).toMatchObject({ aplicacao: 'Gol G5', etiquetas: ['Novo'], referencias: [{ codigo: 'CB 1' }] });
    expect(r.get(uuid(103))).toEqual(SEM_EXTRAS);
    expect(pedidos.every((v) => v.length === 2)).toBe(true);
    expect((await extrasLocais(leitor, [])).size).toBe(0);
  });
});
