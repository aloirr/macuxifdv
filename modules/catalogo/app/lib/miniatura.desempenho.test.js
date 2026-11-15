import { describe, expect, it } from 'vitest';
import { miniaturasLocais } from './miniatura-local';
const N = Number(process.env['MACUXI_N'] ?? 20000);
const AGORA = '2026-11-07T12:00:00.000Z';
const uuid = (prefixo, n) => `${prefixo.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const base = (id, o) => ({ id, updated_at: AGORA, deleted_at: null, external_id: null, ...o });
function montarBase() {
    const nos = [];
    const linhasFolha = [];
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
    const produtos = [];
    const vinculos = [];
    for (let i = 0; i < N; i++) {
        const id = uuid(2, i + 1);
        produtos.push(base(id, { sku: `P-${i}`, ean: null, nome: `Produto ${(i * 7919) % N} Ação`, marca: 'X', categoria: 'Y', unidade: 'UN', ativo: true }));
        if (i % 50 !== 0)
            vinculos.push(base(uuid(3, i + 1), { produto_id: id, no_id: i < 500 ? linhasFolha[0] : linhasFolha[i % linhasFolha.length] }));
    }
    return { nos, produtos, vinculos, linhaGrande: linhasFolha[0], sistema: nos[0].id, grupo: nos[1].id };
}
describe('T-0097: miniaturas com 20 mil produtos', () => {
    const b = montarBase();
    const miniatura = (i) => ({ arquivo_id: uuid(5, i + 1), url: `/v1/arquivos/${uuid(5, i + 1)}`, largura: 320, altura: 320, bytes_max: 30720, versao: `v${i}` });
    const conteudos = b.produtos.map((p, i) => base(uuid(4, i + 1), { produto_id: p.id, descricao: null, argumentos: [], faq: [], campanha: false, miniatura: miniatura(i) }));
    const conteudoPorProduto = new Map(conteudos.map((c) => [c.produto_id, c]));
    const tabelas = { catalogo_no: b.nos, produto: b.produtos, produto_no: b.vinculos, produto_conteudo: conteudos };
    const porId = new Map(b.produtos.map((p) => [p.id, p]));
    const porNo = new Map();
    for (const v of b.vinculos) {
        const no = v.no_id;
        porNo.set(no, [...(porNo.get(no) ?? []), v]);
    }
    let versao = 0;
    const lidosConteudo = [];
    const leitor = () => {
        const v = ++versao;
        return {
            linhas: async (e) => (tabelas[e] ?? []),
            linhasPorIds: async (e, ids) => (e === 'produto' ? ids.map((id) => porId.get(id)).filter(Boolean) : []),
            linhasPorCampo: async (e, campo, valores) => {
                if (e === 'produto_conteudo' && campo === 'produto_id') {
                    lidosConteudo.push([...valores]);
                    return valores.map((x) => conteudoPorProduto.get(x)).filter(Boolean);
                }
                return (e === 'produto_no' && campo === 'no_id' ? valores.flatMap((x) => porNo.get(x) ?? []) : []);
            },
            versaoLinhas: () => v,
        };
    };
    const medir = async (rotulo, f) => {
        const t = performance.now();
        await f();
        const ms = performance.now() - t;
        console.log(`[medicao miniatura N=${N}] ${rotulo}: ${ms.toFixed(1)} ms`);
        return ms;
    };
    it('T-0097: miniaturasLocais dos 100 itens exibidos é < 50 ms lendo só esses ids (20 mil produtos com miniatura)', async () => {
        const ids = b.produtos.slice(0, 100).map((p) => p.id);
        await miniaturasLocais(leitor(), ids); // aquecimento (compilação do código)
        const tempos = [];
        let mapa;
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
