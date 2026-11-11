/**
 * T-0149 v1.0.4 — RN-VEN-20 na API: a recusa por estoque da FILIAL do pedido, sem banco (local e CI), pela cadeia real
 *   Vendedor (`faltaDeEstoqueNaFilial` + `provedorDaTransacao`) → `catalogo.estoque_filial@1` (`consultaEstoqueFilial`) → domínio do Catálogo,
 * com um `ClienteBanco` falso que devolve as linhas da seed da demo e guarda o SQL e os parâmetros. O SQL real (RLS, gatilho da 0061,
 * status que reservam) roda no CI em modules/vendedor/api/*.db.test.ts e modules/catalogo/api/estoque-filial.test.ts.
 *
 *   RS-1 limite exato: disponível = saldo da filial − reservas da mesma filial; pedido = disponível passa, disponível + 1 recusa;
 *   RS-2 unidade base (quantidade × fator da embalagem) e o mesmo produto em 2 linhas soma;
 *   RS-3 reservas: só da filial do pedido, dos status que reservam, sem contar o próprio pedido (reenvio idempotente);
 *   RS-4 fallback seguro: sem filial, sem provedor, Catálogo desligado (ConsultaIndisponivel) → não recusa; erro de verdade sobe;
 *   RS-5 a recusa no recebimento: só no pedido (orçamento nunca), código RN-VEN-20 e o texto da ação;
 *   RS-6 app × API (valor × regra): o que o app mostra como sem estoque na filial, a API recusa — e vice-versa.
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto com recado ao dono (o agente testes volta para `it` na correção).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSULTA_ESTOQUE_FILIAL } from '@macuxi/catalogo/contracts';
import { ConsultaIndisponivel, type ClienteBanco, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { consultaEstoqueFilial } from '../../modules/catalogo/api/estoque-filial';
import { faltaDeEstoqueNaFilial, provedorDaTransacao } from '../../modules/vendedor/api/estoque-filial';
import { saldoPorProduto } from '../../modules/vendedor/app/lib/pull';
import { reservadoLocalNaFilial, STATUS_QUE_RESERVAM } from '../../modules/vendedor/domain/reserva-filial';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const F_MAO = 'a1000000-0000-4000-8000-000000000001';
const F_BVB = 'a1000000-0000-4000-8000-000000000002';
const F_NOVA = 'a1000000-0000-4000-8000-000000000003'; // filial cadastrada sem depósito ainda
const D_MAO = 'd1000000-0000-4000-8000-000000000001';
const D_LOJA = 'd1000000-0000-4000-8000-000000000002'; // 2º depósito da Manaus (Loja Centro)
const D_BVB = 'd1000000-0000-4000-8000-000000000003';
const ACU = 'b1000000-0000-4000-8000-000000000001';
const CAF = 'b1000000-0000-4000-8000-000000000002'; // CAF-500: saldo na Manaus, ZERADO na Boa Vista (seed da demo)
const AGU = 'b1000000-0000-4000-8000-000000000003'; // não controlado (sem linha de saldo)
const SO_MAO = 'b1000000-0000-4000-8000-000000000004'; // só tem linha na Manaus (o ERP não manda linha zerada da Boa Vista)
const PEDIDO = 'c1000000-0000-4000-8000-000000000001';

const DEPOSITOS = [
  { id: D_MAO, filial_id: F_MAO },
  { id: D_LOJA, filial_id: F_MAO },
  { id: D_BVB, filial_id: F_BVB },
];
/** Seed da demo (R-20261110-202456-banco-dados): CD-BVB = floor(CD-MAO × 0,6); CAF-500 zerado na Boa Vista. */
const SALDOS = [
  { deposito_id: D_MAO, produto_id: ACU, quantidade: 37 },
  { deposito_id: D_LOJA, produto_id: ACU, quantidade: 5 },
  { deposito_id: D_BVB, produto_id: ACU, quantidade: Math.floor(37 * 0.6) },
  { deposito_id: D_MAO, produto_id: CAF, quantidade: 30 },
  { deposito_id: D_BVB, produto_id: CAF, quantidade: 0 },
  { deposito_id: D_MAO, produto_id: SO_MAO, quantidade: 12 },
];

interface Chamada {
  sql: string;
  valores: readonly unknown[];
}

/** Banco falso: depósitos e saldos do Catálogo; reservas do Vendedor por filial (como o SQL agrupa). */
function bancoFalso(reservas: Record<string, Record<string, number>> = {}) {
  const chamadas: Chamada[] = [];
  const db: ClienteBanco = {
    async query<R>(sql: string, valores: readonly unknown[] = []) {
      chamadas.push({ sql, valores });
      let rows: unknown[] = [];
      if (/from catalogo\.deposito/.test(sql)) rows = DEPOSITOS;
      else if (/from catalogo\.estoque_saldo/.test(sql)) {
        const [produtos, deps] = valores as [string[], string[] | undefined];
        rows = SALDOS.filter((s) => produtos.includes(s.produto_id) && (!deps || deps.includes(s.deposito_id)));
      } else if (/from vendedor\.pedido_item/.test(sql)) {
        const [produtos, filial] = valores as [string[], string];
        rows = Object.entries(reservas[filial] ?? {})
          .filter(([p]) => produtos.includes(p))
          .map(([produto_id, q]) => ({ produto_id, reservado: String(q) }));
      }
      return { rows: rows as R[], rowCount: rows.length };
    },
  };
  return { db, chamadas };
}

/** `tx.consultar` que executa a implementação real do Catálogo (`catalogo.estoque_filial@1`), validando entrada e saída pelo contrato. */
function txComCatalogo(db: ClienteBanco): Pick<TransacaoTenant, 'consultar'> {
  const impl = consultaEstoqueFilial as unknown as { executar: (e: unknown, ctx: { db: ClienteBanco }) => Promise<unknown> };
  return {
    consultar: (async (def: { nome: string }, entrada: unknown) => {
      expect(def.nome).toBe('catalogo.estoque_filial@1');
      const e = CONSULTA_ESTOQUE_FILIAL.entrada.parse(entrada);
      return CONSULTA_ESTOQUE_FILIAL.saida.parse(await impl.executar(e, { db }));
    }) as unknown as TransacaoTenant['consultar'],
  };
}

async function falta(itens: { produto_id: string; quantidade_base: number }[], filial: string | null, reservas: Record<string, Record<string, number>> = {}) {
  const b = bancoFalso(reservas);
  const r = await faltaDeEstoqueNaFilial(b.db, provedorDaTransacao(txComCatalogo(b.db)), itens, filial, PEDIDO);
  return { r, chamadas: b.chamadas };
}

describe('T-0149 RS-1 — RN-VEN-20: limite exato do disponível da filial', () => {
  it('RS-1: Boa Vista 22 − reserva 4 = 18 → pedido de 18 passa; 19 recusa com pedido_base 19 e disponível 18', async () => {
    const res = { [F_BVB]: { [ACU]: 4 } };
    expect((await falta([{ produto_id: ACU, quantidade_base: 18 }], F_BVB, res)).r).toEqual([]);
    expect((await falta([{ produto_id: ACU, quantidade_base: 19 }], F_BVB, res)).r).toEqual([{ produto_id: ACU, pedido_base: 19, disponivel_base: 18 }]);
  });

  it('RS-1: Manaus soma os 2 depósitos (37 + 5 = 42); 42 passa, 43 recusa', async () => {
    expect((await falta([{ produto_id: ACU, quantidade_base: 42 }], F_MAO)).r).toEqual([]);
    expect((await falta([{ produto_id: ACU, quantidade_base: 43 }], F_MAO)).r).toEqual([{ produto_id: ACU, pedido_base: 43, disponivel_base: 42 }]);
  });

  it('RS-1: estoque zero (CAF-500 na Boa Vista) → 1 unidade recusa, nunca usa o saldo da Manaus; reserva acima do saldo = disponível 0', async () => {
    expect((await falta([{ produto_id: CAF, quantidade_base: 1 }], F_BVB)).r).toEqual([{ produto_id: CAF, pedido_base: 1, disponivel_base: 0 }]);
    expect((await falta([{ produto_id: ACU, quantidade_base: 1 }], F_BVB, { [F_BVB]: { [ACU]: 99 } })).r).toEqual([{ produto_id: ACU, pedido_base: 1, disponivel_base: 0 }]);
  });

  it('RS-1: produto não controlado (sem linha de saldo em depósito nenhum) nunca recusa', async () => {
    expect((await falta([{ produto_id: AGU, quantidade_base: 1_000 }], F_BVB)).r).toEqual([]);
  });
});

describe('T-0149 RS-2 — unidade base e linhas repetidas', () => {
  it('RS-2: o recebimento manda quantidade × fator da embalagem (FD c/ 10 → 10 na base)', () => {
    const receber = ler('modules/vendedor/api/receber.ts');
    expect(receber).toMatch(/faltaDeEstoqueNaFilial\(db, provedorSaldoDaFilial\(tx\), p\.items\.map\(\(i, idx\) => \(\{ produto_id: i\.product_id, quantidade_base: i\.quantity \* medidas\.get\(idx\)!\.fator \}\)\)/);
  });

  it('RS-2: o mesmo produto em 2 linhas soma (10 + 9 = 19 > 18 recusa; 10 + 8 passa)', async () => {
    const res = { [F_BVB]: { [ACU]: 4 } };
    expect((await falta([{ produto_id: ACU, quantidade_base: 10 }, { produto_id: ACU, quantidade_base: 8 }], F_BVB, res)).r).toEqual([]);
    expect((await falta([{ produto_id: ACU, quantidade_base: 10 }, { produto_id: ACU, quantidade_base: 9 }], F_BVB, res)).r).toEqual([{ produto_id: ACU, pedido_base: 19, disponivel_base: 18 }]);
  });
});

describe('T-0149 RS-3 — reservas: filial, status e reenvio', () => {
  it('RS-3: reserva da Manaus não mexe na Boa Vista (a consulta de reservas vai com a filial do pedido)', async () => {
    const { r, chamadas } = await falta([{ produto_id: ACU, quantidade_base: 22 }], F_BVB, { [F_MAO]: { [ACU]: 40 } });
    expect(r).toEqual([]);
    const reserva = chamadas.find((c) => /from vendedor\.pedido_item/.test(c.sql))!;
    expect(reserva.valores[1]).toBe(F_BVB);
    expect(reserva.sql).toMatch(/i\.filial_id = \$2/);
  });

  it('RS-3: reenvio idempotente — o próprio pedido não conta como reserva; só pedido (não orçamento) nos status que reservam', async () => {
    const { chamadas } = await falta([{ produto_id: ACU, quantidade_base: 1 }], F_BVB);
    const reserva = chamadas.find((c) => /from vendedor\.pedido_item/.test(c.sql))!;
    expect(reserva.sql).toMatch(/p\.id <> \$3/);
    expect(reserva.valores[2]).toBe(PEDIDO);
    expect(reserva.sql).toMatch(/p\.tipo = 'pedido'/);
    expect(reserva.valores[3]).toEqual([...STATUS_QUE_RESERVAM]);
    // RN-VEN-20: libera em cancelamento, rejeição e faturamento total
    for (const s of ['cancelled', 'rejected', 'invoiced', 'draft']) expect(STATUS_QUE_RESERVAM as readonly string[]).not.toContain(s);
    expect(reserva.sql).toMatch(/quantidade_base - i\.quantidade_faturada/); // faturado parcial libera o que já faturou
  });

  it('RS-3: o aparelho desconta as mesmas reservas (pedidos aceitos da mesma filial; faturado parcial libera o faturado)', () => {
    const m = reservadoLocalNaFilial(
      [
        { filial_id: F_BVB.toUpperCase(), tipo: 'pedido', status: 'approved', itens: [{ produto_id: ACU, quantidade_base: 4 }] },
        { filial_id: F_BVB, tipo: 'pedido', status: 'invoiced_partial', itens: [{ produto_id: ACU, quantidade_base: 6, quantidade_faturada: 5 }] },
        { filial_id: F_BVB, tipo: 'orcamento', status: 'received', itens: [{ produto_id: ACU, quantidade_base: 50 }] },
        { filial_id: F_BVB, tipo: 'pedido', status: 'rejected', itens: [{ produto_id: ACU, quantidade_base: 50 }] },
        { filial_id: F_MAO, tipo: 'pedido', status: 'approved', itens: [{ produto_id: ACU, quantidade_base: 50 }] },
      ],
      F_BVB,
    );
    expect(m.get(ACU)).toBe(5);
  });
});

describe('T-0149 RS-4 — fallback seguro', () => {
  it('RS-4: sem filial no pedido (pedido antigo) ou sem itens → não consulta nada e não recusa', async () => {
    const a = await falta([{ produto_id: CAF, quantidade_base: 1 }], null);
    expect(a.r).toEqual([]);
    expect(a.chamadas).toEqual([]);
    expect((await falta([], F_BVB)).r).toEqual([]);
  });

  it('RS-4: Catálogo desligado (ConsultaIndisponivel) → não recusa; erro de verdade do Catálogo sobe (não vira "tem estoque")', async () => {
    const b = bancoFalso();
    const indisponivel: Pick<TransacaoTenant, 'consultar'> = {
      consultar: (async () => {
        throw new ConsultaIndisponivel('catalogo.estoque_filial@1', 'catalogo');
      }) as unknown as TransacaoTenant['consultar'],
    };
    expect(await faltaDeEstoqueNaFilial(b.db, provedorDaTransacao(indisponivel), [{ produto_id: CAF, quantidade_base: 1 }], F_BVB, PEDIDO)).toEqual([]);
    const quebrado: Pick<TransacaoTenant, 'consultar'> = {
      consultar: (async () => {
        throw new Error('conexão perdida');
      }) as unknown as TransacaoTenant['consultar'],
    };
    await expect(faltaDeEstoqueNaFilial(b.db, provedorDaTransacao(quebrado), [{ produto_id: CAF, quantidade_base: 1 }], F_BVB, PEDIDO)).rejects.toThrow('conexão perdida');
  });

  it('RS-4: o contrato da consulta aceita de 1 a 200 produtos e não aceita campo a mais (tenant e perfil vêm da transação)', () => {
    expect(() => CONSULTA_ESTOQUE_FILIAL.entrada.parse({ produto_ids: [], filial_id: F_BVB })).toThrow();
    expect(() => CONSULTA_ESTOQUE_FILIAL.entrada.parse({ produto_ids: Array.from({ length: 201 }, () => ACU), filial_id: F_BVB })).toThrow();
    expect(() => CONSULTA_ESTOQUE_FILIAL.entrada.parse({ produto_ids: [ACU], filial_id: F_BVB, tenant_id: F_MAO })).toThrow();
    expect(CONSULTA_ESTOQUE_FILIAL.entrada.parse({ produto_ids: Array.from({ length: 200 }, () => ACU), filial_id: F_BVB }).produto_ids).toHaveLength(200);
  });
});

describe('T-0149 RS-5 — a recusa no recebimento', () => {
  it('RS-5: só o pedido confere estoque (orçamento nunca), a recusa usa o código RN-VEN-20 e diz a ação', () => {
    const receber = ler('modules/vendedor/api/receber.ts');
    const trecho = receber.slice(receber.indexOf('// RN-VEN-20 (T-0149)'), receber.indexOf('// RN-VEN-32'));
    expect(trecho).toMatch(/if \(tipo === 'pedido'\) \{/);
    expect(trecho).toMatch(/rejeitado\(itemId, 'RN-VEN-20', 'Sem estoque na filial para um dos itens\. Envie como orçamento ou reduza a quantidade\.'\)/);
    expect(trecho).toMatch(/retratoFilial\?\.filial_id \?\? null/); // a filial do pedido (retrato), não a do vendedor
  });

  it('RS-5: o provedor real está ligado (Vendedor usa e Catálogo oferece e registra catalogo.estoque_filial@1)', () => {
    expect(ler('modules/vendedor/manifest.ts')).toContain("'catalogo.estoque_filial@1'");
    expect(ler('modules/catalogo/manifest.ts')).toContain("'catalogo.estoque_filial@1'");
    expect(ler('modules/catalogo/api/index.ts')).toMatch(/consultas: \[[^\]]*consultaEstoqueFilial/);
    expect(ler('modules/vendedor/api/estoque-filial.ts')).toMatch(/provedorAtual \?\? provedorDaTransacao\(tx\)/);
  });
});

describe('T-0149 RS-6 — app × API: o mesmo "sem estoque na filial" (valor × regra)', () => {
  /** O que o app calcula (pull do Vendedor, `saldoPorProduto`) para a filial: saldo por produto, ausente = não controlado. */
  const doApp = (filial: string) => saldoPorProduto(SALDOS as never, DEPOSITOS as never, filial);
  /** O que a API recebe do Catálogo para a filial. */
  async function daApi(filial: string, produtos: string[]) {
    const b = bancoFalso();
    const r = await provedorDaTransacao(txComCatalogo(b.db))(produtos, filial);
    return r!;
  }

  it('RS-6: nos casos da seed (ACU com saldo, CAF-500 zerado na Boa Vista, AGU sem linha) app e API dão o mesmo saldo', async () => {
    const api = await daApi(F_BVB, [ACU, CAF, AGU]);
    const app = doApp(F_BVB);
    for (const p of [ACU, CAF, AGU]) expect(api.get(p)).toBe(app.get(p));
  });

  // D-T0149-R2 (achado pelo testes às 07h do PC e corrigido pelo modulo-catalogo no mesmo momento, RD-0126 — regra única em
  // modules/catalogo/contracts/estoque-filial.ts): o Catálogo tratava como NÃO CONTROLADO o produto com saldo só em outra filial
  // (o app mostrava 0 e mandava como orçamento; a API aceitava o pedido quando o ERP não manda a linha zerada da Boa Vista).
  it('RS-6 D-T0149-R2 corrigido: produto só com saldo na Manaus → a API vê 0 na Boa Vista (como o app) e recusa o pedido', async () => {
    const app = doApp(F_BVB);
    expect(app.get(SO_MAO)).toBe(0);
    expect((await daApi(F_BVB, [SO_MAO])).get(SO_MAO)).toBe(0);
    expect((await falta([{ produto_id: SO_MAO, quantidade_base: 1 }], F_BVB)).r).toEqual([{ produto_id: SO_MAO, pedido_base: 1, disponivel_base: 0 }]);
  });

  // D-T0149-R2, 2º caso (corrigido): filial cadastrada sem depósito, com outras filiais com depósito → o Catálogo somava TODOS os
  // depósitos ("filial sem depósito algum, vale o total"); o app dá 0. Agora a filial sem depósito = conjunto vazio = 0.
  it('RS-6 D-T0149-R2 corrigido: filial sem depósito → API e app com o mesmo saldo (o app dá 0; a API não soma as outras filiais)', async () => {
    const app = doApp(F_NOVA);
    const api = await daApi(F_NOVA, [ACU, CAF]);
    expect(app.get(ACU)).toBe(0);
    expect(api.get(ACU)).toBe(app.get(ACU));
    expect(api.get(CAF)).toBe(app.get(CAF));
  });
});
