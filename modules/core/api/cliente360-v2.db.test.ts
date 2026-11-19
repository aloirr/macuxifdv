/**
 * T-0186 (RN-CORE-40) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): notas e NF ao tocar (escopo de carteira e
 * outro tenant), documentos (permissão por tipo, perfil e exceção) e permissões do BKO (só admin, auditado), com os nomes
 * reais da migração 0090. As linhas do teste têm ids próprios e saem no fim. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, type AcessoBanco, type ClienteBanco, type ContextoBase, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { carteiraDoUsuario } from './carteira';
import { guardaArquivoDocumento, repositorioDocumentosSql, repositorioNotasSql, rotasDeCliente360V2 } from './cliente360-v2';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;
const ID = (n: number) => `0e360000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T_CAD = ID(1);
const T_CTR = ID(2);
const D_CAD = ID(3);
const D_CTR = ID(4);
const NF_FAT = ID(5);
const NF_DEV = ID(6);
const NF_OUTRO = ID(7);
const TIT = ID(8);
const ARQ = ID(9);
const ARQ2 = ID(10);
const PERFIL_REP = ID(11);
const PERFIL_REP2 = ID(12);
const TIT2 = ID(13);
const PERFIL_SEM_VER = ID(14);

describe.skipIf(semBanco())('Core T-0186 × Postgres: Cliente 360 v2 (notas, documentos e permissões)', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const gerente = usuario(U.gerente, 'gerente');
  const admin = usuario(U.admin, 'admin');
  const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);

  function ctx(u: UsuarioAutenticado): ContextoBase {
    return {
      usuario: u,
      requestId: 'req-t0186',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
      carteira: () => carteiraDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r: RotaModulo = rotasDeCliente360V2.find((x) => x.metodo === metodo && x.caminho === caminho)!;
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const perfilId = (c: pg.ClientBase, codigo: string) => c.query<{ id: string }>('select id from plataforma.perfil where codigo = $1 and deleted_at is null', [codigo]).then((r) => r.rows[0]!.id);

  /** O macuxi_app não apaga (soft delete): a limpeza das linhas do teste vai pelo administrador do banco de teste. */
  async function limpar(): Promise<void> {
    const adm = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
    try {
      await adm.query('delete from core.documento_excecao where documento_id = any($1::uuid[])', [[D_CAD, D_CTR]]);
      await adm.query('delete from core.documento_permissao where tipo_id = any($1::uuid[])', [[T_CAD, T_CTR]]);
      await adm.query('delete from plataforma.perfil where id = any($1::uuid[])', [[PERFIL_REP, PERFIL_REP2, PERFIL_SEM_VER]]);
      await adm.query('delete from core.documento_cliente where id = any($1::uuid[])', [[D_CAD, D_CTR]]);
      await adm.query('delete from core.documento_tipo where id = any($1::uuid[])', [[T_CAD, T_CTR]]);
      await adm.query('delete from core.nota_erp where id = any($1::uuid[])', [[NF_FAT, NF_DEV, NF_OUTRO]]);
      await adm.query('delete from core.titulo where id = any($1::uuid[])', [[TIT, TIT2]]);
      await adm.query("delete from plataforma.auditoria where request_id = 'req-t0186'").catch(() => undefined);
    } finally {
      await adm.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    acesso = { comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)), semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco) };
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      const nota = (id: string, cli: string, tipo: string, numero: string, total: number, ext: string, extra: [string | null, string | null, string | null]) =>
        c.query(
          `insert into core.nota_erp (id, tenant_id, cliente_id, tipo, numero, serie, emitida_em, ano_mes, total_cents, external_id, forma_pagamento, nf_origem_numero, nf_origem_serie)
           values ($1, $2, $3, $4, $5, '1', now() - interval '10 days', to_char(now() - interval '10 days', 'YYYY-MM'), $6, $7, $8, $9, $10)`,
          [id, A.tenantId, cli, tipo, numero, total, ext, ...extra],
        );
      await nota(NF_FAT, C.c1, 'faturamento', '9001', 10000, 'T0186-NF-1', ['Boleto 28 dias', null, null]);
      await nota(NF_DEV, C.c1, 'devolucao', '9002', 2500, 'T0186-NF-2', [null, '9001', '1']);
      await nota(NF_OUTRO, C.c2, 'faturamento', '9003', 5000, 'T0186-NF-3', ['PIX', null, null]);
      await c.query(
        `insert into core.titulo (id, tenant_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents, saldo_cents, situacao, nf_numero, nf_serie, forma_pagamento)
         values ($1, $2, $3, '9001', '1', current_date - 10, current_date - 2, 10000, 10000, 'aberto', '9001', '1', 'Boleto 28 dias')`,
        [TIT, A.tenantId, C.c1],
      );
      await c.query(
        `insert into core.titulo (id, tenant_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents, saldo_cents, situacao, nf_numero, nf_serie, forma_pagamento, liquidado_em)
         values ($1, $2, $3, '9004', '1', '2026-11-01', '2026-11-09', 7000, 0, 'liquidado', '9004', '1', 'PIX', '2026-11-10T02:00:00Z')`,
        [TIT2, A.tenantId, C.c1],
      );
      const vend = await perfilId(c, 'vendedor');
      await c.query(
        `insert into core.documento_tipo (id, tenant_id, nome, grupo, ordem, origem, tem_validade) values ($1, $3, 'T0186 Cadastro', 'Cadastro', 91, 'escritorio', true), ($2, $3, 'T0186 Contrato', 'Contratos', 92, 'escritorio', false)`,
        [T_CAD, T_CTR, A.tenantId],
      );
      await c.query(`insert into core.documento_permissao (tenant_id, tipo_id, perfil_id, nivel) values ($1, $2, $3, 've')`, [A.tenantId, T_CAD, vend]);
      await c.query(
        `insert into core.documento_cliente (id, tenant_id, cliente_id, tipo_id, nome, arquivo_id, data_documento, valido_ate) values ($1, $3, $4, $5, 'Alvará T0186', $7, '2026-03-10', '2027-03-10'), ($2, $3, $4, $6, 'Contrato T0186', $8, '2026-01-10', null)`,
        [D_CAD, D_CTR, A.tenantId, C.c1, T_CAD, T_CTR, ARQ, ARQ2],
      );
    });
  });
  afterAll(async () => {
    if (pool) await limpar();
    await pool?.end();
  });

  describe('notas (RN-CORE-04, RN-CORE-05)', () => {
    it('RN-CORE-40: a lista traz a NF com a forma de pagamento, o status pelas parcelas (nf_numero/nf_serie) e a devolução parcial (nf_origem_numero)', async () => {
      const r = await chamar('GET', 'clientes/:id/notas', vendedor1, { params: { id: C.c1 } });
      const nf = r.itens.find((i: { numero_nf: string }) => i.numero_nf === '9001');
      expect(nf).toMatchObject({ valor_cents: 10000, forma_pagamento: 'Boleto 28 dias', status: 'em_atraso' });
      expect(r.itens.map((i: { numero_nf: string }) => i.numero_nf)).not.toContain('9002');
      expect(r.formas_pagamento).toContain('Boleto 28 dias');
    });
    it('RN-CORE-40: a NF ao tocar devolve o detalhe com o devolvido', async () => {
      const d = await chamar('GET', 'clientes/:id/notas/:nota_id', vendedor1, { params: { id: C.c1, nota_id: NF_FAT } });
      expect(d).toMatchObject({ numero_nf: '9001' });
      expect(JSON.stringify(d)).toContain('2500');
    });
    it('RN-CORE-04: cliente fora da carteira (c2 do vendedor-1) não lista nem abre a NF', async () => {
      await expect(chamar('GET', 'clientes/:id/notas', vendedor1, { params: { id: C.c2 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      await expect(chamar('GET', 'clientes/:id/notas/:nota_id', vendedor1, { params: { id: C.c2, nota_id: NF_OUTRO } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      expect((await chamar('GET', 'clientes/:id/notas', gerente, { params: { id: C.c2 } })).itens.map((i: { numero_nf: string }) => i.numero_nf)).toContain('9003');
    });
    it('RN-CORE-05: o outro tenant não vê as notas nem os documentos do tenant A (RLS)', async () => {
      await expect(chamar('GET', 'clientes/:id/notas', vendedorB, { params: { id: C.c1 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      await comTenant(pool, B.tenantId, async (c) => {
        const db = c as unknown as ClienteBanco;
        expect(await repositorioNotasSql(db, 'America/Manaus').notas(C.c1, '2000-01-01', '2100-01-01')).toEqual([]);
        expect(await repositorioNotasSql(db, 'America/Manaus').nota(C.c1, NF_FAT)).toBeUndefined();
        expect(await repositorioDocumentosSql(db).documentoPorId(D_CAD)).toBeUndefined();
        expect((await repositorioDocumentosSql(db).tipos()).map((t) => t.id)).not.toContain(T_CAD);
      });
    });
  });

  describe('parcelas: fuso do tenant', () => {
    it('RN-CORE-40: pagamento às 22h de Manaus (02h UTC do dia seguinte) cai no dia certo, como as notas', async () => {
      const parcelas = await comTenant(pool, A.tenantId, (c) => repositorioNotasSql(c as unknown as ClienteBanco, 'America/Manaus').parcelas(C.c1));
      expect(parcelas.find((p) => p.nota_numero === '9004')?.liquidado_em).toBe('2026-11-09');
      const utc = await comTenant(pool, A.tenantId, (c) => repositorioNotasSql(c as unknown as ClienteBanco, 'UTC').parcelas(C.c1));
      expect(utc.find((p) => p.nota_numero === '9004')?.liquidado_em).toBe('2026-11-10');
    });
  });

  describe('documentos (P10, P11)', () => {
    const ver = async (u: UsuarioAutenticado) => (await chamar('GET', 'clientes/:id/documentos', u, { params: { id: C.c1 } })).itens as Array<{ id: string; acesso: string; formato: string | null }>;
    it('P10: o vendedor vê só o tipo liberado na matriz; o tipo sem linha fica oculto e abre como 404', async () => {
      const itens = await ver(vendedor1);
      expect(itens.find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'abrir' });
      expect(itens.map((i) => i.id)).not.toContain(D_CTR);
      await expect(chamar('GET', 'clientes/:id/documentos/:documento_id', vendedor1, { params: { id: C.c1, documento_id: D_CTR } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      expect(await chamar('GET', 'clientes/:id/documentos/:documento_id', vendedor1, { params: { id: C.c1, documento_id: D_CAD } })).toMatchObject({ id: D_CAD, arquivo_id: ARQ });
    });
    it('perfil admin vê todos os tipos sem linha na matriz', async () => {
      expect((await ver(admin)).map((i) => i.id)).toEqual(expect.arrayContaining([D_CAD, D_CTR]));
    });
    it('P11: a exceção do documento tira o acesso do perfil (cadeado e 403 ao abrir) sem afetar os outros perfis', async () => {
      await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: ['vendedor'] } });
      expect((await ver(vendedor1)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'bloqueado' });
      await expect(chamar('GET', 'clientes/:id/documentos/:documento_id', vendedor1, { params: { id: C.c1, documento_id: D_CAD } })).rejects.toMatchObject({ status: 403 });
      expect((await ver(admin)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'abrir' });
      await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: [] } });
      expect((await ver(vendedor1)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'abrir' });
    });
  });

  describe('🔴 vazamento: perfil personalizado (a matriz e as exceções guardam plataforma.perfil.codigo)', () => {
    const perfilDe = (codigo: string, base: UsuarioAutenticado['perfil'] = 'vendedor') => ({ codigo, base, permissoes: {} });
    const comPerfis = (...codigos: string[]): UsuarioAutenticado => ({ ...vendedor1, perfis: codigos.map((c) => perfilDe(c)) }) as UsuarioAutenticado;
    const ver = async (u: UsuarioAutenticado) => (await chamar('GET', 'clientes/:id/documentos', u, { params: { id: C.c1 } })).itens as Array<{ id: string; acesso: string }>;
    const abrir = (u: UsuarioAutenticado) => chamar('GET', 'clientes/:id/documentos/:documento_id', u, { params: { id: C.c1, documento_id: D_CAD } });
    beforeAll(async () => {
      await comTenant(pool, A.tenantId, async (c) => {
        for (const [id, codigo] of [[PERFIL_REP, 'rep_t0186'], [PERFIL_REP2, 'rep2_t0186']] as const) {
          await c.query(`insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo, cargo) values ($1, plataforma.tenant_atual(), $2, $2, 'vendedor', false, true, 'vendedor')`, [id, codigo]);
        }
        await c.query(`insert into core.documento_permissao (tenant_id, tipo_id, perfil_id, nivel) values ($1, $2, $3, 'nao_ve'), ($1, $2, $4, 've')`, [A.tenantId, T_CAD, PERFIL_REP, PERFIL_REP2]);
      });
    });
    it('P10: usuário de perfil personalizado com "Não vê" no tipo NÃO vê nem abre, mesmo com a base vendedor liberada na matriz (vazamento fechado)', async () => {
      const u = comPerfis('rep_t0186');
      expect((await ver(u)).map((i) => i.id)).not.toContain(D_CAD);
      await expect(abrir(u)).rejects.toBeInstanceOf(ErroNaoEncontrado);
      expect((await ver(vendedor1)).map((i) => i.id)).toContain(D_CAD);
    });
    it('P10: com dois perfis, um "Não vê" e outro "Vê", o usuário vê e abre', async () => {
      const u = comPerfis('rep_t0186', 'rep2_t0186');
      expect((await ver(u)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'abrir' });
      expect(await abrir(u)).toMatchObject({ id: D_CAD, arquivo_id: ARQ });
    });
    it('P11: a exceção gravada no perfil personalizado tira o acesso (cadeado e 403) de quem tem esse perfil entre os dele', async () => {
      await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: ['rep2_t0186'] } });
      try {
        const u = comPerfis('rep_t0186', 'rep2_t0186');
        expect((await ver(u)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'bloqueado' });
        await expect(abrir(u)).rejects.toMatchObject({ status: 403 });
        expect((await ver(vendedor1)).find((i) => i.id === D_CAD)).toMatchObject({ acesso: 'abrir' });
      } finally {
        await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: [] } });
      }
    });
  });

  describe('RN-CORE-40: guarda do arquivo do documento (ModuloApi.guardaArquivo) × Postgres', () => {
    // `perfis` resolvidos como a plataforma faz a cada requisição; `semVer` = perfil sem a ação documento.ver
    const comModulos = (u: UsuarioAutenticado, modulos: string[] = ['core'], perfis?: string[], semVer: string[] = []) =>
      ({ ...u, modulos, perfis: (perfis ?? [u.perfil]).map((codigo) => ({ codigo, base: perfis ? 'vendedor' : u.perfil, permissoes: semVer.includes(codigo) ? {} : { 'documento.ver': {} } })) }) as never;
    const guarda = (u: UsuarioAutenticado, arquivoId: string, tenant = u.tenant_id) =>
      comTenant(pool, tenant, (c) => guardaArquivoDocumento({ db: c as unknown as ClienteBanco, usuario: u as never, arquivoId, modulo: 'core', finalidade: 'documento', clienteId: C.c1 }));
    it('quem tem permissão no tipo, licença e o cliente na carteira recebe liberado', async () => {
      expect(await guarda(comModulos(vendedor1), ARQ)).toBe('liberado');
    });
    it('quem tem o id mas não a permissão do tipo (vendedor sem linha na matriz) recebe negado', async () => {
      expect(await guarda(comModulos(vendedor1), ARQ2)).toBe('negado');
    });
    it('perfil personalizado com "Não vê" no tipo recebe negado; com outro perfil que vê, liberado', async () => {
      expect(await guarda(comModulos(vendedor1, ['core'], ['rep_t0186']), ARQ)).toBe('negado');
      expect(await guarda(comModulos(vendedor1, ['core'], ['rep_t0186', 'rep2_t0186']), ARQ)).toBe('liberado');
    });
    it('RN-CORE-40: perfil personalizado SEM a ação documento.ver recebe negado, mesmo com o tipo liberado na matriz (mesma checagem da rota)', async () => {
      await comTenant(pool, A.tenantId, async (c) => {
        await c.query(`insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo, cargo) values ($1, plataforma.tenant_atual(), 'sem_ver_t0186', 'sem_ver_t0186', 'vendedor', false, true, 'vendedor')`, [PERFIL_SEM_VER]);
        await c.query(`insert into core.documento_permissao (tenant_id, tipo_id, perfil_id, nivel) values ($1, $2, $3, 've')`, [A.tenantId, T_CAD, PERFIL_SEM_VER]);
      });
      expect(await guarda(comModulos(vendedor1, ['core'], ['sem_ver_t0186'], ['sem_ver_t0186']), ARQ)).toBe('negado');
      expect(await guarda(comModulos(vendedor1, ['core'], ['sem_ver_t0186', 'rep2_t0186']), ARQ)).toBe('liberado');
    });
    it('a exceção do documento recebe negado; admin segue liberado', async () => {
      await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: ['vendedor'] } });
      try {
        expect(await guarda(comModulos(vendedor1), ARQ)).toBe('negado');
        expect(await guarda(comModulos(admin), ARQ)).toBe('liberado');
      } finally {
        await chamar('PUT', 'documentos/excecoes', admin, { corpo: { documento_id: D_CAD, perfis: [] } });
      }
    });
    it('cliente fora da carteira ou sem a licença do Core recebe negado', async () => {
      expect(await guarda(comModulos(usuario(U.vendedor2, 'vendedor')), ARQ)).toBe('negado');
      expect(await guarda(comModulos(vendedor1, ['vendedor']), ARQ)).toBe('negado');
    });
    it('RN-CORE-05: outro tenant não alcança o documento (RLS): null, nunca liberado', async () => {
      expect(await guarda(comModulos(vendedorB), ARQ, B.tenantId)).toBeNull();
    });
    it('arquivo que não é de documento = null (a guarda não governa)', async () => {
      expect(await guarda(comModulos(vendedor1), ID(99))).toBeNull();
    });
  });

  describe('permissões no BKO (documento.permissoes)', () => {
    it('RN-CORE-40: só o admin tem a ação documento.permissoes no manifesto', () => {
      expect(manifest.acoes?.['documento.permissoes']?.perfis).toEqual(['admin']);
    });
    it('RN-CORE-40: gravar a matriz grava perfil_id e nível reais, devolve a matriz e audita antes e depois', async () => {
      const r = await chamar('PUT', 'documentos/permissoes', admin, { corpo: { matriz: [{ tipo_id: T_CTR, perfil: 'supervisor', nivel: 've' }] } });
      expect(r.matriz.filter((m: { tipo_id: string }) => m.tipo_id === T_CTR)).toEqual([{ tipo_id: T_CTR, perfil: 'supervisor', nivel: 've' }]);
      const aud = await comTenant(pool, A.tenantId, async (c) => (await c.query("select acao, usuario_id from plataforma.auditoria where acao = 'documento.permissoes' and request_id = 'req-t0186'")).rows);
      expect(aud.length).toBeGreaterThan(0);
      expect(aud[0]).toMatchObject({ usuario_id: U.admin });
    });
    it('RN-CORE-40: "Vê e envia" só nos tipos de origem app; perfil inexistente é recusado', async () => {
      await expect(chamar('PUT', 'documentos/permissoes', admin, { corpo: { matriz: [{ tipo_id: T_CTR, perfil: 'supervisor', nivel: 've_e_envia' }] } })).rejects.toMatchObject({ status: 422 });
      await expect(chamar('PUT', 'documentos/permissoes', admin, { corpo: { matriz: [{ tipo_id: T_CTR, perfil: 'inexistente', nivel: 've' }] } })).rejects.toBeDefined();
    });
  });
});
