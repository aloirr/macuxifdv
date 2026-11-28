/**
 * T-0209 (v1.0.44, ADR 0078 D5) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): o vendedor do lote com e-mail
 * (normalizado) vivo em OUTRA empresa é recusado com `VENDEDOR_EMAIL_EM_OUTRA_EMPRESA` pela `plataforma.email_em_outra_empresa`
 * (migração 0111); o resto do lote segue. O mesmo e-mail na mesma empresa e o provisório `@sem-email.invalid` passam. O erro e o
 * log levam só o `external_id`. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { createHash, randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo, DefinicaoEvento } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSAO_CONTRATO } from '../contracts';
import { aplicarLote } from './aplicar-lote';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const P = `T0209${randomUUID().slice(0, 6)}`;
const p = P.toLowerCase();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const AGORA = new Date();

describe.skipIf(semBanco())('Integração T-0209: vendedor com e-mail de outra empresa × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let eventos: { nome: string; payload: Record<string, unknown> }[] = [];
  const logs: unknown[] = [];
  const usuarios: string[] = [];

  const rodar = <T>(tenantId: string, fn: (ctx: ContextoConsumo) => Promise<T>): Promise<T> =>
    comTenant(pool, tenantId, (db) =>
      fn({
        envelope: { evento_id: randomUUID(), tenant_id: tenantId },
        db,
        agora: () => AGORA,
        publicar: (async (def: DefinicaoEvento, payload: unknown) => {
          eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
          return {} as never;
        }) as never,
        log: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a) },
        consultar: (async () => ({ por_external_id: [], resultados: [] })) as unknown as ContextoConsumo['consultar'],
        parametros: () => ({}),
        fuso: () => 'America/Manaus',
      } as unknown as ContextoConsumo),
    );

  const novoLote = (tenantId: string, conectorId: string, registros: unknown[]): Promise<string> =>
    comTenant(pool, tenantId, async (db) => {
      const chave = randomUUID().replace(/-/g, '');
      const { rows } = await db.query<{ id: string }>(
        `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, invalidas_omitidas)
         values (plataforma.tenant_atual(), $1, 'vendedor', 'delta', $2, $3, $4, $5, 0) returning id`,
        [conectorId, VERSAO_CONTRATO, chave, sha(chave), registros.length],
      );
      const id = rows[0]!.id;
      await db.query('insert into integracao.lote_staging (tenant_id, lote_id, corpo) values (plataforma.tenant_atual(), $1, $2::jsonb)', [id, JSON.stringify({ registros, linhas_invalidas: [], linhas_invalidas_omitidas: 0 })]);
      return id;
    });
  const aplicar = (t: typeof A | typeof B, loteId: string, recebidas: number) =>
    rodar(t.tenantId, (ctx) => aplicarLote({ lote_id: loteId, conector_id: t.integracao.identificador, entidade: 'vendedor', modo: 'delta', recebidas, recebido_em: AGORA.toISOString() }, ctx));
  const usuario = async (tenantId: string, email: string) => {
    const id = randomUUID();
    usuarios.push(id);
    await admin.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Pessoa de Teste', $3, 'vendedor')", [id, tenantId, email]);
  };
  const vend = (n: string, email: string | null) => ({ external_id: `${P}-V${n}`, nome: `Fulano de Tal ${n}`, email, alterado_em: new Date(AGORA.getTime() - 60_000).toISOString() });
  const lote = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<Record<string, unknown>>('select status, novas, com_erro from integracao.lote where id = $1', [id])).rows[0]);
  const erros = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<Record<string, unknown>>('select indice, codigo, campo, mensagem, reprocessavel, external_id, payload from integracao.lote_linha_erro where lote_id = $1 order by indice', [id])).rows);
  const registros = (tenantId: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ external_id: string }>("select external_id from integracao.registro_atual where entidade = 'vendedor' and external_id like $1 order by external_id", [`${P}%`])).rows.map((r) => r.external_id));

  async function limpar() {
    const t = [A.tenantId, B.tenantId];
    await admin.query('delete from integracao.lote where tenant_id = any($1) and id in (select lote_id from integracao.lote_staging where corpo::text like $2)', [t, `%${P}%`]);
    await admin.query('delete from integracao.registro_atual where tenant_id = any($1) and external_id like $2', [t, `${P}%`]);
    if (usuarios.length > 0) await admin.query('delete from core.usuario where id = any($1::uuid[])', [usuarios]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    // lote de vendedor da fixture em aberto seguraria os deste arquivo (mesma entidade, mesmo Conector)
    await admin.query("update integracao.lote set status = 'concluido' where tenant_id = any($1) and entidade in ('vendedor', 'filial') and status = 'recebido' and id not in (select lote_id from integracao.lote_staging where corpo::text like $2)", [[A.tenantId, B.tenantId], `%${P}%`]);
    await usuario(B.tenantId, `ana.${p}@exemplo.com.br`); // e-mail da outra empresa
    await usuario(A.tenantId, `bia.${p}@exemplo.com.br`); // e-mail já da mesma empresa (atualização)
    await usuario(B.tenantId, `bia.apagada.${p}@exemplo.com.br`);
    await admin.query('update core.usuario set deleted_at = now() where id = $1', [usuarios[2]]);
    await usuario(B.tenantId, `erp-${p}@sem-email.invalid`); // provisório do ERP na outra empresa (RN-CORE-58)
  });
  afterAll(async () => {
    if (admin) await limpar();
    await admin?.end();
    await pool?.end();
  });

  it('RN-CORE-32: e-mail de outra empresa (caixa e espaços diferentes) é recusado com VENDEDOR_EMAIL_EM_OUTRA_EMPRESA; mesma empresa, apagado e provisório passam; o resto do lote segue', async () => {
    const registrosLote = [
      vend('1', `  ANA.${P}@Exemplo.COM.br `),
      vend('2', `Bia.${p}@exemplo.com.br`),
      vend('3', `erp-${p}@sem-email.invalid`),
      vend('4', null),
      vend('5', `bia.apagada.${p}@exemplo.com.br`),
    ];
    const id = await novoLote(A.tenantId, A.integracao.conector, registrosLote);
    await aplicar(A, id, registrosLote.length);
    expect(await lote(A.tenantId, id)).toMatchObject({ status: 'concluido_com_erros', novas: 4, com_erro: 1 });
    expect(await erros(A.tenantId, id)).toEqual([
      { indice: 0, codigo: 'VENDEDOR_EMAIL_EM_OUTRA_EMPRESA', campo: 'email', mensagem: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.', reprocessavel: false, external_id: `${P}-V1`, payload: null },
    ]);
    expect(await registros(A.tenantId)).toEqual([`${P}-V2`, `${P}-V3`, `${P}-V4`, `${P}-V5`]);
    expect(eventos.filter((e) => e.nome === 'integracao.vendedor.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-V2`, `${P}-V3`, `${P}-V4`, `${P}-V5`]);
    // log da integração: só o external_id (nenhum e-mail, nem o nome)
    const recusa = logs.find((l) => JSON.stringify(l).includes('VENDEDOR_EMAIL_EM_OUTRA_EMPRESA'));
    expect(recusa).toEqual([{ lote_id: id, entidade: 'vendedor', external_id: `${P}-V1`, codigo: 'VENDEDOR_EMAIL_EM_OUTRA_EMPRESA' }, 'vendedor recusado: e-mail em outra empresa']);
    const texto = JSON.stringify([await erros(A.tenantId, id), logs]).toLowerCase();
    expect(texto).not.toContain('exemplo.com.br');
    expect(texto).not.toContain('fulano');
  });

  it('RN-INT-02: a reentrega do lote já aplicado é no-op (nenhum erro nem evento a mais)', async () => {
    const id = await novoLote(A.tenantId, A.integracao.conector, [vend('6', `ana.${p}@exemplo.com.br`)]);
    await aplicar(A, id, 1);
    eventos = [];
    await aplicar(A, id, 1);
    expect(await erros(A.tenantId, id)).toHaveLength(1);
    expect(eventos).toEqual([]);
  });

  it('multi-tenant: na empresa dona do e-mail (B) o mesmo vendedor passa', async () => {
    eventos = [];
    const id = await novoLote(B.tenantId, B.integracao.conector, [vend('7', ` Ana.${p}@exemplo.com.br`)]);
    await aplicar(B, id, 1);
    expect(await lote(B.tenantId, id)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    expect(await erros(B.tenantId, id)).toEqual([]);
    expect(await registros(B.tenantId)).toEqual([`${P}-V7`]);
  });
});
