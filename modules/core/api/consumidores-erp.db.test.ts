/**
 * T-0066 × Postgres real (fixture dois-tenants, RLS): consumidores dos eventos `integracao.<entidade>.atualizado@1` no Core
 * (vendedor, cliente com carteira/contatos/financeiro, produto, título e rota). Cada caso roda numa transação desfeita no
 * fim (nada fica no banco). Cobre idempotência (reentrega não duplica), inativação, referência ausente (RN-INT-04) e
 * isolamento por tenant. O ciclo da outbox em si é do teste de `apps/api`. Pula sem Postgres.
 */
import { completarCnpj } from '@macuxi/comum/documento';
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ConsumidorEvento, ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { consumidoresDoErp } from './consumidores-erp';
import { ReferenciaAusenteErp } from './erp-apoio';
import { moduloApi } from './index';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const CNPJ1 = completarCnpj('990000010001');
const CNPJ2 = completarCnpj('990000020001');
const AGORA = new Date('2026-11-04T15:00:00Z'); // quarta-feira (Manaus: 11:00)
const pool = () => poolDoTeste!;
let poolDoTeste: pg.Pool | undefined;

const consumidor = (evento: string): ConsumidorEvento => {
  const c = consumidoresDoErp.find((x) => x.evento.nome === evento);
  if (!c) throw new Error(`sem consumidor para ${evento}`);
  return c;
};

describe('T-0066: manifesto e moduloApi ligam os consumidores do ERP', () => {
  it('RN-INT-04: o Core declara e expõe um consumidor para cada evento do ERP que ele dono', () => {
    const nomes = ['cliente', 'produto', 'vendedor', 'titulo', 'rota'].map((e) => `integracao.${e}.atualizado@1`);
    for (const n of nomes) {
      expect(manifest.consome).toContain(n);
      expect(moduloApi.consumidores?.map((c) => c.evento.nome)).toContain(n);
    }
  });
});

describe.skipIf(semBanco())('Core T-0066 × Postgres: consumidores do ERP', () => {
  beforeAll(() => {
    poolDoTeste = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await poolDoTeste?.end();
  });

  /** Transação do tenant desfeita no fim: `entregar` roda o consumidor como o despachante (mesma transação). */
  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>): Promise<void> {
    const c = await pool().connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      const publicar = vi.fn(async () => ({}));
      const warn = vi.fn();
      const entregar = async (evento: string, payload: unknown, agora = AGORA) => {
        const cons = consumidor(evento);
        const ctx = {
          db: c,
          agora: () => agora,
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          envelope: { evento_id: 'x', tenant_id: tenant },
          publicar,
          consultar: vi.fn(),
          log: { info: vi.fn(), warn, error: vi.fn() },
        } as unknown as ContextoConsumo;
        await cons.executar(cons.evento.schema.parse(payload), ctx);
      };
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      await fn({ entregar, q, publicar, warn });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }
  interface Teste {
    entregar(evento: string, payload: unknown, agora?: Date): Promise<void>;
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    publicar: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  }

  const ev = (entidade: string, external_id: string, registro: Record<string, unknown> | undefined, acao: 'criado' | 'atualizado' | 'inativado' = 'criado') => ({
    lote_id: '0e500000-0000-4000-8000-000000000001',
    entidade,
    external_id,
    acao,
    hash: 'h',
    ...(registro ? { registro: { external_id, alterado_em: '2026-11-04T10:00:00Z', ativo: true, ...registro } } : {}),
    ocorrido_em: '2026-11-04T10:00:00Z',
  });
  const vendedor = (id = 'V-T66', extra: Record<string, unknown> = {}) => ev('vendedor', id, { nome: 'Vendedor ERP', email: `${id.toLowerCase()}@erp.exemplo.com.br`, ...extra });
  const cliente = (id = 'C-T66', extra: Record<string, unknown> = {}) =>
    ev('cliente', id, {
      razao_social: 'Mercado do Teste',
      documento: CNPJ1,
      inscricao_estadual: 'ISENTO',
      endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' },
      vendedor_external_id: 'V-T66',
      limite_credito_cents: 500_000,
      bloqueado: false,
      contatos: [{ nome: 'Ana', telefone: '95999990000' }, { nome: 'Bia' }],
      ...extra,
    });

  describe('vendedor', () => {
    it('RN-INT-02: cria o usuário vendedor sem senha; reentrega e atualização não duplicam; inativação bloqueia', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-T66', { nome: 'Vendedor Renomeado' }), AGORA);
        const u = await t.q<{ nome: string; perfil: string; senha_hash: string | null; ativo: boolean }>("select nome, perfil, senha_hash, ativo from core.usuario where external_id = 'V-T66'");
        expect(u).toEqual([{ nome: 'Vendedor Renomeado', perfil: 'vendedor', senha_hash: null, ativo: true }]);
        await t.entregar('integracao.vendedor.atualizado@1', ev('vendedor', 'V-T66', undefined, 'inativado'));
        expect((await t.q<{ ativo: boolean }>("select ativo from core.usuario where external_id = 'V-T66'"))[0]?.ativo).toBe(false);
      });
    });

    it('RN-INT-02: sem e-mail ou com e-mail de outro usuário, entra com e-mail provisório (único e válido)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        const existente = (await t.q<{ email: string }>('select email from core.usuario where id = $1', [A.usuarios.admin]))[0]!.email;
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-SEM', { email: null }));
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-DUP', { email: existente }));
        const r = await t.q<{ external_id: string; email: string }>("select external_id, email from core.usuario where external_id in ('V-SEM','V-DUP') order by external_id");
        expect(r).toHaveLength(2);
        for (const x of r) expect(x.email).toMatch(/@sem-email\.invalid$/);
        expect(new Set(r.map((x) => x.email)).size).toBe(2);
      });
    });

    it('RN-INT-02: usuário já cadastrado com o mesmo e-mail, sem external_id, é adotado (mantém id e perfil)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        const antes = (await t.q<{ email: string; perfil: string }>('select email, perfil from core.usuario where id = $1', [A.usuarios.vendedor2]))[0]!;
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-ADOTA', { email: antes.email }));
        const r = await t.q<{ id: string; perfil: string }>("select id, perfil from core.usuario where external_id = 'V-ADOTA'");
        expect(r).toEqual([{ id: A.usuarios.vendedor2, perfil: antes.perfil }]);
      });
    });

    it('RN-CORE-05: o vendedor entra só no tenant do evento', async () => {
      await emTransacao(B.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-T66-B'));
        expect((await t.q("select 1 from core.usuario where external_id = 'V-T66-B'")).length).toBe(1);
      });
      await emTransacao(A.tenantId, async (t) => {
        expect((await t.q("select 1 from core.usuario where external_id = 'V-T66-B'")).length).toBe(0);
      });
    });
  });

  describe('cliente: carteira, contatos e financeiro', () => {
    it('RN-INT-04: vendedor ainda ausente lança referência ausente e não grava o cliente', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await expect(t.entregar('integracao.cliente.atualizado@1', cliente())).rejects.toBeInstanceOf(ReferenciaAusenteErp);
      });
    });

    it('RN-CORE-04/RN-INT-02: grava cadastro, carteira, contatos e financeiro; reentrega não duplica nada', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.cliente.atualizado@1', cliente());
        await t.entregar('integracao.cliente.atualizado@1', cliente());
        const c = (await t.q<{ id: string }>("select id from core.cliente where external_id = 'C-T66'"));
        expect(c).toHaveLength(1);
        const id = c[0]!.id;
        const cart = await t.q<{ papel: string; ext: string; vend: string }>("select ca.papel, ca.external_id as ext, u.external_id as vend from core.carteira ca join core.usuario u on u.id = ca.usuario_id where ca.cliente_id = $1 and ca.deleted_at is null", [id]);
        expect(cart).toEqual([{ papel: 'vendedor', ext: 'C-T66', vend: 'V-T66' }]);
        const ct = await t.q<{ nome: string; principal: boolean }>('select nome, principal from core.cliente_contato where cliente_id = $1 and deleted_at is null order by external_id', [id]);
        expect(ct).toEqual([{ nome: 'Ana', principal: true }, { nome: 'Bia', principal: false }]);
        const fin = await t.q<{ limite_cents: string; bloqueado: boolean; saldo_aberto_cents: string }>('select limite_cents, bloqueado, saldo_aberto_cents from core.cliente_financeiro where cliente_id = $1 and deleted_at is null', [id]);
        expect(fin).toEqual([{ limite_cents: '500000', bloqueado: false, saldo_aberto_cents: '0' }]);
        expect(t.publicar).toHaveBeenCalled();
      });
    });

    it('RN-INT-02: troca de vendedor encerra o vínculo do ERP anterior; contato removido e bloqueio chegam; vínculo manual fica', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-T66-2'));
        await t.entregar('integracao.cliente.atualizado@1', cliente());
        const id = (await t.q<{ id: string }>("select id from core.cliente where external_id = 'C-T66'"))[0]!.id;
        await t.q("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'promotor')", [id, A.usuarios.promotor]);
        await t.entregar('integracao.cliente.atualizado@1', cliente('C-T66', { vendedor_external_id: 'V-T66-2', contatos: [{ nome: 'Ana' }], bloqueado: true, limite_credito_cents: 100 }));
        const cart = await t.q<{ papel: string; vend: string | null }>("select ca.papel, u.external_id as vend from core.carteira ca join core.usuario u on u.id = ca.usuario_id where ca.cliente_id = $1 and ca.deleted_at is null order by ca.papel", [id]);
        expect(cart).toEqual([{ papel: 'promotor', vend: null }, { papel: 'vendedor', vend: 'V-T66-2' }]);
        expect((await t.q('select 1 from core.cliente_contato where cliente_id = $1 and deleted_at is null', [id])).length).toBe(1);
        const fin = (await t.q<{ limite_cents: string; bloqueado: boolean }>('select limite_cents, bloqueado from core.cliente_financeiro where cliente_id = $1 and deleted_at is null', [id]))[0];
        expect(fin).toEqual({ limite_cents: '100', bloqueado: true });
        // vendedor some do payload: o vínculo do ERP termina
        await t.entregar('integracao.cliente.atualizado@1', cliente('C-T66', { vendedor_external_id: null }));
        expect((await t.q("select 1 from core.carteira where cliente_id = $1 and papel = 'vendedor' and deleted_at is null", [id])).length).toBe(0);
      });
    });

    it('RN-INT-06: inativação do cliente marca ativo = false', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.cliente.atualizado@1', cliente());
        await t.entregar('integracao.cliente.atualizado@1', ev('cliente', 'C-T66', undefined, 'inativado'));
        expect((await t.q<{ ativo: boolean }>("select ativo from core.cliente where external_id = 'C-T66'"))[0]?.ativo).toBe(false);
      });
    });
  });

  describe('T-0095: guarda de ordem e desligamento no BKO', () => {
    const ANTIGO = '2026-11-04T09:00:00Z';
    const NOVO = '2026-11-04T11:00:00Z';
    it('RN-INT-02: vendedor reentregue fora de ordem (antigo depois do novo) não sobrescreve; o mais novo vence', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-ORD', { nome: 'Nome Novo', alterado_em: NOVO }));
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-ORD', { nome: 'Nome Antigo', alterado_em: ANTIGO }));
        expect((await t.q<{ nome: string }>("select nome from core.usuario where external_id = 'V-ORD'"))[0]?.nome).toBe('Nome Novo');
      });
    });
    it('RN-INT-02: vendedor desligado no BKO não volta com a carga do ERP; o admin recebe aviso', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-OFF', { alterado_em: ANTIGO }));
        await t.q("update core.usuario set ativo = false, desligado_no_bko_em = '2026-11-04T10:30:00Z' where external_id = 'V-OFF'");
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-OFF', { nome: 'Renomeado', alterado_em: NOVO }));
        const u = await t.q<{ ativo: boolean; nome: string }>("select ativo, nome from core.usuario where external_id = 'V-OFF'");
        expect(u).toEqual([{ ativo: false, nome: 'Renomeado' }]);
        expect(t.warn).toHaveBeenCalled();
      });
    });
    it('RN-INT-02 (T-0095): o aviso de vendedor desligado sai uma vez por versão do registro, não a cada carga', async () => {
      await emTransacao(A.tenantId, async (t) => {
        const avisos = async () => (await t.q<{ n: string }>("select count(*)::text as n from core.notificacao where titulo = 'Vendedor do ERP segue desligado' and corpo like '%V-AVISO1%'"))[0]!.n;
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-AVISO1', { alterado_em: ANTIGO }));
        await t.q("update core.usuario set ativo = false, desligado_no_bko_em = '2026-11-04T10:30:00Z' where external_id = 'V-AVISO1'");
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-AVISO1', { alterado_em: NOVO }));
        const unico = Number(await avisos());
        expect(unico).toBeGreaterThan(0);
        // carga completa repetida do mesmo registro: sem aviso novo
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-AVISO1', { alterado_em: NOVO }));
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-AVISO1', { alterado_em: NOVO }));
        expect(Number(await avisos())).toBe(unico);
        // o ERP alterou o registro de novo: aviso novo
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-AVISO1', { alterado_em: '2026-11-04T12:00:00Z' }));
        expect(Number(await avisos())).toBe(unico * 2);
        expect((await t.q<{ ativo: boolean }>("select ativo from core.usuario where external_id = 'V-AVISO1'"))[0]?.ativo).toBe(false);
      });
    });
    it('RN-INT-02 (T-0095): a adoção por e-mail não reativa quem o admin desligou no BKO', async () => {
      await emTransacao(A.tenantId, async (t) => {
        const antes = (await t.q<{ email: string }>('select email from core.usuario where id = $1', [A.usuarios.vendedor2]))[0]!;
        await t.q('update core.usuario set ativo = false, desligado_no_bko_em = now() where id = $1', [A.usuarios.vendedor2]);
        await t.entregar('integracao.vendedor.atualizado@1', vendedor('V-ADOTA-OFF', { email: antes.email }));
        const r = await t.q<{ external_id: string; ativo: boolean }>('select external_id, ativo from core.usuario where id = $1', [A.usuarios.vendedor2]);
        expect(r).toEqual([{ external_id: 'V-ADOTA-OFF', ativo: false }]);
      });
    });
    it('RN-INT-02 (T-0095): inativação sem registro (só o relógio do Hub) inativa sem avançar o erp_alterado_em; com registro, compara o do ERP', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.cliente.atualizado@1', cliente('C-HUB', { alterado_em: NOVO }));
        await t.entregar('integracao.cliente.atualizado@1', ev('cliente', 'C-HUB', undefined, 'inativado'));
        const c = await t.q<{ ativo: boolean; erp: string }>("select ativo, erp_alterado_em::text as erp from core.cliente where external_id = 'C-HUB'");
        expect(c[0]?.ativo).toBe(false);
        expect(Date.parse(c[0]!.erp)).toBe(Date.parse(NOVO));
        const prod = (extra: Record<string, unknown>) => ev('produto', 'P-HUB', { sku: 'SKU-HUB', nome: 'x', unidade: 'un', ...extra });
        await t.entregar('integracao.produto.atualizado@1', prod({ alterado_em: NOVO }));
        await t.entregar('integracao.produto.atualizado@1', ev('produto', 'P-HUB', undefined, 'inativado'));
        const p = await t.q<{ ativo: boolean; erp: string }>("select ativo, erp_alterado_em::text as erp from core.produto where external_id = 'P-HUB'");
        expect(p[0]?.ativo).toBe(false);
        expect(Date.parse(p[0]!.erp)).toBe(Date.parse(NOVO));
      });
    });
    it('RN-INT-02: cliente reentregue fora de ordem não sobrescreve; o mais novo vence', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await t.entregar('integracao.cliente.atualizado@1', cliente('C-ORD', { razao_social: 'Novo', alterado_em: NOVO }));
        await t.entregar('integracao.cliente.atualizado@1', cliente('C-ORD', { razao_social: 'Antigo', alterado_em: ANTIGO }));
        expect((await t.q<{ razao_social: string }>("select razao_social from core.cliente where external_id = 'C-ORD'"))[0]?.razao_social).toBe('Novo');
      });
    });
    it('RN-INT-02: produto reentregue fora de ordem não sobrescreve; o mais novo vence', async () => {
      await emTransacao(A.tenantId, async (t) => {
        const prod = (extra: Record<string, unknown>) => ev('produto', 'P-ORD', { sku: 'SKU-ORD', nome: 'x', unidade: 'un', ...extra });
        await t.entregar('integracao.produto.atualizado@1', prod({ nome: 'Novo', alterado_em: NOVO }));
        await t.entregar('integracao.produto.atualizado@1', prod({ nome: 'Antigo', alterado_em: ANTIGO }));
        expect((await t.q<{ nome: string }>("select nome from core.produto where external_id = 'P-ORD'"))[0]?.nome).toBe('Novo');
      });
    });
  });

  describe('produto', () => {
    const produto = (extra: Record<string, unknown> = {}) => ev('produto', 'P-T66', { sku: 'SKU-T66', nome: 'Arroz 5kg', marca: 'Boa', categoria: 'Grãos', unidade: 'pct', ean: '7891234567895', ...extra });
    it('RN-CORE-18 (T-0177): marca_codigo ausente não altera, null/vazio limpa, texto é aparado e o outro tenant não o enxerga', async () => {
      const lerMarca = async (t: Teste) => (await t.q<{ marca_codigo: string | null }>("select marca_codigo from core.produto where external_id = 'P-T66'"))[0]?.marca_codigo;
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: ' 980 ' }));
        expect(await lerMarca(t)).toBe('980');
        await t.entregar('integracao.produto.atualizado@1', produto({ nome: 'Sem o campo' }));
        expect(await lerMarca(t)).toBe('980');
        await t.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: '   ' }));
        expect(await lerMarca(t)).toBeNull();
        await t.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: '981' }));
        await t.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: null }));
        expect(await lerMarca(t)).toBeNull();
        await t.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: '982' }));
        expect(await lerMarca(t)).toBe('982');
        // dentro do mesmo teste, o tenant B (outra transação) não vê nem altera o do A
        await emTransacao(B.tenantId, async (tb) => {
          expect(await lerMarca(tb)).toBeUndefined();
          await tb.entregar('integracao.produto.atualizado@1', produto({ marca_codigo: 'B-1' }));
          expect(await lerMarca(tb)).toBe('B-1');
        });
        expect(await lerMarca(t)).toBe('982');
      });
    });
    it('RN-INT-02/RN-CORE-18: upsert idempotente, mantém custo e preço de venda, inativa pelo evento', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto());
        await t.q("update core.produto set custo_cents = 700, preco_venda_cents = 1000, desconto_maximo_pct = 15 where external_id = 'P-T66'");
        await t.entregar('integracao.produto.atualizado@1', produto({ nome: 'Arroz 5kg Tipo 1' }), AGORA);
        const p = await t.q<{ nome: string; unidade: string; custo_cents: string; preco_venda_cents: string }>("select nome, unidade, custo_cents, preco_venda_cents from core.produto where external_id = 'P-T66'");
        expect(p).toEqual([{ nome: 'Arroz 5kg Tipo 1', unidade: 'PCT', custo_cents: '700', preco_venda_cents: '1000' }]);
        await t.entregar('integracao.produto.atualizado@1', ev('produto', 'P-T66', undefined, 'inativado'));
        expect((await t.q<{ ativo: boolean }>("select ativo from core.produto where external_id = 'P-T66'"))[0]?.ativo).toBe(false);
      });
    });

    it('RN-INT-02: SKU de outro produto do ERP não é sobrescrito (ignora com aviso); SKU de cadastro sem external_id é adotado', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto());
        await t.entregar('integracao.produto.atualizado@1', ev('produto', 'P-OUTRO', { sku: 'SKU-T66', nome: 'Outro', unidade: 'UN' }));
        expect(t.warn).toHaveBeenCalled();
        expect((await t.q("select 1 from core.produto where external_id = 'P-OUTRO'")).length).toBe(0);
        await t.q("insert into core.produto (tenant_id, sku, nome) values (plataforma.tenant_atual(), 'SKU-MANUAL', 'Manual')");
        await t.entregar('integracao.produto.atualizado@1', ev('produto', 'P-MANUAL', { sku: 'SKU-MANUAL', nome: 'Manual ERP', unidade: 'UN' }));
        expect((await t.q<{ nome: string }>("select nome from core.produto where sku = 'SKU-MANUAL'"))).toEqual([{ nome: 'Manual ERP' }]);
      });
    });
  });

  describe('produto: medida e embalagem (RN-CORE-19)', () => {
    const produto = (extra: Record<string, unknown> = {}) => ev('produto', 'P-T63', { sku: 'SKU-T63', nome: 'Refrigerante 2L', unidade: 'un', ...extra });
    const lerEmbalagem = (t: Teste) => t.q<{ unidade: string; embalagem_medida: string | null; embalagem_quantidade: number | null }>("select unidade, embalagem_medida, embalagem_quantidade from core.produto where external_id = 'P-T63'");

    it('RN-CORE-19: produto do ERP com embalagem_medida CX e embalagem_quantidade 12 grava os dois campos', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto({ embalagem_medida: 'cx', embalagem_quantidade: 12 }));
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }]);
      });
    });

    it('RN-CORE-19: evento sem embalagem NÃO apaga a embalagem cadastrada no BKO; evento com embalagem a substitui', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto());
        await t.q("update core.produto set embalagem_medida = 'FD', embalagem_quantidade = 6 where external_id = 'P-T63'");
        await t.entregar('integracao.produto.atualizado@1', produto({ nome: 'Refrigerante 2L Gelado' }), AGORA);
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'UN', embalagem_medida: 'FD', embalagem_quantidade: 6 }]);
        await t.entregar('integracao.produto.atualizado@1', produto({ embalagem_medida: 'CX', embalagem_quantidade: 12 }), AGORA);
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 }]);
      });
    });

    it('RN-CORE-19: se a unidade passa a ser igual à embalagem guardada, a embalagem é limpa (sem violar o banco)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto());
        await t.q("update core.produto set embalagem_medida = 'CX', embalagem_quantidade = 6 where external_id = 'P-T63'");
        await t.entregar('integracao.produto.atualizado@1', produto({ unidade: 'CX' }), AGORA);
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'CX', embalagem_medida: null, embalagem_quantidade: null }]);
      });
    });

    it('RN-CORE-19: medida da unidade não cadastrada no tenant = referência ausente reprocessável (nada é gravado)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await expect(t.entregar('integracao.produto.atualizado@1', produto({ unidade: 'zz' }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        expect(await lerEmbalagem(t)).toEqual([]);
      });
    });

    it('RN-VEN-15: o ERP prevalece — embalagem com a sigla de uma unidade de venda do ERP ganha o fator dela, com log', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await t.entregar('integracao.produto.atualizado@1', produto());
        await t.q("insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) select plataforma.tenant_atual(), id, 'CX', 6 from core.produto where external_id = 'P-T63'");
        await t.entregar('integracao.produto.atualizado@1', produto({ embalagem_medida: 'CX', embalagem_quantidade: 12 }), AGORA);
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 6 }]);
        expect(t.warn).toHaveBeenCalled();
        // embalagem que o BKO deixou divergente também é reconciliada quando o evento não traz embalagem
        await t.q("update core.produto set embalagem_quantidade = 24 where external_id = 'P-T63'");
        await t.entregar('integracao.produto.atualizado@1', produto({ nome: 'Refrigerante 2L Gelado' }), AGORA);
        expect(await lerEmbalagem(t)).toEqual([{ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 6 }]);
      });
    });

    it('RN-CORE-19: embalagem com medida não cadastrada = referência ausente reprocessável (nada é gravado)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await expect(t.entregar('integracao.produto.atualizado@1', produto({ embalagem_medida: 'zz', embalagem_quantidade: 12 }))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        expect(await lerEmbalagem(t)).toEqual([]);
      });
    });
  });

  describe('título', () => {
    const titulo = (id: string, extra: Record<string, unknown> = {}) =>
      ev('titulo', id, { cliente_external_id: 'C-T66', numero: `NF-${id}`, parcela: 1, emissao: '2026-10-01', vencimento: '2026-11-30', valor_cents: 10_000, saldo_cents: 10_000, situacao: 'aberto', ...extra });
    const preparar = async (t: Teste) => {
      await t.entregar('integracao.vendedor.atualizado@1', vendedor());
      await t.entregar('integracao.cliente.atualizado@1', cliente());
    };

    it('RN-INT-04: cliente ausente lança referência ausente', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await expect(t.entregar('integracao.titulo.atualizado@1', titulo('T-1'))).rejects.toBeInstanceOf(ReferenciaAusenteErp);
      });
    });

    it('RN-INT-02: título entra, reentrega não duplica, baixa vira liquidado e o saldo do financeiro acompanha; inativação remove', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await preparar(t);
        await t.entregar('integracao.titulo.atualizado@1', titulo('T-1'));
        await t.entregar('integracao.titulo.atualizado@1', titulo('T-1'));
        await t.entregar('integracao.titulo.atualizado@1', titulo('T-2', { valor_cents: 5_000, saldo_cents: 2_000, parcela: null, emissao: null }));
        const saldo = async () => (await t.q<{ saldo_aberto_cents: string }>("select f.saldo_aberto_cents from core.cliente_financeiro f join core.cliente c on c.id = f.cliente_id where c.external_id = 'C-T66'"))[0]?.saldo_aberto_cents;
        expect(await saldo()).toBe('12000');
        expect((await t.q("select 1 from core.titulo where external_id = 'T-1' and deleted_at is null")).length).toBe(1);
        await t.entregar('integracao.titulo.atualizado@1', titulo('T-1', { situacao: 'baixado', saldo_cents: 0, baixado_em: '2026-11-04T12:00:00Z' }));
        const t1 = await t.q<{ situacao: string; liquidado_em: Date | null }>("select situacao, liquidado_em from core.titulo where external_id = 'T-1'");
        expect(t1[0]?.situacao).toBe('liquidado');
        expect(t1[0]?.liquidado_em).not.toBeNull();
        expect(await saldo()).toBe('2000');
        await t.entregar('integracao.titulo.atualizado@1', ev('titulo', 'T-2', undefined, 'inativado'));
        expect(await saldo()).toBe('0');
        expect((await t.q("select 1 from core.titulo where external_id = 'T-2' and deleted_at is null")).length).toBe(0);
      });
    });
  });

  describe('rota', () => {
    const rota = (extra: Record<string, unknown> = {}) =>
      ev('rota', 'R-T66', { nome: 'Rota Centro', vendedor_external_id: 'V-T66', dia_semana: 3, paradas: [{ ordem: 2, cliente_external_id: 'C-T66-2' }, { ordem: 1, cliente_external_id: 'C-T66' }], ...extra });
    const preparar = async (t: Teste) => {
      await t.entregar('integracao.vendedor.atualizado@1', vendedor());
      await t.entregar('integracao.cliente.atualizado@1', cliente());
      await t.entregar('integracao.cliente.atualizado@1', cliente('C-T66-2', { documento: CNPJ2, contatos: [] }));
    };

    it('RN-INT-04: vendedor ou cliente ausente lança referência ausente e nada é gravado', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await expect(t.entregar('integracao.rota.atualizado@1', rota())).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        await t.entregar('integracao.vendedor.atualizado@1', vendedor());
        await expect(t.entregar('integracao.rota.atualizado@1', rota())).rejects.toBeInstanceOf(ReferenciaAusenteErp);
        expect((await t.q("select 1 from core.rota where origem = 'erp'")).length).toBe(0);
      });
    });

    it('RN-INT-06: materializa 4 quartas-feiras a partir de hoje (fuso do tenant), com paradas em ordem; reentrega não duplica', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await preparar(t);
        await t.entregar('integracao.rota.atualizado@1', rota());
        await t.entregar('integracao.rota.atualizado@1', rota());
        const rs = await t.q<{ data: string; origem: string; situacao: string }>("select to_char(data, 'YYYY-MM-DD') as data, origem, situacao from core.rota where external_id like 'R-T66@%' and deleted_at is null order by data");
        expect(rs.map((r) => r.data)).toEqual(['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
        expect(rs.every((r) => r.origem === 'erp' && r.situacao === 'publicada')).toBe(true);
        const ps = await t.q<{ sequencia: number; ext: string }>("select p.sequencia, c.external_id as ext from core.rota_parada p join core.cliente c on c.id = p.cliente_id join core.rota r on r.id = p.rota_id where r.external_id = 'R-T66@2026-11-04' and p.deleted_at is null order by p.sequencia");
        expect(ps).toEqual([{ sequencia: 1, ext: 'C-T66' }, { sequencia: 2, ext: 'C-T66-2' }]);
        expect((await t.q("select 1 from core.rota_parada p join core.rota r on r.id = p.rota_id where r.external_id like 'R-T66@%' and p.deleted_at is null")).length).toBe(8);
      });
    });

    it('RN-INT-06: parada removida e dia trocado saem do futuro; o que já passou não muda; inativação encerra o futuro', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await preparar(t);
        await t.entregar('integracao.rota.atualizado@1', rota());
        // uma semana depois: a rota passa para sexta e perde a parada 2
        const depois = new Date('2026-11-11T15:00:00Z');
        await t.entregar('integracao.rota.atualizado@1', rota({ dia_semana: 5, paradas: [{ ordem: 1, cliente_external_id: 'C-T66' }] }), depois);
        const vivas = await t.q<{ data: string }>("select to_char(data, 'YYYY-MM-DD') as data from core.rota where external_id like 'R-T66@%' and deleted_at is null order by data");
        expect(vivas.map((r) => r.data)).toEqual(['2026-11-04', '2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04']);
        expect((await t.q("select 1 from core.rota_parada p join core.rota r on r.id = p.rota_id where r.external_id = 'R-T66@2026-11-13' and p.deleted_at is null")).length).toBe(1);
        await t.entregar('integracao.rota.atualizado@1', ev('rota', 'R-T66', undefined, 'inativado'), depois);
        const resto = await t.q<{ data: string }>("select to_char(data, 'YYYY-MM-DD') as data from core.rota where external_id like 'R-T66@%' and deleted_at is null");
        expect(resto.map((r) => r.data)).toEqual(['2026-11-04']);
      });
    });

    it('RN-CORE-04: dia em que o vendedor já tem rota de outra origem não é sobrescrito (aviso, sem erro)', async () => {
      await emTransacao(A.tenantId, async (t) => {
        await preparar(t);
        const u = (await t.q<{ id: string }>("select id from core.usuario where external_id = 'V-T66'"))[0]!.id;
        await t.q("insert into core.rota (tenant_id, usuario_id, data, origem) values (plataforma.tenant_atual(), $1, '2026-11-04', 'bko')", [u]);
        await t.entregar('integracao.rota.atualizado@1', rota());
        expect(t.warn).toHaveBeenCalled();
        expect((await t.q("select 1 from core.rota where usuario_id = $1 and data = '2026-11-04' and deleted_at is null", [u])).length).toBe(1);
        expect((await t.q("select 1 from core.rota where external_id like 'R-T66@%' and deleted_at is null")).length).toBe(3);
      });
    });
  });
});
