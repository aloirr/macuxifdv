/**
 * T-0192 (RN-CAT-21): a primeira página da aba Catálogo, sem busca, com 20 mil produtos, 80 mil preços e 40 mil saldos em SQLite real.
 * Limite: a primeira página (a partida a frio, que lê e monta os produtos) em até 1.000 ms e a seguinte ("Mostrar mais", ordem guardada) em até 250 ms
 * em node (medidos no PC: ver a saída do teste). O teto vale como trava de regressão; `MACUXI_FATOR_DESEMPENHO` folga o tempo em CI compartilhado.
 */
import { criarArmazenamentoSqlite, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { describe, expect, it } from 'vitest';
import { entidadesSyncCatalogo } from '../../../tests/modulos/apoio/entidades-catalogo';
import { migracoesAparelho } from '../db/aparelho';
import { esquecerMemoriaLocal, vitrineLocal, type LeitorLocal } from './lib/local';

const AGORA = '2026-11-21T12:00:00.000Z'; // hora-fixa-ok: instante da vitrine medida
const base = { updated_at: '2026-11-01T00:00:00.000000Z', deleted_at: null, external_id: null };
const uuid = (p: string, n: number) => `${p}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const N_PRODUTOS = 20_000;
const FILIAL = uuid('f', 1);
const DEPOSITO = uuid('d', 1);
const TABELAS = [uuid('a', 1), uuid('a', 2), uuid('a', 3), uuid('a', 4)];
const CLIENTE = uuid('c', 1);
const FATOR = Math.max(1, Number(process.env.MACUXI_FATOR_DESEMPENHO ?? 1));
const LIMITE_PRIMEIRA_PAGINA_MS = 1000 * FATOR;
const LIMITE_PAGINA_SEGUINTE_MS = 250 * FATOR;

type Linha = Record<string, unknown> & LinhaSync;
function gerar() {
  const produto: Linha[] = [];
  const tabela_preco_item: Linha[] = [];
  const estoque_saldo: Linha[] = [];
  for (let k = 0; k < N_PRODUTOS; k++) {
    const id = uuid('0', k);
    produto.push({ id, ...base, sku: `P${100000 + k}`, ean: null, nome: `Peça ${String(k * 7919 % N_PRODUTOS).padStart(5, '0')}`, marca: `Marca ${k % 30}`, categoria: `Linha ${k % 12}`, unidade: 'UN', ativo: true } as Linha);
    for (const [t, tabela] of TABELAS.entries()) tabela_preco_item.push({ id: uuid('1', k * 4 + t), ...base, tabela_preco_id: tabela, produto_id: id, filial_id: FILIAL, preco_cents: 1000 + t * 100 + (k % 50), vigencia_inicio: null, vigencia_fim: null } as Linha);
    for (let s = 0; s < 2; s++) estoque_saldo.push({ id: uuid('2', k * 2 + s), ...base, produto_id: id, deposito_id: DEPOSITO, quantidade: k % 3 === 0 ? 0 : k % 40, atualizado_em: AGORA } as Linha);
  }
  return {
    produto,
    tabela_preco_item,
    estoque_saldo,
    filial: [{ id: FILIAL, ...base, codigo: 'F1', nome: 'Matriz', ativo: true, padrao: true } as Linha],
    deposito: [{ id: DEPOSITO, ...base, codigo: 'D1', nome: 'CD', ativo: true, filial_id: FILIAL } as Linha],
    tabela_preco: TABELAS.map((id, i) => ({ id, ...base, codigo: `T${i}`, nome: `Tabela ${i}`, ativo: true }) as Linha),
    cliente_tabela_preco: [{ id: uuid('3', 1), ...base, cliente_id: CLIENTE, tabela_preco_id: TABELAS[1] } as Linha],
  };
}

describe('RN-CAT-21: primeira página da vitrine com 20 mil produtos (T-0192)', { timeout: 300_000 }, () => {
  it(`RN-CAT-21: a primeira página sai em até ${LIMITE_PRIMEIRA_PAGINA_MS} ms e a seguinte em até ${LIMITE_PAGINA_SEGUINTE_MS} ms, com o preço da tabela certa (RN-VEN-01)`, async () => {
    const dados = gerar();
    expect(dados.tabela_preco_item).toHaveLength(80_000);
    expect(dados.estoque_saldo).toHaveLength(40_000);
    const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: { catalogo: migracoesAparelho },
      entidades: [{ nome: 'produto', modulo: 'core' }, { nome: 'filial', modulo: 'core' }, ...entidadesSyncCatalogo()],
      agora: () => new Date(AGORA),
    });
    for (const [nome, linhas] of Object.entries(dados)) for (let k = 0; k < linhas.length; k += 1000) await armazenamento.linhas.aplicar(nome, linhas.slice(k, k + 1000), `k${k}`);
    const L = armazenamento.linhas;
    const leitor: LeitorLocal = {
      linhas: async <X extends LinhaSync>(e: string) => L.listar<X>(e),
      linhasPorIds: async <X extends LinhaSync>(e: string, ids: readonly string[]) => L.porIds<X>(e, ids),
      linhasPorCampo: async <X extends LinhaSync>(e: string, c: string, v: readonly string[]) => L.porCampo!<X>(e, c, v),
      versaoLinhas: () => 1,
    };
    const entrada = { perfil: 'vendedor' as const, parametros: {}, agora: AGORA, clienteId: null as string | null };
    const medir = async (e: typeof entrada, limit: number, offset: number) => {
      const t = performance.now();
      const r = await vitrineLocal(leitor, { ...e, limit, offset });
      return { r, ms: performance.now() - t };
    };

    for (const [rotulo, e, tabela] of [['sem cliente (filial padrão)', entrada, TABELAS[0]!], ['pela ficha do cliente', { ...entrada, clienteId: CLIENTE }, TABELAS[1]!]] as const) {
      esquecerMemoriaLocal();
      const primeira = await medir(e, 20, 0);
      const seguinte = await medir(e, 40, 0);
      console.log(`[T-0192] ${rotulo}: primeira página ${primeira.ms.toFixed(0)} ms, "Mostrar mais" ${seguinte.ms.toFixed(0)} ms`);
      expect(primeira.r.items).toHaveLength(20);
      expect(primeira.r.total).toBe(500); // teto de candidatos da vitrine (LIMITE_RESULTADOS_BUSCA)
      expect(seguinte.r.items.slice(0, 20).map((i) => i.id)).toEqual(primeira.r.items.map((i) => i.id));
      // quem tem estoque vem antes (RN-CAT-08) e o preço é o da tabela certa
      expect(primeira.r.items.every((i) => (i.availability?.quantity ?? 0) > 0)).toBe(true);
      const id0 = primeira.r.items[0]!.id;
      const k = Number(id0.slice(-12));
      const indice = TABELAS.indexOf(tabela);
      expect(primeira.r.items[0]!.price?.price_cents).toBe(1000 + indice * 100 + (k % 50));
      expect(primeira.ms).toBeLessThan(LIMITE_PRIMEIRA_PAGINA_MS);
      expect(seguinte.ms).toBeLessThan(LIMITE_PAGINA_SEGUINTE_MS);
    }
  });
});
