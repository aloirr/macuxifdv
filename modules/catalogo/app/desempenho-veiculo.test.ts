/**
 * RN-CAT-22 (desenho `docs/desenho/filtro-veiculo.md` §7, critério 9): 20 mil produtos com aplicação em texto, SQLite real. A lista filtrada por
 * veículo (`listaComVeiculo`, a do Catálogo) sai em até 300 ms (p95 sobre vários veículos, com o índice de veículos já montado) e a troca de nível
 * da cascata em até 100 ms. Decisão 129 A (R-20261128-054900): na suíte e no CI vale o teto próprio deste teste, a razão a uma referência medida antes e
 * depois de cada amostra (folga para o runner compartilhado, como em `desempenho-vitrine.test.ts`); o teto de 900 ms vale no aparelho, no roteiro do testes.
 * Em `MACUXI_DESEMPENHO=1` (máquina dedicada) valem também os tetos do desenho em relógio de parede (`MACUXI_FATOR_DESEMPENHO` dá folga). A montagem do índice é medida pela RAZÃO à montagem da lista de produtos do aparelho; a montagem cede o laço (não trava a tela) e `catalogo.veiculos@1` espera por ela.
 */
import { criarArmazenamentoSqlite, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { describe, expect, it } from 'vitest';
import { entidadesSyncCatalogo } from '../../../tests/modulos/apoio/entidades-catalogo';
import { migracoesAparelho } from '../db/aparelho';
import type { VeiculoEscolhido } from '../contracts';
import { esquecerMemoriaLocal, produtosLocais, type LeitorLocal } from './lib/local';
import { cascataLocal, esquecerVeiculosRecentes, listaComVeiculo } from './veiculos-consulta';

const AGORA = '2026-11-21T12:00:00.000Z'; // hora-fixa-ok: instante do catálogo medido
const base = { updated_at: '2026-11-01T00:00:00.000000Z', deleted_at: null, external_id: null };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const N_PRODUTOS = 20_000;
const FATOR = Math.max(1, Number(process.env.MACUXI_FATOR_DESEMPENHO ?? 1));
const ESTRITO = process.env.MACUXI_DESEMPENHO === '1';
// razões medidas (log desta suíte: índice 2,0x a lista de produtos, maior pausa ~0,15x a montagem), com folga de ~3x para o runner lento
const RAZAO_INDICE = 6;
// tetos do desenho em referências intercaladas (a leitura crua de 20 mil produtos gasta ~25 ms sozinha nesta máquina): 300 ms = 12 e 100 ms = 4. Medido:
// lista 4 a 5,3 referências e troca de nível 0,2 a 0,26, sozinho e com 6 processos de carga em 4 núcleos (o relógio de parede dobrou e a razão ficou igual)
const RAZAO_LISTA_REF = 12;
const RAZAO_NIVEL_REF = 4;
const RAZAO_PAUSA = 0.5;

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

    // referência: a montagem da lista de produtos do aparelho (a passada que a carga já faz hoje)
    let t = performance.now();
    await produtosLocais(leitor, { lerConcorrente: false });
    const msProdutos = performance.now() - t;
    t = performance.now();
    let maiorPausa = 0;
    let ultimo = t;
    const batida = setInterval(() => {
      const agora = performance.now();
      maiorPausa = Math.max(maiorPausa, agora - ultimo);
      ultimo = agora;
    }, 1);
    const raiz = await cascataLocal(leitor, {}, anoAtual); // espera a montagem (a folha só abre com o botão, já pronto)
    clearInterval(batida);
    const msIndice = performance.now() - t;
    expect(raiz.disponivel).toBe(true);
    expect(raiz.nivel).toBe('montadora');

    // referência intercalada: a leitura crua das 20 mil linhas de produto do SQLite (sem cache; o mesmo tipo de trabalho, SQLite + objetos JS, no mesmo
    // processo), medida antes e depois de cada amostra; a carga da máquina no instante da amostra estica a amostra e a referência juntas
    const referencia = async () => {
      const r = performance.now();
      await L.listar('produto');
      return performance.now() - r;
    };
    let refAntes = await referencia();
    const medir = async (fazer: () => Promise<unknown>) => {
      const r = performance.now();
      await fazer();
      const ms = performance.now() - r;
      const refDepois = await referencia();
      const razao = ms / ((refAntes + refDepois) / 2);
      refAntes = refDepois;
      return { ms, razao };
    };

    // lista com veículo (o índice já está montado)
    const veiculos: VeiculoEscolhido[] = MODELOS.slice(0, 10).map(([montadora, modelo], i) => ({ montadora, modelo, ano: 2005 + i, motor: null, versao: null }));
    const lista: number[] = [];
    const razoesLista: number[] = [];
    let total = 0;
    // medição só da função do produto (`listaComVeiculo`; a carga e os dados ficam fora do cronômetro): a volta 0 aquece (JIT, caches do SQLite, memória) e é
    // descartada; as 4 seguintes dão 40 amostras, então o p95 é a 3ª maior e uma pausa isolada de coleta de lixo no runner compartilhado não decide o teste
    for (const volta of [0, 1, 2, 3, 4])
      for (const v of veiculos) {
        let r: Awaited<ReturnType<typeof listaComVeiculo>> | undefined;
        const m = await medir(async () => { r = await listaComVeiculo(leitor, { ...entrada, q: '', veiculo: v, offline: true }); });
        if (volta > 0) { lista.push(m.ms); razoesLista.push(m.razao); }
        total += r!.total;
        expect(r!.items.length).toBeGreaterThan(0);
        expect(r!.items.every((i) => !('veiculo' in i))).toBe(true);
      }
    expect(total).toBeGreaterThan(0);

    // troca de nível da cascata (índice montado): montadora → modelo → ano → motor
    const niveis: number[] = [];
    const razoesNivel: number[] = [];
    for (const [montadora, modelo] of MODELOS.slice(0, 10)) {
      for (const escolha of [{ montadora }, { montadora, modelo }, { montadora, modelo, ano: 2012 }, { montadora, modelo, ano: 2012, motor: '1.0' }]) {
        const m = await medir(() => cascataLocal(leitor, { escolha }, anoAtual));
        niveis.push(m.ms);
        razoesNivel.push(m.razao);
      }
    }
    const pLista = p95(lista);
    const pNivel = p95(niveis);
    const rLista = p95(razoesLista);
    const rNivel = p95(razoesNivel);
    console.log(`[desempenho RN-CAT-22] carga ${(msCarga / 1000).toFixed(1)} s; lista de produtos ${msProdutos.toFixed(0)} ms; índice de veículos ${msIndice.toFixed(0)} ms (razão à lista de produtos ${(msIndice / msProdutos).toFixed(2)}), maior pausa do laço ${maiorPausa.toFixed(0)} ms; lista com veículo p95 ${pLista.toFixed(0)} ms (razão à referência p95 ${rLista.toFixed(2)}); troca de nível p95 ${pNivel.toFixed(0)} ms (razão à referência p95 ${rNivel.toFixed(3)}); referência ${refAntes.toFixed(0)} ms`);
    // decisão 129 A: relógio de parede só em ESTRITO; na suíte o relógio oscila até 20x (SHA 0af3a23: 1784 ms; sozinho, 88 ms) e vale a razão à referência
    if (ESTRITO) {
      expect(pLista).toBeLessThan(300 * FATOR);
      expect(pNivel).toBeLessThan(100 * FATOR);
    }
    expect(rLista).toBeLessThan(RAZAO_LISTA_REF);
    expect(rNivel).toBeLessThan(RAZAO_NIVEL_REF);
    // pela razão à referência (a lista de produtos montada, para o índice e para a lista): o runner lento estica os dois lados juntos
    expect(msIndice).toBeLessThan(RAZAO_INDICE * msProdutos);
    // a montagem cede o laço: nenhuma pausa passa de uma fração da montagem inteira
    expect(maiorPausa).toBeLessThan(RAZAO_PAUSA * msIndice);
  });
});
