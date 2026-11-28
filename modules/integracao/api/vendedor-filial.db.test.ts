/**
 * T-0206 (v1.0.43) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): a filial do vendedor na carga é OPCIONAL
 * (RN-CORE-39, decisão do dono do produto R-20261128-060854). Caminho do Hub: `aplicarLote` de `vendedor` com a filial conferida
 * no `registro_atual` do Hub OU no Core (`core.filiais@1`, simulado por tenant). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
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
const P = `T0206${randomUUID().slice(0, 6)}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const AGORA = new Date();
const em = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

interface Capturado {
  nome: string;
  payload: Record<string, unknown>;
}

describe.skipIf(semBanco())('Integração T-0206: filial opcional do vendedor × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let eventos: Capturado[] = [];
  let logs: unknown[] = [];
  /** filiais do Core simuladas: tenant -> external_ids que o `core.filiais@1` devolve */
  const coreFiliais = new Map<string, Set<string>>();

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
        log: {
          info: (...a: unknown[]) => logs.push(a),
          warn: (...a: unknown[]) => logs.push(a),
          error: (...a: unknown[]) => logs.push(a),
        },
        consultar: (async (def: { nome: string }, entrada: { external_ids?: string[] }) => {
          if (def.nome !== 'core.filiais@1') return { resultados: [] };
          const doTenant = coreFiliais.get(tenantId) ?? new Set<string>();
          return { por_external_id: (entrada.external_ids ?? []).filter((x) => doTenant.has(x)).map((x) => ({ external_id: x })) };
        }) as unknown as ContextoConsumo['consultar'],
        parametros: () => ({}),
        fuso: () => 'America/Manaus',
      } as unknown as ContextoConsumo),
    );
  const nomes = (nome: string) => eventos.filter((e) => e.nome === nome);

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
  const aplicar = (t: typeof A | typeof B, loteId: string) =>
    rodar(t.tenantId, (ctx) =>
      aplicarLote({ lote_id: loteId, conector_id: t.integracao.identificador, entidade: 'vendedor', modo: 'delta', recebidas: 1, recebido_em: AGORA.toISOString() }, ctx),
    );
  const vend = (n: string, extra: Record<string, unknown> = {}) => ({ external_id: `${P}-V${n}`, nome: `Fulano de Tal ${n}`, email: `fulano${n}@exemplo.com.br`, alterado_em: em(-60_000), ...extra });

  /** A filial no Hub: registro_atual da entidade `filial` (como a carga de filial deixa). */
  const filialNoHub = (t: typeof A | typeof B, externalId: string) =>
    admin.query(
      `insert into integracao.registro_atual (tenant_id, entidade, conector_id, hash, payload, alterado_em, ativo, external_id, visto_em, aplicado_em)
       values ($1, 'filial', $2, $3, $4::jsonb, now(), true, $5, now(), now())`,
      [t.tenantId, t.integracao.conector, sha(externalId), JSON.stringify({ external_id: externalId, codigo: 'F1', nome: 'Matriz' }), externalId],
    );

  const lote = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<Record<string, unknown>>('select status, novas, com_erro, avisos from integracao.lote where id = $1', [id])).rows[0]);
  const erros = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ codigo: string; campo: string; mensagem: string; reprocessavel: boolean; external_id: string | null }>('select codigo, campo, mensagem, reprocessavel, external_id from integracao.lote_linha_erro where lote_id = $1 order by indice', [id])).rows);
  const registros = (tenantId: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ external_id: string }>("select external_id from integracao.registro_atual where entidade = 'vendedor' and external_id like $1 order by external_id", [`${P}%`])).rows.map((r) => r.external_id));

  async function limpar() {
    const t = [A.tenantId, B.tenantId];
    await admin.query('delete from integracao.lote where tenant_id = any($1) and id in (select lote_id from integracao.lote_staging where corpo::text like $2)', [t, `%${P}%`]);
    await admin.query('delete from integracao.registro_atual where tenant_id = any($1) and external_id like $2', [t, `${P}%`]);
  }
  const reiniciar = async () => {
    await limpar();
    eventos = [];
    logs = [];
    coreFiliais.clear();
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    // a fixture pode trazer lote de vendedor em aberto que seguraria os lotes deste arquivo (mesma entidade, mesmo Conector)
    await admin.query("update integracao.lote set status = 'concluido' where tenant_id = any($1) and entidade in ('vendedor', 'filial') and status = 'recebido' and id not in (select lote_id from integracao.lote_staging where corpo::text like $2)", [[A.tenantId, B.tenantId], `%${P}%`]);
  });
  afterAll(async () => {
    if (admin) await limpar();
    await admin?.end();
    await pool?.end();
  });

  it('RN-CORE-39/RN-INT-04: filial existente no Hub ou no Core é aceita e o evento integracao.vendedor.atualizado@1 leva filial_external_id', async () => {
    await reiniciar();
    const noHub = `${P}-FH`;
    const noCore = `${P}-FC`;
    await filialNoHub(A, noHub);
    coreFiliais.set(A.tenantId, new Set([noCore]));
    const id = await novoLote(A.tenantId, A.integracao.conector, [vend('1', { filial_external_id: noHub }), vend('2', { filial_external_id: noCore })]);
    await aplicar(A, id);
    expect(await lote(A.tenantId, id)).toMatchObject({ status: 'concluido', novas: 2, com_erro: 0, avisos: null });
    expect(await erros(A.tenantId, id)).toEqual([]);
    expect(await registros(A.tenantId)).toEqual([`${P}-V1`, `${P}-V2`]);
    const ev = nomes('integracao.vendedor.atualizado@1');
    expect(ev.map((e) => [e.payload.external_id, (e.payload.registro as Record<string, unknown>).filial_external_id])).toEqual([
      [`${P}-V1`, noHub],
      [`${P}-V2`, noCore],
    ]);
  });

  it('RN-CORE-39 (decisão R-20261128-060854): sem filial (ausente ou null) a linha entra, só com o aviso vendedor_sem_filial e nenhum erro', async () => {
    await reiniciar();
    const id = await novoLote(A.tenantId, A.integracao.conector, [vend('3'), vend('4', { filial_external_id: null })]);
    await aplicar(A, id);
    const l = await lote(A.tenantId, id);
    expect(l).toMatchObject({ status: 'concluido', novas: 2, com_erro: 0 });
    expect(await erros(A.tenantId, id)).toEqual([]);
    const avisos = l?.avisos as { external_id: string; codigo: string }[];
    expect(avisos.map((a) => [a.external_id, a.codigo])).toEqual([
      [`${P}-V3`, 'vendedor_sem_filial'],
      [`${P}-V4`, 'vendedor_sem_filial'],
    ]);
    expect(nomes('integracao.vendedor.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-V3`, `${P}-V4`]);
  });

  it('RN-INT-04: filial inexistente recusa só a linha com referencia_ausente reprocessável no campo filial_external_id; nada publicado para ela e sem dado pessoal na mensagem nem no log', async () => {
    await reiniciar();
    const boa = `${P}-FOK`;
    await filialNoHub(A, boa);
    const ruim = `${P}-NAOEXISTE`;
    const id = await novoLote(A.tenantId, A.integracao.conector, [vend('5', { filial_external_id: ruim }), vend('6', { filial_external_id: boa })]);
    await aplicar(A, id);
    expect(await lote(A.tenantId, id)).toMatchObject({ status: 'concluido_com_erros', novas: 1, com_erro: 1 });
    const e = await erros(A.tenantId, id);
    expect(e).toEqual([{ codigo: 'referencia_ausente', campo: 'filial_external_id', reprocessavel: true, external_id: `${P}-V5`, mensagem: expect.stringContaining(ruim) }]);
    expect(await registros(A.tenantId)).toEqual([`${P}-V6`]);
    expect(nomes('integracao.vendedor.atualizado@1').map((x) => x.payload.external_id)).toEqual([`${P}-V6`]);
    const texto = JSON.stringify([e, logs]);
    expect(texto).not.toContain('Fulano de Tal');
    expect(texto).not.toContain('exemplo.com.br');
  });

  it('multi-tenant: a filial que existe só em B (Hub e Core) não vale para o vendedor de A; vale para o de B', async () => {
    await reiniciar();
    const soB = `${P}-FB`;
    await filialNoHub(B, soB);
    coreFiliais.set(B.tenantId, new Set([soB]));
    const idA = await novoLote(A.tenantId, A.integracao.conector, [vend('7', { filial_external_id: soB })]);
    await aplicar(A, idA);
    expect((await erros(A.tenantId, idA)).map((x) => [x.codigo, x.campo, x.reprocessavel])).toEqual([['referencia_ausente', 'filial_external_id', true]]);
    expect(await registros(A.tenantId)).toEqual([]);
    expect(nomes('integracao.vendedor.atualizado@1')).toHaveLength(0);

    const idB = await novoLote(B.tenantId, B.integracao.conector, [vend('7', { filial_external_id: soB })]);
    await aplicar(B, idB);
    expect(await lote(B.tenantId, idB)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    expect(await registros(B.tenantId)).toEqual([`${P}-V7`]);
    expect(await registros(A.tenantId)).toEqual([]);
  });
});
