/**
 * RN-CAT-22 (desenho `docs/desenho/filtro-veiculo.md` §7, critério 9): 20 mil produtos com aplicação em texto, SQLite real. A lista filtrada por
 * veículo (`listaComVeiculo`, a do Catálogo) sai em até 300 ms (p95 sobre vários veículos, com o índice de veículos já montado) e a troca de nível
 * da cascata em até 100 ms. Meta estrita (`MACUXI_DESEMPENHO=1`): os tetos do desenho (`MACUXI_FATOR_DESEMPENHO` folga em CI compartilhado); na suíte
 * (turbo em paralelo, runner lento) os tetos têm folga de 3x, como a de `desempenho-vitrine.test.ts`. O tempo da montagem do índice é impresso.
 */
import { criarArmazenamentoSqlite, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { describe, expect, it } from 'vitest';
import { entidadesSyncCatalogo } from '../../../tests/modulos/apoio/entidades-catalogo';
import { migracoesAparelho } from '../db/aparelho';
import type { VeiculoEscolhido } from '../contracts';
import { esquecerMemoriaLocal, type LeitorLocal } from './lib/local';
import { cascataLocal, esquecerVeiculosRecentes, listaComVeiculo } from './veiculos-consulta';

const AGORA = '2026-11-21T12:00:00.000Z'; // hora-fixa-ok: instante do catálogo medido
const base = { updated_at: '2026-11-01T00:00:00.000000Z', deleted_at: null, external_id: null };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const N_PRODUTOS = 20_000;
const FATOR = Math.max(1, Number(process.env.MACUXI_FATOR_DESEMPENHO ?? 1));
const ESTRITO = process.env.MACUXI_DESEMPENHO === '1';

const MODELOS: readonly (readonly [string, string])[] = [
  ['Fiat', 'Uno'], ['Fiat', 'Palio'], ['Fiat', 'Strada'], ['Volkswagen', 'Gol'], ['Volkswagen', 'Fox'], ['Volkswagen', 'Saveiro'], ['Chevrolet', 'Celta'], ['Chevrolet', 'Corsa'],
  ['Chevrolet', 'Onix'], ['Chevrolet', 'Prisma'], ['Ford', 'Ka'], ['Ford', 'Fiesta'], ['Hyundai', 'HB20'], ['Renault', 'Sandero'], ['Renault', 'Logan'], ['Honda', 'Civic'],
  ['Toyota', 'Corolla'], ['Toyota', 'Hilux'], ['Ford', 'Ranger'], ['Peugeot', 'Partner'],
];
const MOTORES = ['1.0', '1.4', '1.6', '2.0'];
const VERSOES = ['Flex', 'Turbo', 'Highline', 'Trendline'];
const PECAS = ['Pastilha de freio', 'Filtro de óleo', 'Filtro de ar', 'Correia dentada', 'Amortecedor', 'Vela de ignição', 'Disco de freio', 'Bomba d água'];

type Linha = Record<string, unknown> & LinhaSync;
function gerar() {
  const produto: Linha[] = [];
  const produto_conteudo: Linha[] = [];
  for (let k = 0; k < N_PRODUTOS; k++) {
    const id = uuid(k);
    produto.push({ id, ...base, sku: `P${100000 + k}`, ean: null, nome: `${PECAS[k % PECAS.length]} ${k}`, marca: `Marca ${k % 30}`, categoria: 'Autopeças', unidade: 'UN', ativo: true } as Linha);
    // o modelo fica só na aplicação (RN-CAT-19: é veículo a palavra muito mais frequente nas aplicações que nos nomes): 4 trechos de ~40 caracteres com ano, motor e versão
    const trechos = [0, 1, 2, 3].map((j) => {
      const [montadora, m] = MODELOS[(k + j * 7) % MODELOS.length]!;
      const de = 2000 + ((k * 3 + j * 5) % 22);
      return `${montadora} ${m} ${de}–${de + 4} ${MOTORES[(k + j) % MOTORES.length]} ${VERSOES[(k + 2 * j) % VERSOES.length]}`;
    });
    produto_conteudo.push({ id: `c${k}`, ...base, produto_id: id, aplicacao: trechos.join(' · '), campanha: false, descricao: null, argumentos: [], faq: [], etiquetas: [] } as Linha);
  }
  return { produto, produto_conteudo };
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

describe('RN-CAT-22: lista filtrada por veículo com 20 mil produtos (desenho §7, critério 9)', { timeout: 300_000 }, () => {
  it('RN-CAT-22: a lista com veículo sai em até 300 ms (p95) e a troca de nível da cascata em até 100 ms', async () => {
    const t0 = performance.now();
    const dados = gerar();
    const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: { catalogo: migracoesAparelho },
      entidades: [{ nome: 'produto', modulo: 'core' }, ...entidadesSyncCatalogo()],
      agora: () => new Date(AGORA),
    });
    for (const [nome, linhas] of Object.entries(dados)) for (let k = 0; k < linhas.length; k += 1000) await armazenamento.linhas.aplicar(nome, linhas.slice(k, k + 1000), `k${k}`);
    const msCarga = performance.now() - t0;
    const L = armazenamento.linhas;
    const leitor: LeitorLocal = {
      linhas: async <X extends LinhaSync>(e: string) => L.listar<X>(e),
      linhasPorIds: async <X extends LinhaSync>(e: string, ids: readonly string[]) => L.porIds<X>(e, ids),
      linhasPorCampo: async <X extends LinhaSync>(e: string, c: string, v: readonly string[]) => L.porCampo!<X>(e, c, v),
      versaoLinhas: () => 1,
    };
    esquecerMemoriaLocal();
    esquecerVeiculosRecentes();
    const anoAtual = 2026;
    const entrada = { perfil: 'vendedor' as const, parametros: {}, agora: AGORA, clienteId: null as string | null, fuso: 'America/Manaus' };

    // a montagem do índice (uma vez por lista de produtos montada): é o custo da primeira abertura da folha Veículo
    let t = performance.now();
    const raiz = await cascataLocal(leitor, {}, anoAtual);
    const msIndice = performance.now() - t;
    expect(raiz.disponivel).toBe(true);
    expect(raiz.nivel).toBe('montadora');

    // lista com veículo (o índice já está montado)
    const veiculos: VeiculoEscolhido[] = MODELOS.slice(0, 10).map(([montadora, modelo], i) => ({ montadora, modelo, ano: 2005 + i, motor: null, versao: null }));
    const lista: number[] = [];
    let total = 0;
    for (const volta of [0, 1])
      for (const v of veiculos) {
        t = performance.now();
        const r = await listaComVeiculo(leitor, { ...entrada, q: '', veiculo: v, offline: true });
        if (volta > 0) lista.push(performance.now() - t);
        total += r.total;
        expect(r.items.length).toBeGreaterThan(0);
        expect(r.items.every((i) => !('veiculo' in i))).toBe(true);
      }
    expect(total).toBeGreaterThan(0);

    // troca de nível da cascata (índice montado): montadora → modelo → ano → motor
    const niveis: number[] = [];
    for (const [montadora, modelo] of MODELOS.slice(0, 10)) {
      for (const escolha of [{ montadora }, { montadora, modelo }, { montadora, modelo, ano: 2012 }, { montadora, modelo, ano: 2012, motor: '1.0' }]) {
        t = performance.now();
        await cascataLocal(leitor, { escolha }, anoAtual);
        niveis.push(performance.now() - t);
      }
    }
    // na suíte (turbo em paralelo, runner lento) o tempo oscila: o teto absoluto ganha folga de 3x; a meta estrita é a do desenho
    const folga = ESTRITO ? 1 : 3;
    const pLista = p95(lista);
    const pNivel = p95(niveis);
    console.log(`[desempenho RN-CAT-22] carga ${(msCarga / 1000).toFixed(1)} s; índice de veículos ${msIndice.toFixed(0)} ms; lista com veículo p95 ${pLista.toFixed(0)} ms; troca de nível p95 ${pNivel.toFixed(0)} ms`);
    expect(pLista).toBeLessThan(300 * FATOR * folga);
    expect(pNivel).toBeLessThan(100 * FATOR * folga);
  });
});
