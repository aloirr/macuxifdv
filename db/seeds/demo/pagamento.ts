/**
 * Base de DEMONSTRAÇÃO — formas de pagamento e prazos, prazo médio do cliente e tabela escalonada (migração 0037, T-0089;
 * RN-VEN-23, RN-VEN-24, RN-VEN-25; desenho docs/desenho/T-0089.md §7, B4). Dono: banco-dados. Arquivo próprio: o demo.ts
 * chama `gravarDemoPagamento(admin, { tenantId, hoje, dados })` na MESMA transação do carregarDemo, depois do laço
 * (core.cliente e core.produto já gravados).
 *
 * - 4 formas com prazos (codigo único no tenant; descrição só com o prazo, sem o médio — RN-VEN-24, complemento das 6h59):
 *   Pix e Dinheiro à vista ([0]); Cartão 30 e 30/60; Boleto 28, 28/56 e 30/60/90. Prazo médio = média das parcelas
 *   arredondada para cima (§8 P2): 0, 0, 30, 45, 28, 42 e 60. A conta aqui é a da regra (o domain do Vendedor ganha o
 *   prazoMedioDias na T-0089 V2; o teste do seed confere os números).
 * - A forma "À vista" que a 0037 semeia em todo tenant (codigo AVISTA, P7) é APAGADA (soft delete) na demo: a demo mostra
 *   as 4 formas do roteiro. Pedido do ensaio que usou a forma padrão continua válido (a linha fica, com deleted_at).
 * - Prazo médio máximo (RN-VEN-25): 45 dias em todos os clientes, menos a Panificadora Pão Dourado (30 dias), para aparecer
 *   prazo desabilitado (com 45: Boleto 30/60/90 desabilitado; com 30: também Cartão 30/60 e Boleto 28/56). Formas permitidas:
 *   todas (nulo, §8 P1), menos a Conveniência Rota 10 (só Pix, Dinheiro e Cartão: sem boleto).
 * - Tabela escalonada (RN-VEN-23) no biscoito cream cracker BIS-400 (UN R$ 5,89 no Varejo, CX c/ 20): 50 UN a R$ 5,69,
 *   10 CX a R$ 5,49 por UN e 20 CX a R$ 5,29 por UN; todas as tabelas, vigentes desde o 1º dia do mês anterior, sem fim.
 * - Título vencido: já vem do demo.ts (8 clientes com o 1º título vencido há 10 a 14 dias, a Mercearia do Porto há 45 e
 *   bloqueada) — RN-VEN-13 com o titulo_vencido_dias padrão (5).
 * - As 4 condições antigas (vendedor.condicao_pagamento e cliente_condicao) continuam no demo.ts, para o APK antigo.
 *
 * Idempotente (upsert por id determinístico; o cliente é regravado por UPDATE). Forma ou prazo do ensaio (BKO) com o MESMO
 * código e outro id = o seed pula o dele (respeita o ensaio, como as metas). Banco sem a 0037 = nada a fazer. Só tenant
 * demo; só Postgres local ou servidor da demo (exigirBancoDemo).
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO do demo.ts é importado.
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { anoMes } from '../../src/datas';
import { arrayDeInteiros, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeChave, idDeterministico } from '../../src/ids';
import type { DadosDemo } from './demo';

const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** Formas e prazos da demo (T-0089 B4), na ordem da lista do app. */
export const FORMAS_DEMO: ReadonlyArray<{ codigo: string; nome: string; prazos: ReadonlyArray<{ codigo: string; parcelas: readonly number[] }> }> = [
  { codigo: 'PIX', nome: 'Pix', prazos: [{ codigo: 'PIX-AV', parcelas: [0] }] },
  { codigo: 'DINHEIRO', nome: 'Dinheiro', prazos: [{ codigo: 'DIN-AV', parcelas: [0] }] },
  { codigo: 'CARTAO', nome: 'Cartão', prazos: [{ codigo: 'CAR-30', parcelas: [30] }, { codigo: 'CAR-30-60', parcelas: [30, 60] }] },
  {
    codigo: 'BOLETO',
    nome: 'Boleto',
    prazos: [{ codigo: 'BOL-28', parcelas: [28] }, { codigo: 'BOL-28-56', parcelas: [28, 56] }, { codigo: 'BOL-30-60-90', parcelas: [30, 60, 90] }],
  },
];
/** Prazo médio máximo da maioria dos clientes (RN-VEN-25). */
export const PRAZO_MEDIO_MAX_DEMO = 45;
/** Cliente (índice do demo.ts) com prazo médio máximo menor: Panificadora Pão Dourado, 30 dias. */
export const CLIENTE_PRAZO_30_DEMO = 2;
/** Cliente (índice) com formas restritas: Conveniência Rota 10, sem boleto. */
export const CLIENTE_SEM_BOLETO_DEMO = 3;
export const FORMAS_SEM_BOLETO_DEMO = ['PIX', 'DINHEIRO', 'CARTAO'] as const;
/** Faixas escalonadas da demo: [sku, medida (nulo = unidade base), quantidade mínima, preço por UNIDADE BASE em centavos]. */
export const FAIXAS_DEMO: ReadonlyArray<readonly [string, string | null, number, number]> = [
  ['BIS-400', null, 50, 569],
  ['BIS-400', 'CX', 10, 549],
  ['BIS-400', 'CX', 20, 529],
];

/** Média das parcelas arredondada para cima (RN-VEN-24, §8 P2): 28/56 = 42; [0] = 0. */
export const prazoMedioDemo = (parcelas: readonly number[]) => Math.ceil(parcelas.reduce((s, x) => s + x, 0) / parcelas.length);
/** "28/56 dias"; [0] = "À vista" (sem o prazo médio no texto). */
export const descricaoPrazoDemo = (parcelas: readonly number[]) => (parcelas.length === 1 && parcelas[0] === 0 ? 'À vista' : `${parcelas.join('/')} dias`);
export const idFormaDemo = (codigo: string) => id(`forma_pagamento:${codigo}`);
export const idPrazoDemo = (codigo: string) => id(`prazo_pagamento:${codigo}`);
/** Ids da forma e do prazo "À vista" que a 0037 semeia em todo tenant (gêmeos da vendedor.semear_pagamento). */
export const idsPagamentoPadrao = (tenantId: string) => ({
  forma: idDeChave(`${tenantId}:vendedor.forma_pagamento:AVISTA`),
  prazo: idDeChave(`${tenantId}:vendedor.prazo_pagamento:AVISTA`),
});

export interface ClientePagamentoDemo {
  id: string;
  prazo_medio_max_dias: number;
  formas_pagamento: string[] | null;
}
export interface DadosDemoPagamento {
  formas: Linha[];
  prazos: Linha[];
  faixas: Linha[];
  clientes: ClientePagamentoDemo[];
}

/** Função pura: o que este seed grava, a partir das linhas do demo.ts. */
export function dadosDemoPagamento(p: { tenantId: string; hoje: string; dados: Pick<DadosDemo, 'core.cliente' | 'core.produto'> }): DadosDemoPagamento {
  const T = p.tenantId;
  const formas: Linha[] = FORMAS_DEMO.map((f, i) => ({ id: idFormaDemo(f.codigo), tenant_id: T, codigo: f.codigo, nome: f.nome, ativo: true, ordem: i + 1, ...comuns }));
  const prazos: Linha[] = FORMAS_DEMO.flatMap((f) =>
    f.prazos.map((z, i) => ({
      id: idPrazoDemo(z.codigo), tenant_id: T, forma_pagamento_id: idFormaDemo(f.codigo), codigo: z.codigo, descricao: descricaoPrazoDemo(z.parcelas),
      parcelas_dias: arrayDeInteiros(z.parcelas), prazo_medio_dias: prazoMedioDemo(z.parcelas), ativo: true, ordem: i + 1, ...comuns,
    })),
  );
  const produto = new Map(p.dados['core.produto'].map((x) => [String(x.sku), String(x.id)]));
  const inicio = `${anoMes(p.hoje, -1)}-01`;
  const faixas: Linha[] = FAIXAS_DEMO.map(([sku, medida, qtd, preco]) => {
    const produto_id = produto.get(sku);
    if (!produto_id) throw new Error(`[db] seed demo: faixa escalonada de produto fora da base (${sku})`);
    return {
      id: id(`tabela_escalonada:${sku}:${medida ?? 'base'}:${qtd}`), tenant_id: T, produto_id, medida, quantidade_minima: qtd, preco_unidade_cents: preco,
      vigencia_inicio: inicio, vigencia_fim: null, tabela_preco_id: null, ativo: true, ...comuns,
    };
  });
  const clientes: ClientePagamentoDemo[] = p.dados['core.cliente'].map((c, n) => ({
    id: String(c.id),
    prazo_medio_max_dias: n === CLIENTE_PRAZO_30_DEMO ? 30 : PRAZO_MEDIO_MAX_DEMO,
    formas_pagamento: n === CLIENTE_SEM_BOLETO_DEMO ? [...FORMAS_SEM_BOLETO_DEMO] : null,
  }));
  return { formas, prazos, faixas, clientes };
}

/**
 * Grava formas, prazos, faixas e o pagamento dos clientes da demo (dentro da transação do carregarDemo) e apaga (soft
 * delete) a forma e o prazo "À vista" semeados pela 0037. Devolve quantas linhas gravou (0 = banco sem a 0037).
 */
export async function gravarDemoPagamento(admin: ClientBase, p: { tenantId: string; hoje: string; dados: Pick<DadosDemo, 'core.cliente' | 'core.produto'> }): Promise<number> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed das formas de pagamento da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('vendedor.prazo_pagamento') is not null and to_regclass('catalogo.tabela_escalonada') is not null as ok");
  if (!existe.rows[0]?.ok) return 0;
  const d = dadosDemoPagamento(p);
  const T = p.tenantId;
  // código já usado por outra linha viva (cadastrada no ensaio): o seed pula a dele e os prazos dela
  const ocupados = async (tabela: 'vendedor.forma_pagamento' | 'vendedor.prazo_pagamento', linhas: Linha[]) =>
    new Set(
      (
        await admin.query<{ codigo: string }>(`select codigo from ${tabela} where tenant_id = $1 and deleted_at is null and id <> all($2::uuid[])`, [
          T,
          linhas.map((l) => l.id),
        ])
      ).rows.map((r) => r.codigo),
    );
  const formasOcupadas = await ocupados('vendedor.forma_pagamento', d.formas);
  const formas = d.formas.filter((f) => !formasOcupadas.has(String(f.codigo)));
  const formasGravadas = new Set(formas.map((f) => String(f.id)));
  const prazosOcupados = await ocupados('vendedor.prazo_pagamento', d.prazos);
  const prazos = d.prazos.filter((z) => formasGravadas.has(String(z.forma_pagamento_id)) && !prazosOcupados.has(String(z.codigo)));
  let n = 0;
  n += await gravarLinhas(admin, 'vendedor.forma_pagamento', formas);
  n += await gravarLinhas(admin, 'vendedor.prazo_pagamento', prazos);
  n += await gravarLinhas(admin, 'catalogo.tabela_escalonada', d.faixas);
  const padrao = idsPagamentoPadrao(T);
  await admin.query('update vendedor.prazo_pagamento set deleted_at = now() where tenant_id = $1 and id = $2 and deleted_at is null', [T, padrao.prazo]);
  await admin.query('update vendedor.forma_pagamento set deleted_at = now() where tenant_id = $1 and id = $2 and deleted_at is null', [T, padrao.forma]);
  for (const c of d.clientes) {
    const r = await admin.query('update core.cliente set prazo_medio_max_dias = $3, formas_pagamento = $4::text[] where tenant_id = $1 and id = $2', [
      T,
      c.id,
      c.prazo_medio_max_dias,
      c.formas_pagamento,
    ]);
    n += r.rowCount ?? 0;
  }
  return n;
}
