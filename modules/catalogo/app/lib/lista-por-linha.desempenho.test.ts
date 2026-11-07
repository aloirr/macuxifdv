/**
 * Medição da lista por linha com 20 mil produtos (RF-CAT-09, T-0085; R-20261107-111809). Base em memória no Node do PC,
 * como a sonda do engenheiro-apps: 8 sistemas x 6 grupos x 8 linhas, 2% dos produtos sem linha, perfil promotor.
 * Metas: raiz fria < 100 ms e linha de 500 produtos < 300 ms. Os tetos do teste são 2,5x a 4x as metas, para não ficar
 * vermelho por carga do CI; os números reais saem no console (`MACUXI_N` muda o tamanho da base).
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { listaPorLinhaLocal, MAXIMO_NOS_MEMORIZADOS } from './lista-por-linha-local';
import type { LeitorLocal } from './local';

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

describe('RF-CAT-09: desempenho da lista por linha com 20 mil produtos', () => {
  const b = montarBase();
  const tabelas: Record<string, LinhaSync[]> = { catalogo_no: b.nos, produto: b.produtos, produto_no: b.vinculos };
  const porId = new Map(b.produtos.map((p) => [p.id, p]));
  const porNo = new Map<string, LinhaSync[]>();
  for (const v of b.vinculos) {
    const no = (v as unknown as { no_id: string }).no_id;
    porNo.set(no, [...(porNo.get(no) ?? []), v]);
  }
  let versao = 0;
  const leitor = (): LeitorLocal => {
    const v = ++versao; // leitor novo = versão nova = memória fria (1ª abertura depois do sync)
    return {
      linhas: async <L extends LinhaSync>(e: string) => (tabelas[e] ?? []) as L[],
      linhasPorIds: async <L extends LinhaSync>(e: string, ids: readonly string[]) => (e === 'produto' ? ids.map((id) => porId.get(id)).filter(Boolean) : []) as L[],
      linhasPorCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly string[]) => (e === 'produto_no' && campo === 'no_id' ? valores.flatMap((x) => porNo.get(x) ?? []) : []) as L[],
      versaoLinhas: () => v,
    };
  };
  const entrada = { perfil: 'promotor' as const, parametros: {}, agora: AGORA, clienteId: null, fuso: 'America/Manaus' };
  const medir = async (rotulo: string, f: () => Promise<unknown>) => {
    const t = performance.now();
    await f();
    const ms = performance.now() - t;
    console.log(`[medicao lista-por-linha N=${N}] ${rotulo}: ${ms.toFixed(0)} ms`);
    return ms;
  };
  /** Menor de `vezes` aberturas frias (leitor novo a cada uma): descarta o ruído de CPU de outros testes em paralelo. */
  const melhorDe = async (rotulo: string, vezes: number, f: (l: LeitorLocal) => Promise<unknown>) => {
    const tempos: number[] = [];
    for (let i = 0; i < vezes; i++) tempos.push(await medir(rotulo, () => f(leitor())));
    return Math.min(...tempos);
  };

  it('RF-CAT-09: abre a raiz fria em < 100 ms (teto do teste 400 ms) sem ordenar produtos', async () => {
    let r!: Awaited<ReturnType<typeof listaPorLinhaLocal>>;
    const ms = await melhorDe('raiz fria', 5, async (l) => (r = await listaPorLinhaLocal(l, { ...entrada, noId: null })));
    expect(r.filhos.length).toBe(9); // 8 sistemas + "Sem linha"
    expect(r.total).toBe(N);
    expect(ms).toBeLessThan(400);
    const l = leitor();
    await listaPorLinhaLocal(l, { ...entrada, noId: null });
    expect(await medir('raiz quente', () => listaPorLinhaLocal(l, { ...entrada, noId: null }))).toBeLessThan(400);
  });

  it('RF-CAT-09: abre sistema e grupo sem ordenar tudo', async () => {
    expect(await melhorDe('sistema (frio)', 3, (l) => listaPorLinhaLocal(l, { ...entrada, noId: b.sistema }))).toBeLessThan(500);
    expect(await melhorDe('grupo (frio)', 3, (l) => listaPorLinhaLocal(l, { ...entrada, noId: b.grupo }))).toBeLessThan(300);
  });

  it('RF-CAT-09: abre uma linha de 500 produtos em < 300 ms (teto 750 ms), mostrando só os 100 primeiros', async () => {
    let r!: Awaited<ReturnType<typeof listaPorLinhaLocal>>;
    const ms = await melhorDe('linha de 500 (fria)', 3, async (l) => (r = await listaPorLinhaLocal(l, { ...entrada, noId: b.linhaGrande })));
    expect(r.total).toBeGreaterThanOrEqual(500);
    expect(r.itens.length).toBe(100);
    expect(r.restantes).toBe(r.total - 100);
    expect(ms).toBeLessThan(750);
  });

  it('RF-CAT-09: "Mostrar mais" traz os 100 seguintes da linha, sem repetir item, em < 750 ms', async () => {
    const l = leitor();
    const primeira = await listaPorLinhaLocal(l, { ...entrada, noId: b.linhaGrande });
    const t = performance.now();
    const segunda = await listaPorLinhaLocal(l, { ...entrada, noId: b.linhaGrande, limite: 200 });
    expect(performance.now() - t).toBeLessThan(750);
    expect(segunda.itens).toHaveLength(200);
    expect(segunda.itens.slice(0, 100).map((i) => i.id)).toEqual(primeira.itens.map((i) => i.id));
    expect(new Set(segunda.itens.map((i) => i.id)).size).toBe(200);
    expect(segunda.restantes).toBe(segunda.total - 200);
  });

  it(`RF-CAT-09: o cache por nó é limitado (LRU): passados ${MAXIMO_NOS_MEMORIZADOS} nós, o mais antigo é relido; o recente não`, async () => {
    let lidas = 0;
    const base = leitor();
    const l: LeitorLocal = { ...base, linhasPorCampo: async (...a: Parameters<NonNullable<LeitorLocal['linhasPorCampo']>>) => (a[0] === 'produto_no' && lidas++, base.linhasPorCampo!(...a)) };
    const ids = b.nos.map((n) => n.id).slice(0, MAXIMO_NOS_MEMORIZADOS + 5);
    for (const id of ids) await listaPorLinhaLocal(l, { ...entrada, noId: id });
    lidas = 0;
    await listaPorLinhaLocal(l, { ...entrada, noId: ids[ids.length - 1]! });
    expect(lidas).toBe(0); // o último continua na memória
    await listaPorLinhaLocal(l, { ...entrada, noId: ids[0]! });
    expect(lidas).toBeGreaterThan(0); // o primeiro saiu
  });
});
