/**
 * T-0071 — P4 da matriz (docs/testes/T-0071.md): sugestões do novo pedido SEM REDE no aparelho. A consulta
 * `catalogo.sugestoes_pedido@1` roda no aparelho (modules/catalogo/app/sugestoes.ts, mesmo domain da API) sobre as linhas
 * locais que o MOTOR DE SYNC real puxou da BASE DEMO (`createApp` real, Postgres como `macuxi_app`, RLS): `produto_relacao`,
 * `cliente_tabela_preco`, `tabela_preco`, `tabela_preco_item` e `estoque_saldo` (RF-CAT-03; RN-CAT-05/06/07; RN-VEN-15/21).
 *
 *  P4a modo avião: Lucas, Mini Box Japiim (C5110), pedido com AGU-500, CAF-500 e BIS-400 → "Combina com o pedido" = os
 *      complementares do café na ordem do cadastro (ACU-1K, FIL-103, LPO-400) que têm preço na tabela do cliente e estoque;
 *      "Leve mais" = AGU-1500 (versão superior da água). Nada sai do aparelho. Preço = o do `catalogo.precos_cliente@1`.
 *  P4b o que já está no pedido não é sugerido (RN-CAT-06) e o limite corta a lista.
 *  P4c relação desativada no servidor: depois do pull (servidor vence) a sugestão some também offline.
 *  P4d sem o Catálogo para o usuário a consulta fica indisponível (RN-CORE-03) — a tela cai nas sugestões locais.
 *
 * Oráculo dos ids: o banco (relação ativa × preço na tabela do cliente × saldo > 0), não números fixos do seed.
 *
 * DEFEITO T-0071-P4 (04/11) CORRIGIDO: modules/catalogo/api/sync.ts passou a publicar `deposito` e `estoque_saldo` no pull
 * (R-20261104-055029-modulo-catalogo). P4-0, P4a, P4b e P4c viraram `it`; o P4-00 (vazio por falta de saldo) saiu.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { CONSULTA_PRECOS_CLIENTE, CONSULTA_SUGESTOES_PEDIDO, entidadeEstoqueSaldo, entidadeProdutoRelacao } from '@macuxi/catalogo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { licenca } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

describe.skipIf(semBanco())('T-0071 P4 — sugestões do novo pedido offline no aparelho (base demo × createApp real × motor de sync)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  let lucas: AparelhoCampo;
  const sku: Record<string, string> = {};
  const skuDe = (id: string) => Object.entries(sku).find(([, v]) => v === id)?.[0] ?? id;
  let miniBox = '';

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const sincronizar = async () => {
    await esperarHorizonte();
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  };
  const sugestoes = (skus: string[], limite?: number) =>
    lucas.motor.ambiente.consultar(CONSULTA_SUGESTOES_PEDIDO, {
      cliente_id: miniBox,
      produto_ids: skus.map((s) => sku[s]!),
      em: new Date().toISOString(),
      ...(limite ? { limite } : {}),
    });
  /** Oráculo no banco: relacionados ativos do tipo, na ordem, com preço na tabela do cliente e saldo > 0, fora do pedido. */
  const esperado = async (origens: string[], tipo: 'complementar' | 'superior', limite = 5): Promise<string[]> => {
    const r = await q<{ sku: string }>(
      `select p.sku
         from unnest($2::text[]) with ordinality o(sku, n)
         join core.produto po on po.tenant_id = $1 and po.sku = o.sku
         join catalogo.produto_relacao r on r.tenant_id = $1 and r.produto_id = po.id and r.tipo = $3 and r.ativo and r.deleted_at is null
         join core.produto p on p.id = r.relacionado_id
        where p.sku <> all($2::text[])
          and exists (select 1 from catalogo.cliente_tabela_preco ct join catalogo.tabela_preco_item ti on ti.tenant_id = ct.tenant_id and ti.tabela_preco_id = ct.tabela_preco_id
                       where ct.tenant_id = $1 and ct.cliente_id = $4 and ct.deleted_at is null and ti.produto_id = p.id and ti.deleted_at is null and ti.preco_cents > 0)
          and (select coalesce(sum(s.quantidade), 0) from catalogo.estoque_saldo s where s.tenant_id = $1 and s.produto_id = p.id and s.deleted_at is null) > 0
        order by o.n, r.ordem`,
      [TENANT_DEMO, origens, tipo, miniBox],
    );
    return [...new Set(r.map((x) => x.sku))].slice(0, limite);
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    for (const k of ['vendedor', 'admin'] as const) token[k] = (await api.sessao(DEMO[k])).access_token;
    const prods = await q<{ sku: string; id: string }>(
      "select sku, id from core.produto where tenant_id = $1 and sku in ('AGU-500', 'CAF-500', 'BIS-400', 'ACU-1K', 'FIL-103', 'LPO-400', 'AGU-1500') and deleted_at is null",
      [TENANT_DEMO],
    );
    for (const p of prods) sku[p.sku] = p.id;
    expect(Object.keys(sku).sort(), 'produtos da referência e relacionados na base demo').toEqual(['ACU-1K', 'AGU-1500', 'AGU-500', 'BIS-400', 'CAF-500', 'FIL-103', 'LPO-400']);
    miniBox = (await q<{ id: string }>("select id from core.cliente where tenant_id = $1 and external_id = 'C5110'", [TENANT_DEMO]))[0]?.id ?? '';
    expect(miniBox, 'Mini Box Japiim (C5110) na base demo').not.toBe('');
    await esperarHorizonte();
    lucas = await aparelhoCampo(api, DEMO.vendedor, { entidadesExtras: [entidadeProdutoRelacao, entidadeEstoqueSaldo] });
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
    expect((await lucas.motor.linhas('produto_relacao')).length, 'produto_relacao no aparelho').toBeGreaterThan(0);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('P4-0. o saldo (estoque_saldo) chega ao aparelho pelo pull', async () => {
    expect((await lucas.motor.linhas('estoque_saldo')).length, 'estoque_saldo no aparelho').toBeGreaterThan(0);
  });

  it('P4a. modo avião: "Combina com o pedido" = complementares do café (ordem do cadastro) e "Leve mais" = AGU-1500, com o preço do cliente; nada sai do aparelho', async () => {
    lucas.online.valor = false;
    const lotes = lucas.lotesEnviados.length;
    const chamadas = lucas.chamadasEtapas.length;
    try {
      const s = await sugestoes(['AGU-500', 'CAF-500', 'BIS-400']);
      const pedido = ['AGU-500', 'CAF-500', 'BIS-400'];
      const comp = await esperado(pedido, 'complementar');
      const sup = await esperado(pedido, 'superior');
      expect(comp.length, 'ao menos um complementar do café vendável na base demo').toBeGreaterThan(0);
      expect(comp.every((x) => ['ACU-1K', 'FIL-103', 'LPO-400'].includes(x))).toBe(true);
      expect(s.complementares.map((x) => skuDe(x.produto_id)), JSON.stringify(s)).toEqual(comp);
      expect(s.complementares.every((x) => x.tipo === 'complementar' && x.origem_produto_id === sku['CAF-500'])).toBe(true);
      expect(s.superiores.map((x) => skuDe(x.produto_id)), JSON.stringify(s)).toEqual(sup);
      expect(s.superiores.every((x) => x.tipo === 'superior' && x.origem_produto_id === sku['AGU-500'])).toBe(true);
      // preço = o que o próprio aparelho mostra para o cliente (catalogo.precos_cliente@1, offline)
      const todos = [...s.complementares, ...s.superiores];
      const precos = await lucas.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: miniBox, produto_ids: todos.map((x) => x.produto_id), em: new Date().toISOString() });
      const porId = new Map(precos.itens.map((i) => [i.produto_id, i.preco_cents]));
      expect(todos.map((x) => [skuDe(x.produto_id), x.preco_cents])).toEqual(todos.map((x) => [skuDe(x.produto_id), porId.get(x.produto_id)]));
      expect(todos.every((x) => x.preco_cents > 0)).toBe(true);
      expect([lucas.lotesEnviados.length, lucas.chamadasEtapas.length], 'sem rede: nada saiu do aparelho').toEqual([lotes, chamadas]);
    } finally {
      lucas.online.valor = true;
    }
  });

  it('P4b. o que já está no pedido não é sugerido (RN-CAT-06) e o limite corta a lista', async () => {
    lucas.online.valor = false;
    try {
      const comAcucar = await sugestoes(['CAF-500', 'ACU-1K']);
      expect(comAcucar.complementares.map((x) => skuDe(x.produto_id))).not.toContain('ACU-1K');
      expect(comAcucar.complementares.map((x) => skuDe(x.produto_id))).toEqual(await esperado(['CAF-500', 'ACU-1K'], 'complementar'));
      const um = await sugestoes(['CAF-500'], 1);
      expect(um.complementares.map((x) => skuDe(x.produto_id))).toEqual(await esperado(['CAF-500'], 'complementar', 1));
      expect(um.complementares.length).toBeLessThanOrEqual(1);
      const semRelacao = await sugestoes(['BIS-400']);
      expect(semRelacao, 'BIS-400 não tem relacionados').toEqual({ complementares: [], superiores: [] });
    } finally {
      lucas.online.valor = true;
    }
  });

  it('P4c. relação desativada no servidor: depois do pull a sugestão some também offline (servidor vence)', async () => {
    const antes = (await sugestoes(['AGU-500'])).superiores.map((x) => skuDe(x.produto_id));
    const [rel] = await q<{ id: string }>(
      "select id from catalogo.produto_relacao where tenant_id = $1 and produto_id = $2 and relacionado_id = $3 and tipo = 'superior'",
      [TENANT_DEMO, sku['AGU-500'], sku['AGU-1500']],
    );
    expect(rel, 'relação AGU-500 → AGU-1500 na base demo').toBeDefined();
    await api.admin.query('update catalogo.produto_relacao set ativo = false, updated_at = now() where id = $1', [rel!.id]);
    try {
      await sincronizar();
      lucas.online.valor = false;
      const depois = await sugestoes(['AGU-500']);
      expect(depois.superiores.map((x) => skuDe(x.produto_id)), JSON.stringify({ antes, depois })).not.toContain('AGU-1500');
      expect(depois.superiores.map((x) => skuDe(x.produto_id))).toEqual(await esperado(['AGU-500'], 'superior'));
    } finally {
      lucas.online.valor = true;
      await api.admin.query('update catalogo.produto_relacao set ativo = true, updated_at = now() where id = $1', [rel!.id]);
    }
    await sincronizar();
    expect((await sugestoes(['AGU-500'])).superiores.map((x) => skuDe(x.produto_id))).toEqual(await esperado(['AGU-500'], 'superior'));
  });

  it('P4d. Catálogo desligado para o usuário: a consulta fica indisponível no aparelho (RN-CORE-03), sem quebrar o pedido', async () => {
    expect((await licenca(api, token.admin, 'perfil', 'catalogo', false, 'vendedor')).statusCode).toBe(200);
    try {
      await sincronizar();
      await expect(sugestoes(['CAF-500'])).rejects.toThrow();
    } finally {
      expect((await licenca(api, token.admin, 'perfil', 'catalogo', true, 'vendedor')).statusCode).toBe(200);
    }
    await sincronizar();
    await expect(sugestoes(['CAF-500']), 'religado: a consulta volta').resolves.toBeDefined();
  });
});
