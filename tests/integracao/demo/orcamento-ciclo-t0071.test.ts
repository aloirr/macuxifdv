/**
 * T-0071 critérios 4 e 5 (desenho docs/desenho/T-0071.md §1.2–§1.5) — o CICLO do orçamento pelo caminho do APP, na base demo,
 * com o `createApp` REAL (Postgres como macuxi_app, RLS) e o motor de sync do aparelho em memória. Complementa
 * `orcamento-ponta-a-ponta.test.ts` (O1–O9) e `orcamento-regressao-ux.test.ts` (U1–U6) sem repetir: aqui o aparelho usa as
 * MESMAS funções da tela (`lerLinhas` → `detalheDoPedido` → `pedidoDaConversao` / `copiaDoDetalhe` + `duplicarDocumento` /
 * `reconferirDocumento`, `acoesNaTela`, `seloDoOrcamento`, `porTipo`).
 * Matriz: docs/testes/T-0071.md, seção "Ciclo do orçamento pelo caminho do app" (C1–C9).
 *
 *  C1 offline: toque duplo no Salvar e Editar na fila não duplicam (mesmo UUID); a resposta do lote se perde → o reenvio não
 *     duplica (RN-VEN-33); o orçamento não mexe no saldo de estoque (RN-VEN-18/32).
 *  C2 Transformar (RN-VEN-18): pedido novo com UUID do aparelho, enfileirado 2× e reenviado depois da resposta perdida → um
 *     pedido só, um criado@1 e um aprovado@1, a meta sobe uma vez; o orçamento vira "Virou pedido 0000nn".
 *  C3 Transformar com preço alterado DENTRO da validade: preço congelado (RN-VEN-18, T-0134, decisão do dono de 08/11/2026) —
 *     a reconferência do aparelho NÃO acusa "Café 18,90 → 19,50" (só estoque e preço mínimo) e o servidor grava o preço do
 *     orçamento (18,90); o total do aparelho = o do servidor; o orçamento guarda o preço dele.
 *  C4 preço de mais de 7 dias (RN-VEN-18 de 09/11, T-0141: o orçamento NÃO vence; antes era o "vencido"): continua aberto, com o
 *     selo "Orçamento · preço de dd/mm" (a data em que o preço foi tirado), todas as ações e na lista Orçamentos.
 *  C5 Duplicar o de preço antigo: orçamento novo (número e validade novos, sem origem) ou pedido, com o preço de hoje; o vencido não muda.
 *  C6 RN-VEN-11 (preço mínimo = preço de venda × (1 − desconto máximo efetivo), do core.cadastro_resumo@1) no envio, no PUT do
 *     orçamento e no Transformar: recusa `preco_abaixo_minimo` (422 no PUT; `rejeitado` no push), nada gravado.
 *  C7 RN-VEN-20 (estoque) na reconferência do Transformar: o aparelho soma o saldo local por produto (produtosComPrecos).
 *  C8 Gestão (supervisora da demo): vê o orçamento da equipe em Orçamentos, sem Transformar, Editar nem Cancelar (só PDF);
 *     fora de "Para aprovar"; PUT, cancelar e Transformar pela API recusados; nada muda.
 *  C9 RN-VEN-13: cadastro incompleto (Atacado Boto Rosa) e cliente bloqueado (Mercearia do Porto) só orçamento — pedido e
 *     Transformar recusados.
 *
 * Sem `it.fails` desde 05/11 (C6 e C7 corrigidos). Defeito novo vira `it.fails` com recado ao dono; corrigido, volta a `it` (agente testes).
 */
import { randomUUID } from 'node:crypto';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { CONSULTA_PRECOS_CLIENTE, entidadeEstoqueSaldo } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import type { OrderDetail, PedidoPush } from '@macuxi/vendedor/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toDomainPolicy } from '../../../modules/vendedor/app/lib/catalog';
import { copiaDoDetalhe, reconferirDocumento } from '../../../modules/vendedor/app/lib/documento';
import { porTipo } from '../../../modules/vendedor/app/lib/lista-pedidos';
import { faixasPorProduto } from '../../../modules/vendedor/app/lib/novo-pedido';
import { acoesNaTela, pedidoDaConversao, rotuloDoDocumento, situacaoNaTela } from '../../../modules/vendedor/app/lib/pre-venda';
import { detalheDoPedido, lerLinhas, listaDePedidos, paraAprovar, politicaApi, produtosComPrecos, transportadorasDaTela, unidadesDaTela, type LinhasVendedor } from '../../../modules/vendedor/app/lib/pull';
import { seloDoOrcamento, situacaoDoClienteSync } from '../../../modules/vendedor/app/lib/textos-pedido';
import { duplicarDocumento } from '../../../modules/vendedor/domain';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, garantirSaldoNaFilial, listaDe, SALDO_REFERENCIA, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

interface Banco {
  id: string;
  tipo: string;
  status: string;
  numero: string | null;
  orcamento_id: string | null;
  orcamento_validade: string | null;
  nivel_aprovacao: string | null;
  total_tabela_cents: number;
  total_cents: number;
}
interface ItemBanco {
  produto_id: string;
  produto_sku: string;
  unidade: string;
  quantidade: number;
  preco_tabela_cents: number;
  preco_unitario_cents: number;
  desconto_pct: number;
  desconto_unitario_cents: number | null;
  ajuste_em: string | null;
}
type ItemRef = { product_id: string; quantity: number; unidade?: string; desconto_pct?: number; desconto_unitario_cents?: number; ajuste_em?: 'pct' | 'valor' };

describe.skipIf(semBanco())('T-0071 — ciclo do orçamento pelo caminho do app: offline, Transformar, preço de hoje, Duplicar, Gestão e RN-VEN-13 (base demo × createApp real × motor de sync)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let lucas: AparelhoCampo;
  const prod: Record<'AGU' | 'CAF' | 'BIS', string> = { AGU: '', CAF: '', BIS: '' };
  let miniBox = '';
  let cond28 = '';

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const noBanco = async (pid: string): Promise<Banco | undefined> =>
    (
      await q<Banco & Record<string, unknown>>(
        `select id, tipo, status, numero, orcamento_id, orcamento_validade::text, nivel_aprovacao, total_tabela_cents::float8 as total_tabela_cents, total_cents::float8 as total_cents
           from vendedor.pedido where id = $1`,
        [pid],
      )
    )[0];
  const itensNoBanco = (pid: string) =>
    q<ItemBanco & Record<string, unknown>>(
      `select produto_id, produto_sku, unidade, quantidade::int as quantidade, preco_tabela_cents::float8 as preco_tabela_cents, preco_unitario_cents::float8 as preco_unitario_cents,
              desconto_pct::float8 as desconto_pct, desconto_unitario_cents::float8 as desconto_unitario_cents, ajuste_em
         from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia`,
      [pid],
    );
  const eventos = async (pid: string) => (await q<{ nome: string }>("select nome from plataforma.evento where agregado_id = $1 or payload->>'pedido_id' = $1::text order by created_at", [pid])).map((e) => e.nome);
  const conversoesDe = async (orc: string) => (await q<{ id: string }>('select id from vendedor.pedido where orcamento_id = $1 order by created_at', [orc])).map((x) => x.id);
  const push = async (tk: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const realizadoDoLucas = async (): Promise<number> => {
    const r = await api.chamar(token.vendedor, { method: 'GET', url: `/v1/core/indicadores?usuario_id=${usuarioId.vendedor}` });
    expect(r.statusCode, r.body).toBe(200);
    const it = (r.json() as { itens: Array<{ usuario_id: string; indicadores: { realizado_cents?: number | null } }> }).itens.find((i) => i.usuario_id === usuarioId.vendedor);
    expect(it, 'Lucas no painel de metas').toBeDefined();
    return Number(it!.indicadores.realizado_cents ?? 0);
  };
  /** Composição da referência (R-20261103-130003): AGU-500 3 FD 5%, CAF-500 12 UN R$ 1,00 por unidade, BIS-400 1 CX, 1% no pedido. */
  const itensReferencia = (): ItemRef[] => [
    { product_id: prod.AGU, quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' },
    { product_id: prod.CAF, quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' },
    { product_id: prod.BIS, quantity: 1, unidade: 'CX' },
  ];
  const payloadOrcamento = (pid: string, extra: Record<string, unknown> = {}) => ({
    id: pid,
    tipo: 'orcamento' as const,
    customer_id: miniBox,
    discount_pct: 1,
    ajuste_em: 'pct' as const,
    payment_terms: '28 dias',
    condicao_pagamento_id: cond28,
    created_offline_at: new Date().toISOString(),
    items: itensReferencia(),
    ...extra,
  });
  const item = (payload: { id: string } & Record<string, unknown>): ItemPush => ({ entidade: 'pedido', id: payload.id, operacao: 'upsert', payload });
  const filaIds = (ap: AparelhoCampo) => ap.motor.estado().fila.map((i) => i.id);
  const sincronizarComHorizonte = async (ap: AparelhoCampo) => {
    await esperarHorizonte();
    expect(await ap.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
  };

  /** O detalhe que a tela abre (linhas locais, offline) e a linha do pull (condição e observação). */
  const naTela = async (ap: AparelhoCampo, pid: string, perfil = 'vendedor'): Promise<{ l: LinhasVendedor; det: OrderDetail; linha: LinhasVendedor['pedidos'][number] }> => {
    const l = await lerLinhas(ap.motor);
    const det = detalheDoPedido(l, pid, perfil, ap.motor.parametros('vendedor'));
    expect(det, `documento ${pid} no aparelho`).not.toBeNull();
    return { l, det: det!, linha: l.pedidos.find((p) => p.id === pid)! };
  };
  /** `converterOrcamento` do use-vendedor.ts: pedido novo pela cópia do detalhe (preço não copiado). */
  const transformarNoAparelho = async (ap: AparelhoCampo, orc: string, novoId: string): Promise<PedidoPush> => {
    const { l, det, linha } = await naTela(ap, orc);
    return pedidoDaConversao(det, { condicaoId: linha.condicao_pagamento_id ?? null, observacao: linha.observacao ?? null, novoId, agora: new Date().toISOString(), transportadoras: transportadorasDaTela(l) });
  };
  /** `reconferirOrcamentoLocal` do use-vendedor.ts: tabela do cliente pela consulta do Catálogo no aparelho (offline). */
  const reconferirNoAparelho = async (ap: AparelhoCampo, orc: string) => {
    const { l, det } = await naTela(ap, orc);
    const params = ap.motor.parametros('vendedor');
    const ativos = l.produtos.filter((p) => p.ativo);
    const precos = await ap.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: det.customer_id, produto_ids: ativos.map((p) => p.id), em: new Date().toISOString() });
    const catalogo = produtosComPrecos(l, new Map(precos.itens.map((i) => [i.produto_id, i.preco_cents])));
    return reconferirDocumento({
      detalhe: det,
      catalogo,
      unidades: unidadesDaTela(l),
      // RN-VEN-15 nova (06/11): a embalagem é sempre UN × fator (sem preço próprio); o que vem da consulta são as faixas da
      // tabela escalonada (RN-VEN-23), como no `garantirProdutos` do use-vendedor.ts
      faixas: faixasPorProduto(precos.itens),
      cliente: situacaoDoClienteSync(l.clientes.find((c) => c.id === det.customer_id), (l.financeiros ?? []).find((f) => f.cliente_id === det.customer_id)),
      policy: toDomainPolicy(politicaApi(params)),
      estoque_bloqueia: false,
    });
  };
  /** Preço vigente (unidade base) do produto na tabela do cliente. */
  const linhaDePreco = async (cliente: string, produto: string) =>
    q<{ id: string; preco_cents: number }>(
      `select i.id, i.preco_cents::int as preco_cents
         from catalogo.cliente_tabela_preco c
         join catalogo.tabela_preco_item i on i.tabela_preco_id = c.tabela_preco_id and i.tenant_id = c.tenant_id
        where c.cliente_id = $1 and c.deleted_at is null and i.produto_id = $2 and i.unidade is null and i.deleted_at is null
          and (i.vigencia_inicio is null or i.vigencia_inicio <= now()) and (i.vigencia_fim is null or i.vigencia_fim > now())
            -- RN-CAT-06 / RN-CORE-39 (T-0149): só a linha da filial do cliente; a tabela sem item nessa filial cai na filial padrão
            and i.filial_id = coalesce(
              (select cl.filial_id from core.cliente cl
                where cl.id = c.cliente_id and cl.tenant_id = c.tenant_id
                  and exists (select 1 from catalogo.tabela_preco_item x
                               where x.tenant_id = c.tenant_id and x.tabela_preco_id = c.tabela_preco_id and x.filial_id = cl.filial_id and x.deleted_at is null)),
              (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null))`,
      [cliente, produto],
    );
  /** Um produto ativo com preço vigente na tabela do cliente (unidade base). */
  const produtoVendavel = async (cliente: string): Promise<string> => {
    const r = await q<{ id: string }>(
      `select p.id
         from catalogo.cliente_tabela_preco c
         join catalogo.tabela_preco_item i on i.tabela_preco_id = c.tabela_preco_id and i.tenant_id = c.tenant_id and i.unidade is null and i.deleted_at is null
              and (i.vigencia_inicio is null or i.vigencia_inicio <= now()) and (i.vigencia_fim is null or i.vigencia_fim > now())
            -- RN-CAT-06 / RN-CORE-39 (T-0149): só a linha da filial do cliente; a tabela sem item nessa filial cai na filial padrão
            and i.filial_id = coalesce(
              (select cl.filial_id from core.cliente cl
                where cl.id = c.cliente_id and cl.tenant_id = c.tenant_id
                  and exists (select 1 from catalogo.tabela_preco_item x
                               where x.tenant_id = c.tenant_id and x.tabela_preco_id = c.tabela_preco_id and x.filial_id = cl.filial_id and x.deleted_at is null)),
              (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null))
         join core.produto p on p.id = i.produto_id and p.ativo and p.deleted_at is null
        where c.cliente_id = $1 and c.deleted_at is null
        order by p.sku limit 1`,
      [cliente],
    );
    expect(r, `cliente ${cliente} com algum produto na tabela`).toHaveLength(1);
    return r[0]!.id;
  };
  const clienteDemo = async (nome: string): Promise<string> => {
    const r = await q<{ id: string }>('select id from core.cliente where tenant_id = $1 and (nome_fantasia = $2 or razao_social = $2) and deleted_at is null', [TENANT_DEMO, nome]);
    expect(r, `${nome} na base demo`).toHaveLength(1);
    return r[0]!.id;
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    const produtos = await q<{ sku: string; id: string }>("select sku, id from core.produto where tenant_id = $1 and sku in ('AGU-500', 'CAF-500', 'BIS-400') and deleted_at is null", [TENANT_DEMO]);
    for (const p of produtos) prod[p.sku.slice(0, 3) as 'AGU' | 'CAF' | 'BIS'] = p.id;
    expect([prod.AGU, prod.CAF, prod.BIS].every(Boolean), 'AGU-500, CAF-500 e BIS-400 na base demo').toBe(true);
    miniBox = (await q<{ id: string }>("select id from core.cliente where tenant_id = $1 and external_id = 'C5110'", [TENANT_DEMO]))[0]?.id ?? '';
    expect(miniBox, 'Mini Box Japiim (C5110)').not.toBe('');
    // RN-VEN-20 (v1.0.4): os totais da referência dependem de AGU-500, CAF-500 e BIS-400 nessas quantidades; o CAF-500 tem pouco
    // disponível na filial do Mini Box (saldo − reservas do seed): o preparo completa o saldo antes do 1º sync (a recusa fica ligada)
    for (const p of [prod.AGU, prod.CAF, prod.BIS]) await garantirSaldoNaFilial(api.admin, miniBox, p, SALDO_REFERENCIA);
    cond28 = (await q<{ id: string }>("select id from vendedor.condicao_pagamento where tenant_id = $1 and codigo = '28D'", [TENANT_DEMO]))[0]!.id;
    await esperarHorizonte();
    // o aparelho do Lucas também recebe o saldo de estoque (catalogo.estoque_saldo), como o Campo com o Catálogo (C7)
    lucas = await aparelhoCampo(api, DEMO.vendedor, { entidadesExtras: [entidadeEstoqueSaldo] });
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------ C1–C2: offline e idempotência
  describe('Offline: a fila não duplica (RN-VEN-33)', () => {
    const ORC = randomUUID();
    const PED = randomUUID();

    it('C1. modo avião: toque duplo no Salvar e Editar na fila mantêm UM item; a resposta do lote se perde e o reenvio não duplica; o saldo de estoque não muda (RN-VEN-18/32/33)', async () => {
      const saldoAntes = await q('select id, quantidade::text as quantidade from catalogo.estoque_saldo where tenant_id = $1 order by id', [TENANT_DEMO]);
      lucas.online.valor = false;
      const payload = payloadOrcamento(ORC);
      await lucas.motor.enfileirar({ id: ORC, entidade: 'pedido', payload });
      await lucas.motor.enfileirar({ id: ORC, entidade: 'pedido', payload }); // 2º toque em "Salvar como orçamento"
      expect(filaIds(lucas), 'toque duplo: um item na fila').toEqual([ORC]);
      // Editar na fila (P-2, sem sinal): BIS-400 1 CX → 2 CX; mesmo id e mesma posição
      const editado = { ...payload, items: payload.items.map((i) => (i.product_id === prod.BIS ? { ...i, quantity: 2 } : i)) };
      expect(await lucas.motor.alterar(ORC, { payload: editado })).toBe(true);
      expect(filaIds(lucas)).toEqual([ORC]);
      expect(lucas.motor.estado().fila[0]!.payload, 'a fila guarda a edição').toEqual(editado);
      await lucas.sincronizar();
      expect(await noBanco(ORC), 'offline: nada no servidor').toBeUndefined();

      // reconecta e a resposta se perde: o servidor grava, o aparelho acha que caiu
      const lotes = lucas.lotesEnviados.length;
      lucas.online.valor = true;
      lucas.rede.respostaPerdida = true;
      try {
        await lucas.sincronizar().catch(() => false);
      } finally {
        lucas.rede.respostaPerdida = false;
      }
      expect(filaIds(lucas), 'o aparelho não soube do aceite: o item continua na fila').toEqual([ORC]);
      expect(await noBanco(ORC), 'o servidor gravou na 1ª ida').toMatchObject({ tipo: 'orcamento' });

      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(filaIds(lucas), 'o reenvio foi aceito').toEqual([]);
      const idas = lucas.lotesEnviados.slice(lotes).flat().filter((i) => i.id === ORC);
      expect(idas, 'o mesmo item foi duas vezes ao servidor').toHaveLength(2);
      expect(await q('select 1 from vendedor.pedido where id = $1', [ORC]), 'um registro só').toHaveLength(1);
      const itens = await itensNoBanco(ORC);
      expect(itens.map((i) => [i.produto_sku, i.unidade, i.quantidade]), 'a edição da fila venceu').toEqual([
        ['AGU-500', 'FD', 3],
        ['CAF-500', 'UN', 12],
        ['BIS-400', 'CX', 2],
      ]);
      expect(await eventos(ORC), 'RN-VEN-32: orçamento sem evento de pedido').toEqual([]);
      expect(await q('select 1 from integracao.pedido_fila_erp where pedido_uuid = $1', [ORC]), 'RN-INT-08: fora da fila do ERP').toEqual([]);
      expect(await q('select id, quantidade::text as quantidade from catalogo.estoque_saldo where tenant_id = $1 order by id', [TENANT_DEMO]), 'RN-VEN-18: não reserva estoque').toEqual(saldoAntes);
    });

    it('C2. Transformar pelo app (UUID do aparelho), 2 toques em Enviar e resposta perdida → UM pedido, um criado@1 e um aprovado@1; a meta sobe uma vez; o orçamento vira "Virou pedido"', async () => {
      await sincronizarComHorizonte(lucas);
      const antes = await naTela(lucas, ORC);
      expect(situacaoNaTela(antes.det, new Date())).toBe('aberto');
      expect(acoesNaTela(antes.det, new Date(), true)).toMatchObject({ pode_converter: true, pode_editar: true, pode_duplicar: true, pode_pdf: true });
      const orc = (await noBanco(ORC))!;
      const realizadoAntes = await realizadoDoLucas();

      lucas.online.valor = false;
      const payload = await transformarNoAparelho(lucas, ORC, PED);
      expect(payload).toMatchObject({ id: PED, tipo: 'pedido', orcamento_origem_id: ORC, customer_id: miniBox, discount_pct: 1 });
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload });
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload }); // 2º toque em "Enviar pedido"
      expect(filaIds(lucas)).toEqual([PED]);

      lucas.online.valor = true;
      lucas.rede.respostaPerdida = true;
      try {
        await lucas.sincronizar().catch(() => false);
      } finally {
        lucas.rede.respostaPerdida = false;
      }
      expect(filaIds(lucas)).toEqual([PED]);
      expect(await conversoesDe(ORC), 'o servidor converteu na 1ª ida').toEqual([PED]);
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(filaIds(lucas), 'reenvio aceito (mesmo UUID, mesmo conteúdo)').toEqual([]);

      expect(await conversoesDe(ORC), 'um pedido só para o orçamento').toEqual([PED]);
      const p = (await noBanco(PED))!;
      expect(p).toMatchObject({ tipo: 'pedido', status: 'approved', orcamento_id: ORC, nivel_aprovacao: null, total_tabela_cents: orc.total_tabela_cents, total_cents: orc.total_cents });
      expect((await itensNoBanco(PED)).map((i) => [i.produto_sku, i.unidade, i.quantidade]), 'a medida do orçamento segue no pedido').toEqual((await itensNoBanco(ORC)).map((i) => [i.produto_sku, i.unidade, i.quantidade]));
      const ev = await eventos(PED);
      expect(ev.filter((n) => n === 'vendedor.pedido.criado@1'), 'um criado@1').toHaveLength(1);
      expect(ev.filter((n) => n === 'vendedor.pedido.aprovado@1'), 'um aprovado@1').toHaveLength(1);
      expect(await realizadoDoLucas(), 'RN-CORE-21: a meta sobe uma vez, pelo pedido novo').toBe(realizadoAntes + p.total_cents);

      await sincronizarComHorizonte(lucas);
      const depois = await naTela(lucas, ORC);
      expect(depois.det.convertido_pedido_id).toBe(PED);
      expect(situacaoNaTela(depois.det, new Date())).toBe('convertido');
      expect(acoesNaTela(depois.det, new Date(), true)).toMatchObject({ pode_converter: false, pode_editar: false, pode_cancelar: false, pode_duplicar: true });
      const selo = seloDoOrcamento({ situacao: 'convertido', preco_data: api.hoje, pedido_numero: p.numero });
      expect(selo.texto).toBe(`Virou pedido ${p.numero}`);
    });
  });

  // ------------------------------------------------------------------------------- C3–C5: preço de hoje, vencido, Duplicar
  describe('Transformar com preço alterado, vencido e Duplicar (RN-VEN-18, RN-VEN-01/02)', () => {
    const ORC = randomUUID();
    const VENC = randomUUID();
    const PED = randomUUID();
    let precoCafe: { id: string; preco_cents: number };
    let vencido: Banco;

    beforeAll(async () => {
      const r = await push(token.vendedor, [item(payloadOrcamento(ORC)), item(payloadOrcamento(VENC))]);
      expect(r.map((x) => x.status), JSON.stringify(r)).toEqual(['aceito', 'aceito']);
      await api.admin.query("update vendedor.pedido set orcamento_validade = (now() at time zone 'America/Manaus')::date - 2 where id = $1", [VENC]);
      vencido = (await noBanco(VENC))!;
      const linhas = await linhaDePreco(miniBox, prod.CAF);
      expect(linhas, 'uma linha vigente do CAF-500 na tabela do Mini Box').toHaveLength(1);
      precoCafe = linhas[0]!;
      expect(precoCafe.preco_cents, 'CAF-500 a R$ 18,90 na referência').toBe(1890);
      await sincronizarComHorizonte(lucas);
    });
    afterAll(async () => {
      if (precoCafe) await api.admin.query('update catalogo.tabela_preco_item set preco_cents = $2 where id = $1', [precoCafe.id, precoCafe.preco_cents]);
    });

    // RN-VEN-18 "Preço congelado" (T-0134, decisão do dono do produto de 08/11/2026): dentro da validade, Transformar mantém
    // o preço do orçamento e reconfere só estoque e preço mínimo.
    it('C3. o Café sobe de R$ 18,90 para R$ 19,50 depois do orçamento: dentro da validade a reconferência do aparelho NÃO acusa mudança de preço (preço congelado, RN-VEN-18) e continua dentro da alçada', async () => {
      await api.admin.query('update catalogo.tabela_preco_item set preco_cents = 1950 where id = $1', [precoCafe.id]);
      await sincronizarComHorizonte(lucas);
      const r = await reconferirNoAparelho(lucas, ORC);
      expect(r.mudancas.filter((m) => m.tipo === 'preco'), 'preço congelado: a tabela nova (19,50) não reprecifica o orçamento').toEqual([]);
      // RN-VEN-10 (lote v1.0.3): a alçada saiu das mudanças da reconferência (é só a pergunta ao salvar); aqui ela se
      // confere pelo nível do cálculo, que continua nulo (dentro da alçada do vendedor).
      expect(r.mudancas.map((m) => m.tipo as string), 'nenhuma mudança de alçada na reconferência').not.toContain('alcada');
      expect(r).toMatchObject({ pode_enviar: true, bloqueio: null });
      expect(r.calculo.nivel, 'a alçada não muda: dentro da do vendedor').toBeNull();
    });

    it('C3b. Transformar → o servidor grava o preço CONGELADO do orçamento (18,90; R$ 1,00 por unidade mantido), não o de hoje (19,50); o total do aparelho = o do servidor; o orçamento guarda 18,90 e 37979', async () => {
      const r = await reconferirNoAparelho(lucas, ORC);
      const payload = await transformarNoAparelho(lucas, ORC, PED);
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload });
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(filaIds(lucas)).toEqual([]);
      const p = (await noBanco(PED))!;
      expect(p).toMatchObject({ tipo: 'pedido', status: 'approved', orcamento_id: ORC, total_tabela_cents: 39830 });
      expect(p.total_cents, 'o total que a folha do Transformar mostrou é o que o servidor gravou').toBe(r.calculo.totais.total_cents);
      const caf = (await itensNoBanco(PED)).find((i) => i.produto_id === prod.CAF)!;
      expect(caf, 'preço congelado do orçamento, não o 19,50 de hoje').toMatchObject({ preco_tabela_cents: 1890, preco_unitario_cents: 1790, desconto_unitario_cents: 100, ajuste_em: 'valor' });
      const o = (await noBanco(ORC))!;
      expect(o).toMatchObject({ tipo: 'orcamento', total_tabela_cents: 39830, total_cents: 37979 });
      expect((await itensNoBanco(ORC)).find((i) => i.produto_id === prod.CAF)!.preco_tabela_cents, 'o orçamento guarda o preço dele').toBe(1890);
    });

    // RN-VEN-18 mudou em 09/11 (T-0141): o orçamento não vence; os 7 dias limitam só o preço congelado. O VENC (validade = hoje − 2,
    // ou seja, preço tirado há 9 dias) era "Vencido" (só Duplicar e PDF); agora continua aberto, com a data do preço no selo.
    it('C4. preço de 9 dias atrás no aparelho: continua aberto, selo "Orçamento · preço de dd/mm" (data do preço), todas as ações, em Orçamentos', async () => {
      const { l, det } = await naTela(lucas, VENC);
      expect(situacaoNaTela(det, new Date())).toBe('aberto');
      // oráculo da regra: data do preço = último dia do preço (orcamento_validade, D+7) − 7
      const precoData = somarDiasCivis(vencido.orcamento_validade!, -7);
      const [, m, d] = precoData.split('-');
      expect(seloDoOrcamento({ situacao: 'aberto', preco_data: precoData, pedido_numero: null }).texto).toBe(`Orçamento · preço de ${d}/${m}`);
      expect(acoesNaTela(det, new Date(), true)).toMatchObject({ pode_converter: true, pode_editar: true, pode_cancelar: true, pode_duplicar: true, pode_pdf: true });
      const orcs = porTipo(listaDePedidos(l, lucas.motor.parametros('vendedor')).map((o) => ({ ...o, local: false, local_error: '' })), 'orcamento', new Date());
      expect(orcs.findIndex((o) => o.id === VENC), 'o de preço antigo está em Orçamentos').toBeGreaterThanOrEqual(0);
      expect(orcs.every((o) => o.tipo === 'orcamento'), 'o filtro Orçamentos só traz orçamento').toBe(true);
    });

    it('C4b. a linha do de preço antigo na lista diz "Orçamento" (a situação é aberto; "Vencido" saiu com a RN-VEN-18 de 09/11)', async () => {
      const { det } = await naTela(lucas, VENC);
      expect(rotuloDoDocumento(det, new Date())).toBe('Orçamento');
    });

    it('C5. Duplicar o de preço antigo → Salvar como orçamento: documento NOVO (número e validade novos, sem origem), mesma medida e ajustes, preço de hoje; o original não muda', async () => {
      const { l, det, linha } = await naTela(lucas, VENC);
      const copia = copiaDoDetalhe(det, { condicaoId: linha.condicao_pagamento_id ?? null, observacao: linha.observacao ?? null, transportadoras: transportadorasDaTela(l) });
      const novo = randomUUID();
      const rascunho = duplicarDocumento(copia, novo, new Date().toISOString());
      expect(rascunho, 'Duplicar não leva a origem').not.toHaveProperty('orcamento_origem_id');
      const payload = { ...rascunho, payment_terms: det.payment_terms || '28 dias', tipo: 'orcamento' as const };
      await lucas.motor.enfileirar({ id: novo, entidade: 'pedido', payload });
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(filaIds(lucas)).toEqual([]);
      const d = (await noBanco(novo))!;
      expect(d).toMatchObject({ tipo: 'orcamento', orcamento_id: null, nivel_aprovacao: null });
      expect(d.numero).not.toBe(vencido.numero);
      expect(d.orcamento_validade! >= api.hoje, 'validade nova, a partir de hoje').toBe(true);
      expect(d.orcamento_validade! > vencido.orcamento_validade!, 'validade depois da do vencido').toBe(true);
      expect((await itensNoBanco(novo)).map((i) => [i.produto_sku, i.unidade, i.quantidade, i.preco_tabela_cents, i.ajuste_em])).toEqual([
        ['AGU-500', 'FD', 3, 1790, 'pct'],
        ['CAF-500', 'UN', 12, 1950, 'valor'], // preço de hoje
        ['BIS-400', 'CX', 1, 11780, 'pct'],
      ]);
      const it = await itensNoBanco(novo);
      expect([it[0]!.desconto_pct, it[1]!.desconto_unitario_cents], '5% na água e R$ 1,00 no café').toEqual([5, 100]);
      expect(await eventos(novo)).toEqual([]);
      expect(await noBanco(VENC), 'o vencido não muda').toEqual(vencido);
      expect(await conversoesDe(VENC)).toEqual([]);
    });

    it('C5b. Duplicar o de preço antigo → Enviar pedido: pedido novo aprovado SEM origem, com o preço de hoje; o original continua aberto, não "convertido"', async () => {
      const { l, det, linha } = await naTela(lucas, VENC);
      const novo = randomUUID();
      const rascunho = duplicarDocumento(copiaDoDetalhe(det, { condicaoId: linha.condicao_pagamento_id ?? null, observacao: linha.observacao ?? null, transportadoras: transportadorasDaTela(l) }), novo, new Date().toISOString());
      const [r] = await push(token.vendedor, [item({ ...rascunho, payment_terms: det.payment_terms || '28 dias' })]);
      expect(r).toMatchObject({ id: novo, status: 'aceito' });
      const p = (await noBanco(novo))!;
      expect(p).toMatchObject({ tipo: 'pedido', status: 'approved', orcamento_id: null });
      expect((await itensNoBanco(novo)).find((i) => i.produto_id === prod.CAF)!.preco_tabela_cents).toBe(1950);
      expect(await eventos(novo)).toEqual(expect.arrayContaining(['vendedor.pedido.criado@1', 'vendedor.pedido.aprovado@1']));
      expect(await conversoesDe(VENC)).toEqual([]);
      const venc = await api.get(token.vendedor, '/v1/vendedor/pedidos?tipo=orcamento&situacao=aberto&limite=200');
      expect(listaDe(venc.corpo).map((x) => (x as { id: string }).id)).toContain(VENC);
    });
  });

  // ------------------------------------------------------------------------------------ C6: RN-VEN-11 (preço mínimo)
  describe('RN-VEN-11 — o teto do desconto é o preço mínimo, no envio e no Transformar', () => {
    const ORC = randomUUID();
    const itemCafe = (pct: number): ItemRef[] => [{ product_id: prod.CAF, quantity: 12, unidade: 'UN', desconto_pct: pct, ajuste_em: 'pct' }];

    it('C6-0. precondição: CAF-500 com preço de venda R$ 18,90, desconto máximo próprio vazio (padrão 15%) e tabela do Mini Box a R$ 18,90; o orçamento com 10% é aceito', async () => {
      const [c] = await q<{ preco_venda_cents: number; desconto_maximo_pct: number | null }>('select preco_venda_cents::int as preco_venda_cents, desconto_maximo_pct::float8 as desconto_maximo_pct from core.produto where id = $1', [prod.CAF]);
      expect(c).toEqual({ preco_venda_cents: 1890, desconto_maximo_pct: null });
      expect((await linhaDePreco(miniBox, prod.CAF)).map((x) => x.preco_cents)).toEqual([1890]);
      const [r] = await push(token.vendedor, [item(payloadOrcamento(ORC, { discount_pct: 0, items: itemCafe(10) }))]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
    });

    // T-0071-C6 (corrigido, R-20261105-121415): receber.ts passa preco_minimo_base_cents = precoMinimoBaseCents(preco_venda_cents,
    // desconto_maximo_pct efetivo do core.cadastro_resumo@1) a revalidarPedido. Café: mínimo = 1890 × (1 − 15%) = 1606,5 → 1607 (para cima, RN-VEN-11);
    // 15% dá unitário 1607 (meia para cima, RN-VEN-02) = mínimo → aceito; 15,01% dá 1890 × 0,8499 = 1606,31 → 1606 < 1607 → rejeitado.
    it('C6a. pedido com 30% no Café (final R$ 13,23 < mínimo R$ 16,07) → rejeitado preco_abaixo_minimo, nada gravado', async () => {
      const id = randomUUID();
      const [r] = await push(token.vendedor, [item({ ...payloadOrcamento(id, { discount_pct: 0, items: itemCafe(30) }), tipo: 'pedido' })]);
      expect(r).toMatchObject({ id, status: 'rejeitado', codigo: 'preco_abaixo_minimo' });
      expect(await noBanco(id)).toBeUndefined();
    });

    it('C6a2. limite: 15% no Café dá R$ 16,07 por unidade (= mínimo) → aceito; 15,01% cai abaixo → rejeitado preco_abaixo_minimo', async () => {
      const ok = randomUUID();
      const [a] = await push(token.vendedor, [item(payloadOrcamento(ok, { discount_pct: 0, items: itemCafe(15) }))]);
      expect(a).toMatchObject({ id: ok, status: 'aceito' });
      expect((await itensNoBanco(ok)).find((i) => i.produto_id === prod.CAF)!.preco_unitario_cents, '1890 × 0,85 = 1606,5 → 1607').toBe(1607);
      const fura = randomUUID();
      const [b] = await push(token.vendedor, [item(payloadOrcamento(fura, { discount_pct: 0, items: itemCafe(15.01) }))]);
      expect(b).toMatchObject({ id: fura, status: 'rejeitado', codigo: 'preco_abaixo_minimo' });
      expect(await noBanco(fura)).toBeUndefined();
    });

    it('C6c. PUT do orçamento de 10% para 30% no Café → 422 preco_abaixo_minimo; o orçamento não muda', async () => {
      const antes = await noBanco(ORC);
      const itensAntes = await itensNoBanco(ORC);
      const [linha] = await q<{ atualizado_em: string }>(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado_em from vendedor.pedido where id = $1`, [ORC]);
      const r = await api.chamar(token.vendedor, {
        method: 'PUT',
        url: `/v1/vendedor/orcamentos/${ORC}`,
        payload: { ...payloadOrcamento(ORC, { discount_pct: 0, items: itemCafe(30) }), id: undefined, tipo: undefined, created_offline_at: undefined, atualizado_em: linha!.atualizado_em },
      });
      expect(r.statusCode, r.body).toBe(422);
      expect((r.json() as { codigo?: string }).codigo).toBe('preco_abaixo_minimo');
      expect(await noBanco(ORC)).toEqual(antes);
      expect(await itensNoBanco(ORC)).toEqual(itensAntes);
    });

    it('C6b. o desconto máximo do Café cai para 5% depois do orçamento de 10%: Transformar → rejeitado preco_abaixo_minimo (a reconferência pede para reduzir)', async () => {
      await api.admin.query('update core.produto set desconto_maximo_pct = 5 where id = $1', [prod.CAF]);
      try {
        const id = randomUUID();
        const [r] = await push(token.vendedor, [item({ ...payloadOrcamento(id, { discount_pct: 0, items: itemCafe(10) }), tipo: 'pedido', orcamento_origem_id: ORC })]);
        expect(r).toMatchObject({ id, status: 'rejeitado', codigo: 'preco_abaixo_minimo' });
        expect(await conversoesDe(ORC)).toEqual([]);
      } finally {
        await api.admin.query('update core.produto set desconto_maximo_pct = null where id = $1', [prod.CAF]);
      }
    });
  });

  // ------------------------------------------------------------------------------ C7: RN-VEN-20 (estoque) na reconferência
  describe('RN-VEN-20 — Transformar reconfere o estoque no aparelho (avisa o que mudou)', () => {
    const ORC = randomUUID();
    let saldos: Array<{ id: string; quantidade: string }> = [];

    beforeAll(async () => {
      const [r] = await push(token.vendedor, [item(payloadOrcamento(ORC))]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
      saldos = await q<{ id: string; quantidade: string }>('select id, quantidade::text as quantidade from catalogo.estoque_saldo where tenant_id = $1 and produto_id = $2 and deleted_at is null', [TENANT_DEMO, prod.BIS]);
      await api.admin.query('update catalogo.estoque_saldo set quantidade = 1 where tenant_id = $1 and produto_id = $2 and deleted_at is null', [TENANT_DEMO, prod.BIS]);
      await sincronizarComHorizonte(lucas);
    });
    afterAll(async () => {
      for (const s of saldos) await api.admin.query('update catalogo.estoque_saldo set quantidade = $2::numeric where id = $1', [s.id, s.quantidade]);
    });

    it('C7-0. precondição: o saldo do BIS-400 chegou ao aparelho e é menor que 1 CX (20 UN)', async () => {
      expect(saldos.length, 'BIS-400 com saldo na base demo').toBeGreaterThan(0);
      const local = (await lucas.motor.linhas<LinhaSync & { produto_id: string; quantidade: unknown }>('estoque_saldo')).filter((s) => s.produto_id === prod.BIS && !s.deleted_at);
      expect(local.length, 'saldo do BIS-400 no aparelho').toBeGreaterThan(0);
      const total = local.reduce((s, x) => s + Number(x.quantidade), 0);
      expect(total).toBeLessThan(20);
    });

    // T-0071-C7 (corrigido, R-20261105-110803): lerLinhas lê estoque_saldo e produtosComPrecos põe stock_total = soma dos
    // depósitos do produto (sem linha = não controlado); a reconferência do Transformar vê o saldo do aparelho.
    it('C7a. a reconferência avisa a falta de estoque do BIS-400 (1 CX = 20 UN, saldo 1 por depósito)', async () => {
      const r = await reconferirNoAparelho(lucas, ORC);
      expect(r.mudancas.some((m) => m.tipo === 'estoque' && m.produto_id === prod.BIS), JSON.stringify(r.mudancas)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------- C8: Gestão (supervisora da demo)
  describe('Gestão — a supervisora vê o orçamento da equipe e não age por ele', () => {
    const ORC = randomUUID();
    let sup: AparelhoCampo;
    let atualizado = '';

    beforeAll(async () => {
      const [r] = await push(token.vendedor, [item(payloadOrcamento(ORC))]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
      await esperarHorizonte();
      sup = await aparelhoCampo(api, DEMO.supervisor);
      expect(await sup.sincronizar(), sup.motor.estado().erro ?? '').toBe(true);
      await sincronizarComHorizonte(lucas);
      atualizado = String((await lucas.motor.linhas<LinhaSync>('pedido')).find((p) => p.id === ORC)!.updated_at);
    });

    it('C8a. no aparelho da supervisora: o orçamento do Lucas está em Orçamentos ("Orçamento · preço de dd/mm"), sem Transformar, Editar nem Cancelar (só PDF), e fora de "Para aprovar"', async () => {
      const { l, det } = await naTela(sup, ORC, 'supervisor');
      expect(det).toMatchObject({ tipo: 'orcamento', seller_id: usuarioId.vendedor, total_cents: 37979 });
      // RN-VEN-18 (09/11): o selo mostra a data do preço (o ORC foi salvo hoje), nunca "até dd/mm"
      const [, m, d] = api.hoje.split('-');
      expect(seloDoOrcamento({ situacao: situacaoNaTela(det, new Date())!, preco_data: api.hoje, pedido_numero: null }).texto).toBe(`Orçamento · preço de ${d}/${m}`);
      // variante gestao (order-detail-screen: ehVendedor = !v1 || perfil === 'vendedor' → false): acoesNaTela zera converter, editar e
      // cancelar; Duplicar continua no domain, mas a tela só mostra Duplicar com ehVendedor (e a API recusa o pedido da supervisora)
      expect(acoesNaTela(det, new Date(), false)).toMatchObject({ pode_converter: false, pode_editar: false, pode_cancelar: false, pode_pdf: true });
      expect(acoesNaTela(det, new Date(), true), 'o mesmo orçamento aberto no Campo (vendedor dono) tem todas as ações').toMatchObject({ pode_converter: true, pode_editar: true, pode_cancelar: true, pode_pdf: true });
      const orcs = porTipo(listaDePedidos(l, sup.motor.parametros('vendedor')).map((o) => ({ ...o, local: false, local_error: '' })), 'orcamento', new Date());
      expect(orcs.map((o) => o.id)).toContain(ORC);
      expect(porTipo(listaDePedidos(l, sup.motor.parametros('vendedor')).map((o) => ({ ...o, local: false, local_error: '' })), 'pedido', new Date()).map((o) => o.id), 'a aba Pedidos não traz orçamento').not.toContain(ORC);
      expect(paraAprovar(l, 'supervisor').map((p) => p.id), 'orçamento nunca vai para aprovação (RN-VEN-18)').not.toContain(ORC);
      const lista = await api.get(token.supervisor, '/v1/vendedor/pedidos?tipo=orcamento&limite=200');
      expect(lista.status, JSON.stringify(lista.corpo)).toBe(200);
      expect(listaDe(lista.corpo).map((x) => (x as { id: string }).id), 'GET tipo=orcamento da supervisora').toContain(ORC);
    });

    it('C8b. pela API a supervisora não edita, não cancela nem transforma o orçamento do Lucas; nada muda', async () => {
      const antes = await noBanco(ORC);
      const e = await api.chamar(token.supervisor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${ORC}`, payload: { ...payloadOrcamento(ORC), id: undefined, tipo: undefined, created_offline_at: undefined, atualizado_em: atualizado } });
      expect([403, 404], `PUT da supervisora: ${e.body}`).toContain(e.statusCode);
      const c = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/orcamentos/${ORC}/cancelar`, payload: { motivo: 'supervisora' } });
      expect([403, 404], `cancelar da supervisora: ${c.body}`).toContain(c.statusCode);
      const novo = randomUUID();
      const [t] = await push(token.supervisor, [item({ ...payloadOrcamento(novo), tipo: 'pedido', orcamento_origem_id: ORC })]);
      expect(t, 'Transformar pela supervisora').toMatchObject({ id: novo, status: 'rejeitado' });
      expect(await noBanco(novo)).toBeUndefined();
      expect(await conversoesDe(ORC)).toEqual([]);
      expect(await noBanco(ORC)).toEqual(antes);
    });
  });

  // --------------------------------------------------------------------------- C9: RN-VEN-13 (incompleto e bloqueado)
  describe('RN-VEN-13 — cliente com cadastro incompleto ou bloqueado só salva orçamento', () => {
    let boto = '';
    let porto = '';
    const ORC_BOTO = randomUUID();
    const ORC_PORTO = randomUUID();
    const doc = (pid: string, cliente: string, produto: string, tipo: 'pedido' | 'orcamento', extra: Record<string, unknown> = {}) =>
      item({ id: pid, tipo, customer_id: cliente, discount_pct: 0, payment_terms: '28 dias', created_offline_at: new Date().toISOString(), items: [{ product_id: produto, quantity: 1 }], ...extra });
    let prodBoto = '';
    let prodPorto = '';

    beforeAll(async () => {
      boto = await clienteDemo('Atacado Boto Rosa');
      porto = await clienteDemo('Mercearia do Porto');
      prodBoto = await produtoVendavel(boto);
      prodPorto = await produtoVendavel(porto);
      const [b] = await q<{ cadastro_incompleto: boolean }>('select cadastro_incompleto from core.cliente where id = $1', [boto]);
      expect(b!.cadastro_incompleto, 'Boto Rosa sem CEP (cadastro incompleto)').toBe(true);
      const [f] = await q<{ bloqueado: boolean }>('select bloqueado from core.cliente_financeiro where cliente_id = $1 and deleted_at is null', [porto]);
      expect(f?.bloqueado, 'Mercearia do Porto bloqueada no financeiro').toBe(true);
    });

    it('C9a. Atacado Boto Rosa (Camila): orçamento aceito; pedido = rejeitado RN-VEN-13 citando o CEP; Transformar o orçamento = rejeitado RN-VEN-13; nenhum pedido gravado', async () => {
      const [o] = await push(token.vendedor2, [doc(ORC_BOTO, boto, prodBoto, 'orcamento')]);
      expect(o).toMatchObject({ id: ORC_BOTO, status: 'aceito' });
      expect((await noBanco(ORC_BOTO))!.tipo).toBe('orcamento');
      const ped = randomUUID();
      const [p] = await push(token.vendedor2, [doc(ped, boto, prodBoto, 'pedido')]);
      expect(p).toMatchObject({ id: ped, status: 'rejeitado', codigo: 'RN-VEN-13' });
      expect((p as { mensagem?: string } | undefined)?.mensagem ?? '').toMatch(/cep/i);
      const conv = randomUUID();
      const [t] = await push(token.vendedor2, [doc(conv, boto, prodBoto, 'pedido', { orcamento_origem_id: ORC_BOTO })]);
      expect(t).toMatchObject({ id: conv, status: 'rejeitado', codigo: 'RN-VEN-13' });
      expect(await noBanco(ped)).toBeUndefined();
      expect(await noBanco(conv)).toBeUndefined();
      expect(await conversoesDe(ORC_BOTO)).toEqual([]);
    });

    it('C9b. Mercearia do Porto (Lucas, bloqueada): o orçamento é aceito', async () => {
      const [o] = await push(token.vendedor, [doc(ORC_PORTO, porto, prodPorto, 'orcamento')]);
      expect(o).toMatchObject({ id: ORC_PORTO, status: 'aceito' });
    });

    // T-0071-C9 (corrigido, R-20261105-110749): receber.ts passa `bloqueado: cliente.bloqueado === true` (core.cadastro_resumo@1)
    // a verificarTipoParaCliente; no app, situacaoDoClienteSync lê o cliente_financeiro do pull. Orçamento segue permitido (C9b).
    it('C9c. Mercearia do Porto bloqueada: pedido = rejeitado RN-VEN-13, nada gravado', async () => {
      const ped = randomUUID();
      const [p] = await push(token.vendedor, [doc(ped, porto, prodPorto, 'pedido')]);
      expect(p).toMatchObject({ id: ped, status: 'rejeitado', codigo: 'RN-VEN-13' });
      expect(await noBanco(ped)).toBeUndefined();
    });

    it('C9d. Mercearia do Porto bloqueada: Transformar o orçamento = rejeitado RN-VEN-13, o orçamento continua aberto', async () => {
      const conv = randomUUID();
      const [t] = await push(token.vendedor, [doc(conv, porto, prodPorto, 'pedido', { orcamento_origem_id: ORC_PORTO })]);
      expect(t).toMatchObject({ id: conv, status: 'rejeitado', codigo: 'RN-VEN-13' });
      expect(await conversoesDe(ORC_PORTO)).toEqual([]);
    });
  });
});
