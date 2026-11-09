/**
 * Medição com miniatura (T-0097): base de 20 mil produtos com `produto_conteudo` + miniatura para todos;
 * `miniaturasLocais` dos 100 itens exibidos lê só esses ids e é rápida.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { MiniaturaProduto } from '../../contracts';
import type { LeitorLocal } from './local';
import { miniaturasLocais } from './miniatura-local';

const N = Number(process.env['MACUXI_N'] ?? 20000);
const AGORA = '2026-11-07T12:00:00.000Z';
const uuid = (prefixo: number, n: number) => `${prefixo.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const base = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: AGORA, deleted_at: null, external_id: null, ...o }) as LinhaSync;

function montarBase() {
  const nos: LinhaSync[] = [];
  const linhasFolha: string[] = [];
  let k = 0;
  for (let s = 0; s < 8; s++) {
    const sid = uuid(1, ++k);
    nos.push(base(sid, { pai_id: null, codigo: `S${s}`, nome: `Sistema ${s}`, nivel: 1, ordem: s, ativo: true }));
    for (let g = 0; g < 6; g++) {
      const gid = uuid(1, ++k);
      nos.push(base(gid, { pai_id: sid, codigo: `G${s}${g}`, nome: `Grupo ${s}-${g}`, nivel: 2, ordem: g, ativo: true }));
      for (let l = 0; l < 8; l++) {
        const lid = uuid(1, ++k);
        nos.push(base(lid, { pai_id: gid, codigo: `L${s}${g}${l}`, nome: `Linha ${s}-${g}-${l}`, nivel: 3, ordem: l, ativo: true }));
        linhasFolha.push(lid);
      }
    }
  }
  const produtos: LinhaSync[] = [];
  const vinculos: LinhaSync[] = [];
  for (let i = 0; i < N; i++) {
    const id = uuid(2, i + 1);
    produtos.push(base(id, { sku: `P-${i}`, ean: null, nome: `Produto ${(i * 7919) % N} Ação`, marca: 'X', categoria: 'Y', unidade: 'UN', ativo: true }));
    if (i % 50 !== 0) vinculos.push(base(uuid(3, i + 1), { produto_id: id, no_id: i < 500 ? linhasFolha[0]! : linhasFolha[i % linhasFolha.length]! }));
  }
  return { nos, produtos, vinculos, linhaGrande: linhasFolha[0]!, sistema: nos[0]!.id, grupo: nos[1]!.id };
}

describe('T-0097: miniaturas com 20 mil produtos', () => {
  const b = montarBase();
  const miniatura = (i: number): MiniaturaProduto => ({ arquivo_id: uuid(5, i + 1), url: `/v1/arquivos/${uuid(5, i + 1)}`, largura: 320, altura: 320, bytes_max: 30720, versao: `v${i}` });
  const conteudos: LinhaSync[] = b.produtos.map((p, i) => base(uuid(4, i + 1), { produto_id: p.id, descricao: null, argumentos: [], faq: [], campanha: false, miniatura: miniatura(i) }));
  const conteudoPorProduto = new Map(conteudos.map((c) => [(c as unknown as { produto_id: string }).produto_id, c]));
  const tabelas: Record<string, LinhaSync[]> = { catalogo_no: b.nos, produto: b.produtos, produto_no: b.vinculos, produto_conteudo: conteudos };
  const porId = new Map(b.produtos.map((p) => [p.id, p]));
  const porNo = new Map<string, LinhaSync[]>();
  for (const v of b.vinculos) {
    const no = (v as unknown as { no_id: string }).no_id;
    porNo.set(no, [...(porNo.get(no) ?? []), v]);
  }
  let versao = 0;
  const lidosConteudo: string[][] = [];
  const leitor = (): LeitorLocal => {
    const v = ++versao;
    return {
      linhas: async <L extends LinhaSync>(e: string) => (tabelas[e] ?? []) as L[],
      linhasPorIds: async <L extends LinhaSync>(e: string, ids: readonly string[]) => (e === 'produto' ? ids.map((id) => porId.get(id)).filter(Boolean) : []) as L[],
      linhasPorCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly string[]) => {
        if (e === 'produto_conteudo' && campo === 'produto_id') {
          lidosConteudo.push([...valores]);
          return valores.map((x) => conteudoPorProduto.get(x)).filter(Boolean) as L[];
        }
        return (e === 'produto_no' && campo === 'no_id' ? valores.flatMap((x) => porNo.get(x) ?? []) : []) as L[];
      },
      versaoLinhas: () => v,
    };
  };
  const medir = async (rotulo: string, f: () => Promise<unknown>) => {
    const t = performance.now();
    await f();
    const ms = performance.now() - t;
    console.log(`[medicao miniatura N=${N}] ${rotulo}: ${ms.toFixed(1)} ms`);
    return ms;
  };

  it('T-0097: miniaturasLocais dos 100 itens exibidos é < 50 ms lendo só esses ids (20 mil produtos com miniatura)', async () => {
    const ids = b.produtos.slice(0, 100).map((p) => p.id);
    await miniaturasLocais(leitor(), ids); // aquecimento (compilação do código)
    const tempos: number[] = [];
    let mapa!: Map<string, MiniaturaProduto>;
    for (let i = 0; i < 5; i++) {
      lidosConteudo.length = 0;
      const l = leitor();
      tempos.push(await medir('miniaturasLocais (100 itens)', async () => (mapa = await miniaturasLocais(l, ids))));
    }
    expect(Math.min(...tempos)).toBeLessThan(50);
    expect(mapa.size).toBe(100);
    expect(lidosConteudo).toHaveLength(1);
    expect(new Set(lidosConteudo[0])).toEqual(new Set(ids));
  });
});
