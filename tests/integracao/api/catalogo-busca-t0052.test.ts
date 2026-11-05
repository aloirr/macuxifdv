/**
 * T-0052 (Catálogo) — busca do catálogo na API REAL (`createApp` com os 8 módulos, JWT, Postgres como `macuxi_app`,
 * RLS) sobre a fixture dois-tenants, e no aparelho real (motor de sync × API). Agente `testes`; pedido
 * R-20261102-132611-3-modulo-catalogo, item 3 ("a busca na API com Fastify+Postgres").
 *
 * O que já está coberto e NÃO se repete aqui:
 *  - modules/catalogo/api/rotas.test.ts: as mesmas rotas com o repositório EM MEMÓRIA (IA, contingência, cota, chips,
 *    paginação, BKO de conteúdo, log sem o texto da busca);
 *  - tests/integracao/demo/smoke-demo.test.ts S2a/S2b: a frase da demo ("óleo para moto 150 cilindradas") na base demo;
 *  - tests/integracao/api/promotor-pedido.test.ts: promotor nunca escreve pedido (rotas e push, com e sem o Vendedor);
 *  - tests/modulos/catalogo-busca-offline-t0052.test.ts: busca offline com o FTS5 real (sem Postgres).
 *
 * Casos (matriz docs/testes/T-0052.md):
 *  B-A1 online: vendedor acha o produto do tenant com o preço da tabela do cliente; cliente fora da carteira = 403;
 *  B-A2 multi-tenant (RN-CAT-01): cada tenant só acha e só abre a ficha dos próprios produtos;
 *  B-A3 licença (RN-CORE-01/03): Catálogo desligado no tenant ou no usuário = 403 MODULO_INATIVO na hora (o mesmo
 *       token), sem afetar o outro tenant/usuário; religado, volta;
 *  B-A4 promotor (RN-CAT-04/05, regra 7): sem o Catálogo no perfil, 403; com ele, busca/vitrine/ficha só leitura, sem
 *       preço nem estoque (nem no pull), e toda escrita do Catálogo = 403 PERFIL_SEM_ACESSO;
 *  B-A5 aparelho real (motor × API): offline acha o produto do tenant, com o aviso, sem linhas do outro tenant;
 *  B-A6..B-A8 (DEFEITO T-0052-B3, corrigido pelo modulo-catalogo; R-20261105-131136-modulo-catalogo): sinônimos e
 *       estoque do Postgres na busca online e `sinonimo`/`produto_atributo` no pull. Antes rodavam como `it.fails`
 *       pela leitura do fonte do módulo; agora são `it` explícitos, sem depender da forma do código do Catálogo.
 */
import { ENTIDADES_CONTEUDO, FichaProduto, PaginaVitrine, RespostaBusca } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buscarLocal } from '../../../modules/catalogo/app/lib/local';
import { AVISO_BUSCA_OFFLINE } from '../../../modules/catalogo/domain/ia';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { aparelhoCampo } from '../apoio/campo';

const SKU = { a1: 'ALFA-001', a2: 'ALFA-002', b1: 'BETA-001' } as const;
const PROD = { a1: A.produtos.p1, b1: '' };

describe.skipIf(semBanco())('T-0052 — busca do Catálogo na API real (Postgres, RLS) e no aparelho', () => {
  let api: ApiDeTeste;
  const token: Record<'vA' | 'v2A' | 'vB' | 'adminA' | 'promotorA', string> = { vA: '', v2A: '', vB: '', adminA: '', promotorA: '' };

  const buscar = async (t: string, q: string, extra = '') => {
    const r = await api.chamar(t, { method: 'GET', url: `/v1/catalogo/busca?q=${encodeURIComponent(q)}&limit=20${extra}` });
    return r;
  };
  const skus = async (t: string, q: string, extra = '') => {
    const r = await buscar(t, q, extra);
    expect(r.statusCode, `busca "${q}": ${r.body}`).toBe(200);
    return RespostaBusca.parse(r.json()).items.map((i) => i.erp_code);
  };

  beforeAll(async () => {
    api = await subirApi();
    token.vA = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    token.v2A = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    token.vB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    token.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    token.promotorA = (await api.sessao('promotor@exemplo.com.br')).access_token;
    const [linha] = (await api.admin.query<{ id: string }>("select id from core.produto where sku = 'BETA-001'")).rows;
    PROD.b1 = linha!.id;
    // A fixture acabou de entrar (banco novo por arquivo, updated_at = now()). O pull só devolve linhas abaixo do horizonte
    // seguro (`least(now() - 2 s, transação aberta mais antiga)`, apps/api/src/banco.ts; ADR 0009): sem esta espera, os
    // pulls de B-A4 (contraprova do vendedor), B-A5 e B-A7 vinham vazios POR DESENHO (CI 42079451544, job 127428720479:
    // `expected 0 to be greater than 0`, `expected undefined to be 'ALFA-001'`, `expected [] to deeply equal [ 'pastilha' ]`),
    // e o pull vazio do promotor em B-A4 passaria no vazio. Mesma causa do O-06 da T-0083.
    const [carga] = (await api.admin.query<{ agora: Date }>('select clock_timestamp() as agora')).rows;
    await esperarHorizonte(token.vA, carga!.agora);
  });

  /** Espera o `horizonte` da resposta do pull (relógio do banco) passar de `instante`. */
  const esperarHorizonte = async (t: string, instante: Date, prazoMs = 20_000) => {
    const fim = Date.now() + prazoMs;
    let ultimo = '';
    while (Date.now() < fim) {
      const r = await api.chamar(t, { method: 'GET', url: '/v1/sync/pull?entidade=sinonimo' });
      ultimo = String((r.json() as { horizonte?: string }).horizonte ?? '');
      if (r.statusCode === 200 && Date.parse(ultimo) > instante.getTime()) return;
      await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error(`horizonte do pull (${ultimo}) não passou de ${instante.toISOString()} em ${prazoMs} ms`);
  };
  afterAll(async () => {
    await api?.fechar();
  });

  it('B-A1 (RF-CAT-01, RN-CAT-06, RN-CORE-04): online, o vendedor acha o produto com o preço da tabela do cliente; cliente fora da carteira = 403 FORA_DA_CARTEIRA', async () => {
    const r = await buscar(token.vA, 'pastilha de freio', `&customer_id=${A.clientes.c1}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = RespostaBusca.parse(r.json());
    expect(b.items[0]?.erp_code, JSON.stringify(b.items.map((i) => i.erp_code))).toBe(SKU.a1);
    expect(b.items[0]).toMatchObject({ price_stock_visible: true });
    expect(b.items[0]!.price?.price_cents, 'preço da tabela padrão de A (R$ 1.000,00)').toBe(100_000);
    // sem provedor de IA no teste: regras locais, sem aviso de contingência
    expect(['regras', 'nenhum']).toContain(b.interpreted_by);
    // c2 é da carteira do vendedor 2, não do 1; o cliente de B nem existe para A
    for (const c of [A.clientes.c2, B.clientes.c1]) {
      const fora = await buscar(token.vA, 'pastilha', `&customer_id=${c}`);
      expect([fora.statusCode, erroDe(fora).codigo], c).toEqual([403, 'FORA_DA_CARTEIRA']);
    }
    // entrada inválida continua 400 na API real (Zod antes da rota)
    expect((await api.chamar(token.vA, { method: 'GET', url: '/v1/catalogo/busca?q=' })).statusCode).toBe(400);
  });

  it('B-A2 (RN-CAT-01, multi-tenant): cada tenant só acha e só abre a ficha dos próprios produtos (RLS)', async () => {
    expect(await skus(token.vA, 'pastilha')).toContain(SKU.a1);
    expect(await skus(token.vA, 'oleo 5w30'), 'A não acha o óleo de B').not.toContain(SKU.b1);
    expect(await skus(token.vA, 'BETA-001'), 'nem pelo código').not.toContain(SKU.b1);
    expect(await skus(token.vB, 'oleo'), 'B acha o próprio óleo').toContain(SKU.b1);
    const deB = await skus(token.vB, 'pastilha de freio');
    expect(deB, 'B não acha a pastilha de A').not.toContain(SKU.a1);
    expect(await skus(token.vB, 'ALFA-001')).not.toContain(SKU.a1);
    // ficha: a do próprio tenant abre; a do outro = 404 sem dizer se existe
    const propria = await api.chamar(token.vA, { method: 'GET', url: `/v1/catalogo/produtos/${PROD.a1}` });
    expect(propria.statusCode, propria.body).toBe(200);
    expect(FichaProduto.parse(propria.json()).product.erp_code).toBe(SKU.a1);
    for (const [t, id] of [
      [token.vA, PROD.b1],
      [token.vB, PROD.a1],
    ] as const) {
      const r = await api.chamar(t, { method: 'GET', url: `/v1/catalogo/produtos/${id}` });
      expect([r.statusCode, erroDe(r).codigo]).toEqual([404, 'PRODUTO_NAO_ENCONTRADO']);
    }
  });

  it('B-A3 (RN-CORE-01/03): Catálogo desligado no tenant = 403 MODULO_INATIVO na hora (mesmo token), sem afetar B; no usuário, só ele perde; religado, volta', async () => {
    expect((await licenca(api, token.adminA, 'tenant', 'catalogo', false)).statusCode).toBe(200);
    try {
      for (const t of [token.vA, token.v2A]) {
        const r = await buscar(t, 'pastilha');
        expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([403, 'MODULO_INATIVO']);
        expect(erroDe(r)).toMatchObject({ detalhes: { modulo: 'catalogo' } });
      }
      const ficha = await api.chamar(token.vA, { method: 'GET', url: `/v1/catalogo/produtos/${PROD.a1}` });
      expect([ficha.statusCode, erroDe(ficha).codigo]).toEqual([403, 'MODULO_INATIVO']);
      expect(await skus(token.vB, 'oleo'), 'o outro tenant não é afetado').toContain(SKU.b1);
    } finally {
      expect((await licenca(api, token.adminA, 'tenant', 'catalogo', true)).statusCode).toBe(200);
    }
    expect(await skus(token.vA, 'pastilha')).toContain(SKU.a1);

    expect((await licenca(api, token.adminA, 'usuario', 'catalogo', false, A.usuarios.vendedor2)).statusCode).toBe(200);
    try {
      const r = await buscar(token.v2A, 'pastilha');
      expect([r.statusCode, erroDe(r).codigo]).toEqual([403, 'MODULO_INATIVO']);
      expect(await skus(token.vA, 'pastilha'), 'o vendedor 1 continua').toContain(SKU.a1);
    } finally {
      expect((await licenca(api, token.adminA, 'usuario', 'catalogo', true, A.usuarios.vendedor2)).statusCode).toBe(200);
    }
    expect(ids(await api.meusModulos(token.v2A))).toContain('catalogo');
    expect(await skus(token.v2A, 'pastilha')).toContain(SKU.a1);
  });

  describe('B-A4 promotor (RN-CAT-04/05, regra 7)', () => {
    it('sem o Catálogo no perfil (fixture), a busca do promotor = 403 MODULO_INATIVO', async () => {
      expect(ids(await api.meusModulos(token.promotorA))).not.toContain('catalogo');
      const r = await buscar(token.promotorA, 'pastilha');
      expect([r.statusCode, erroDe(r).codigo]).toEqual([403, 'MODULO_INATIVO']);
    });

    describe('com o Catálogo no perfil do promotor', () => {
      beforeAll(async () => {
        expect((await licenca(api, token.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      });
      afterAll(async () => {
        expect((await licenca(api, token.adminA, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
      });

      it('busca, vitrine e ficha respondem 200 sem preço nem estoque, com e sem o cliente da carteira dele', async () => {
        for (const extra of ['', `&customer_id=${A.clientes.c1}`]) {
          const r = await buscar(token.promotorA, 'pastilha de freio', extra);
          expect(r.statusCode, r.body).toBe(200);
          const b = RespostaBusca.parse(r.json());
          expect(b.items.map((i) => i.erp_code)).toContain(SKU.a1);
          for (const i of b.items) expect(i, `busca${extra}`).toMatchObject({ price_stock_visible: false, price: null, availability: null });
        }
        const vitrine = await api.chamar(token.promotorA, { method: 'GET', url: `/v1/catalogo/produtos?limit=20&customer_id=${A.clientes.c1}` });
        expect(vitrine.statusCode, vitrine.body).toBe(200);
        for (const i of PaginaVitrine.parse(vitrine.json()).items) expect(i).toMatchObject({ price_stock_visible: false, price: null, availability: null });
        const ficha = await api.chamar(token.promotorA, { method: 'GET', url: `/v1/catalogo/produtos/${PROD.a1}?customer_id=${A.clientes.c1}` });
        expect(ficha.statusCode, ficha.body).toBe(200);
        expect(FichaProduto.parse(ficha.json()).product).toMatchObject({ erp_code: SKU.a1, price_stock_visible: false, price: null, availability: null });
        // o cliente fora da carteira do promotor continua barrado
        const fora = await buscar(token.promotorA, 'pastilha', `&customer_id=${A.clientes.c2}`);
        expect([fora.statusCode, erroDe(fora).codigo]).toEqual([403, 'FORA_DA_CARTEIRA']);
      });

      it('o preço e o estoque nem chegam ao aparelho dele: pull de tabela_preco_item, cliente_tabela_preco e estoque_saldo vem vazio', async () => {
        for (const entidade of ['tabela_preco_item', 'cliente_tabela_preco', 'estoque_saldo']) {
          const r = await api.chamar(token.promotorA, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
          expect(r.statusCode, `${entidade}: ${r.body}`).toBe(200);
          expect(r.json().itens, entidade).toEqual([]);
        }
        // contraprova (RN-CAT-05): o vendedor do mesmo tenant recebe as três pelo mesmo pull — senão o vazio acima seria o
        // horizonte, não a regra
        for (const entidade of ['tabela_preco_item', 'cliente_tabela_preco', 'estoque_saldo']) {
          const v = await api.chamar(token.vA, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
          expect(v.statusCode, `${entidade}: ${v.body}`).toBe(200);
          expect((v.json().itens as unknown[]).length, `vendedor: ${entidade}`).toBeGreaterThan(0);
        }
      });

      it('toda rota de ESCRITA do Catálogo dá 403 PERFIL_SEM_ACESSO ao promotor (o Catálogo não tem rota de pedido)', async () => {
        const catalogo = api.modulos.find((m) => m.manifesto.id === 'catalogo')!;
        const rotas = catalogo.rotas ?? [];
        expect(rotas.some((r) => /pedido/i.test(r.caminho) || /^pedido\./.test(r.acao ?? '')), 'rota de pedido no Catálogo').toBe(false);
        const escrita = rotas.filter((r) => r.metodo !== 'GET');
        expect(escrita.length).toBeGreaterThan(0);
        for (const r of escrita) {
          const url = `/v1/catalogo/${r.caminho.replace(/:[a-zA-Z_]+/g, PROD.a1)}`;
          const resp = await api.chamar(token.promotorA, { method: r.metodo, url, payload: { term: 'x', synonyms: ['y'], active: true } });
          expect([resp.statusCode, erroDe(resp).codigo], `${r.metodo} ${r.caminho}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
        }
      });
    });
  });

  it('B-A5 (RF-CAT-02, RN-CAT-01): aparelho real do vendedor — sincroniza com a API, e em modo avião acha o produto do tenant, com o aviso; nenhuma linha de B no aparelho', async () => {
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { entidadesExtras: [...ENTIDADES_CONTEUDO] });
    expect(await ap.sincronizar()).toBe(true);
    ap.online.valor = false;
    const r = await buscarLocal(ap.motor, { perfil: 'vendedor', parametros: ap.motor.parametros('catalogo'), agora: new Date().toISOString(), clienteId: A.clientes.c1, q: 'pastilha de freio', limit: 20, offset: 0, offline: true });
    expect(r.items.map((i) => i.erp_code)[0]).toBe(SKU.a1);
    expect(r.aviso).toBe(AVISO_BUSCA_OFFLINE);
    expect(r.items[0]!.price?.price_cents, 'preço da tabela do cliente no aparelho').toBe(100_000);
    const produtos = (await ap.motor.linhas('produto')).map((p) => p.id);
    expect(produtos).toContain(PROD.a1);
    expect(produtos, 'produto de B no aparelho de A').not.toContain(PROD.b1);
    expect((await buscarLocal(ap.motor, { perfil: 'vendedor', parametros: {}, agora: new Date().toISOString(), clienteId: null, q: 'BETA-001', limit: 20, offset: 0, offline: true })).items).toEqual([]);
  });

  it(
    'B-A6 (RF-CAT-02) online: o sinônimo do tenant vale na busca da API ("sapata" → pastilha; catalogo.sinonimo de A)',
    async () => {
      expect(await skus(token.vA, 'sapata')).toContain(SKU.a1);
      // o sinônimo de A não vale em B ("lona"/"sapata" são de A; "lubrificante" ↔ "oleo" é de B)
      expect(await skus(token.vB, 'lubrificante')).toContain(SKU.b1);
      expect(await skus(token.vA, 'lubrificante')).not.toContain(SKU.a2);
    },
  );

  it(
    'B-A7 (RF-CAT-02) offline: sinônimo e atributo do tenant chegam ao aparelho pelo pull e valem sem sinal',
    async () => {
      const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { entidadesExtras: [...ENTIDADES_CONTEUDO] });
      expect(await ap.sincronizar()).toBe(true);
      ap.online.valor = false;
      const sin = await ap.motor.linhas<{ termo: string } & { id: string; updated_at: string; deleted_at: string | null }>('sinonimo');
      expect(sin.map((s) => s.termo), 'sinônimos de A (e só de A)').toEqual(['pastilha']);
      expect((await ap.motor.linhas('produto_atributo')).length, 'atributos de A').toBe(1);
      const entrada = { perfil: 'vendedor' as const, parametros: {}, agora: new Date().toISOString(), clienteId: A.clientes.c1, limit: 20, offset: 0, offline: true };
      expect((await buscarLocal(ap.motor, { ...entrada, q: 'sapata' })).items.map((i) => i.erp_code)).toContain(SKU.a1);
      expect((await buscarLocal(ap.motor, { ...entrada, q: 'pastilha cilindrada 150' })).items.map((i) => i.erp_code)[0]).toBe(SKU.a1);
    },
  );

  it(
    'B-A8 (RN-CAT-07) online: a busca do vendedor mostra o estoque do ERP (catalogo.estoque_saldo: 15 no CD Manaus) com a hora da atualização',
    async () => {
      const r = await buscar(token.vA, 'pastilha', `&customer_id=${A.clientes.c1}`);
      const item = RespostaBusca.parse(r.json()).items.find((i) => i.erp_code === SKU.a1)!;
      expect(item.availability?.quantity).toBe(15);
      expect(item.availability?.updated_at).not.toBeNull();
    },
  );
});
