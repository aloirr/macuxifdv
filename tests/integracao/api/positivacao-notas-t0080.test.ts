/**
 * T-0080 (agente testes) — positivação do mês com o Vendedor DESLIGADO, pelas notas do ERP (RN-CORE-27; desenho
 * docs/desenho/T-0080.md), ponta a ponta entre módulos: Conector simulado → Hub (`POST /integracao/v1/lotes`, ADR 0013) →
 * despachante REAL → `integracao.nota.atualizado@1` → consumidor do Core (`core.nota_erp` + `vendedor_external_id`/`usuario_id`,
 * migração 0025) → `GET /v1/core/inicio` do `createApp` REAL × Postgres como `macuxi_app` (RLS), banco efêmero próprio do arquivo
 * com a fixture dois-tenants (A = Manaus, B = São Paulo). PRECISA DE BANCO: pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) roda.
 *
 * O que o modulo-core já cobre e NÃO se repete aqui: a regra pura (`modules/core/domain/positivacao-notas.test.ts`), o Início em
 * memória (`modules/core/api/inicio.test.ts`) e o `calcularInicio` × banco com os módulos injetados, nota órfã completada pelo
 * consumidor do vendedor e reenvio direto ao consumidor (`modules/core/api/positivacao-notas.db.test.ts`).
 * Aqui: a ROTA HTTP com as licenças lidas do banco, a carga pelo Hub e o despachante. A fonte ERP liga pela Integração ativa no
 * TENANT (RN-CORE-27; D-T0080a corrigido): os perfis vendedor/supervisor seguem SEM a licença da Integração, como na demo.
 *
 * Relógio: as rotas usam um relógio controlado (`subirApi({ relogio })`) congelado em 20/10/2026 12h de Manaus só nas chamadas
 * do Início; o login e o Hub seguem o relógio real (o JWT é verificado no relógio real). As notas são de out/2026 (passado),
 * então o caso roda igual em qualquer data do CI. "Mês novo" = relógio em 03/11/2026.
 *
 * Notas de A (vendedor V1 = vendedor-1 adotado pelo e-mail; V2 = vendedor-2):
 *   N1 C1 V1 05/10 · N2 C1 V1 12/10 (mesmo cliente) · N3 C2 V1 20/10 9h (hoje) · N4 C2 V1 devolução 20/10 ·
 *   N5 C3 sem vendedor 06/10 · N6 C4 V1 01/10 03:30Z (= 30/09 23h30 em Manaus: setembro) · N7 C5 V1 só devolução 08/10 ·
 *   N8 C1 V2 10/10 (o mesmo cliente C1, outro vendedor).
 * Esperado (vendedor-1, out/2026): C1 até ontem + C2 hoje = { ate_ontem: 1, hoje: 1 }; vendedor-2 = { 1, 0 }.
 * Nota de B: NB1 CB1 V1 (MESMO external_id de vendedor que em A) 15/10 → vendedor Beta { 1, 0 }.
 *
 * Matriz: docs/testes/T-0080.md (P-01..P-12). Defeito D-T0080a fechado (P-03 era `it.fails`; agora `it`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { completarCnpj } from '@macuxi/comum/documento';
import { InicioSchema, type Inicio } from '@macuxi/core/contracts';
import { definirTenant, PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteAceito, LoteResultado, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, ids, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const P = `T80${randomUUID().slice(0, 4).toUpperCase()}`;
const V1 = `${P}-V1`;
const V2 = `${P}-V2`;
const CLI = { c1: `${P}-C1`, c2: `${P}-C2`, c3: `${P}-C3`, c4: `${P}-C4`, c5: `${P}-C5`, b1: `${P}-CB1` } as const;
const NF = { n1: `${P}-N1`, n2: `${P}-N2`, n3: `${P}-N3`, n4: `${P}-N4`, n5: `${P}-N5`, n6: `${P}-N6`, n7: `${P}-N7`, n8: `${P}-N8`, b1: `${P}-NB1` } as const;
/** 20/10/2026 12h em Manaus (13h em São Paulo): "hoje" = 2026-10-20 nos dois tenants. */
const OUT = '2026-10-20T16:00:00Z';
/** Mês novo: 03/11/2026 12h em Manaus. */
const NOV = '2026-11-03T16:00:00Z';
const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.10';
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Entidade = 'vendedor' | 'cliente' | 'nota';
/** Entidades que o teste carrega pelo Hub nos DOIS tenants (o Conector de cada um precisa estar cadastrado para elas). */
const ENTIDADES_CARREGADAS: readonly Entidade[] = ['vendedor', 'cliente', 'nota'];
type Positivacao = { ate_ontem: number; hoje: number } | null;

/** `alterado_em` sempre crescente e no passado (o Hub aplica o mais novo por external_id; RN-INT-05). */
let seqAlterado = 0;
// hora-fixa-ok: alterado_em do Hub no relógio real (só ordena as versões da linha; nunca comparado com OUT/NOV)
const alterado = () => new Date(Date.now() - 900_000 + (seqAlterado += 1) * 1_000).toISOString();

/** Conector on-premise simulado (mesmos cabeçalhos do `apps/conector`; ver tests/integracao/demo/ciclo-erp.test.ts). */
function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
    ...extra,
  });
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: cab(extra), remoteAddress: ip, ...(payload ? { payload } : {}) });
  const envelope = (entidade: Entidade, registros: object[]) => ({
    versao_contrato: VERSAO_CONTRATO,
    entidade,
    modo: 'delta' as const,
    conector_id: t.integracao.identificador,
    versao_conector: VERSAO_CONECTOR,
    // hora-fixa-ok: enviado_em do envelope do Conector (fora do conteúdo canônico; nunca comparado)
    enviado_em: new Date().toISOString(),
    registros,
  });
  const chaveDe = (corpo: ReturnType<typeof envelope>) => sha256(JSON.stringify({ ...corpo, enviado_em: undefined }));
  return {
    envelope,
    chaveDe,
    enviarLote: (corpo: ReturnType<typeof envelope>, chave = chaveDe(corpo)) => chamar('POST', '/lotes', corpo, { 'idempotency-key': chave }),
    consultarLote: (id: string) => chamar('GET', `/lotes/${id}`),
  };
}
type Conector = ReturnType<typeof conectorSimulado>;

const vendedor = (ext: string, email: string, nome: string) => ({ external_id: ext, alterado_em: alterado(), nome, email, telefone: null });
const cliente = (ext: string, base12: string, vendedorExt: string) => ({
  external_id: ext,
  alterado_em: alterado(),
  razao_social: `Mercado ${ext} Ltda`,
  nome_fantasia: `Mercado ${ext}`,
  documento: completarCnpj(base12),
  inscricao_estadual: 'ISENTO',
  vendedor_external_id: vendedorExt,
  endereco: { logradouro: 'Av. Djalma Batista', numero: '80', bairro: 'Chapada', cidade: 'Manaus', uf: 'AM', cep: '69050-010' },
  latitude: -3.1,
  longitude: -60.02,
  telefone: '92999990080',
  email: null,
  limite_credito_cents: 10_000_000,
  contatos: [],
});
interface NotaTeste {
  ext: string;
  cliente: string;
  vendedor: string | null;
  emitida_em: string;
  tipo?: 'faturamento' | 'devolucao';
  cancelada?: boolean;
}
const nota = (n: NotaTeste) => ({
  external_id: n.ext,
  alterado_em: alterado(),
  cliente_external_id: n.cliente,
  vendedor_external_id: n.vendedor,
  tipo: n.tipo ?? 'faturamento',
  numero: n.ext.slice(-6),
  serie: '1',
  emitida_em: n.emitida_em,
  total_cents: 10_000,
  quantidade_itens: 1,
  pedido_uuid: null,
  cancelada: n.cancelada ?? false,
});

const NOTAS_A: NotaTeste[] = [
  { ext: NF.n1, cliente: CLI.c1, vendedor: V1, emitida_em: '2026-10-05T14:00:00Z' },
  { ext: NF.n2, cliente: CLI.c1, vendedor: V1, emitida_em: '2026-10-12T14:00:00Z' },
  { ext: NF.n3, cliente: CLI.c2, vendedor: V1, emitida_em: '2026-10-20T13:00:00Z' },
  { ext: NF.n4, cliente: CLI.c2, vendedor: V1, emitida_em: '2026-10-20T14:00:00Z', tipo: 'devolucao' },
  { ext: NF.n5, cliente: CLI.c3, vendedor: null, emitida_em: '2026-10-06T14:00:00Z' },
  { ext: NF.n6, cliente: CLI.c4, vendedor: V1, emitida_em: '2026-10-01T03:30:00Z' },
  { ext: NF.n7, cliente: CLI.c5, vendedor: V1, emitida_em: '2026-10-08T14:00:00Z', tipo: 'devolucao' },
  { ext: NF.n8, cliente: CLI.c1, vendedor: V2, emitida_em: '2026-10-10T14:00:00Z' },
];
const NOTAS_B: NotaTeste[] = [{ ext: NF.b1, cliente: CLI.b1, vendedor: V1, emitida_em: '2026-10-15T14:00:00Z' }];

describe.skipIf(semBanco())('T-0080 — positivação do mês pelas notas do ERP com o Vendedor desligado (Hub → despachante → Core → GET /v1/core/inicio)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: Conector;
  let erpB: Conector;
  /** null = relógio real; senão o instante das rotas (só nas chamadas do Início). */
  let congelado: Date | null = null;
  const tk = { adminA: '', adminB: '', vendedor1: '', vendedor2: '', supervisor: '', vendedorB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  /** Lista original de `integracao.conector.entidades` por Conector (restaurada no afterAll). */
  const entidadesAntes = new Map<string, string[]>();
  /** Linha de base com o Vendedor LIGADO, antes de qualquer nota (out/2026): o que o pedido dá sozinho. */
  let baseVendedorLigado: Positivacao = null;
  /** Linha de base com o Vendedor DESLIGADO e sem nota atribuída no tenant (ramo antigo, core.positivacao_do_mes). */
  let baseRamoAntigo: Positivacao = null;

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  const eventosComFalha = (tenantId: string) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [tenantId]);

  /** Envia o lote pelo Hub, despacha e exige `concluido` sem erro de linha. */
  async function aplicar(erp: Conector, entidade: Entidade, registros: object[], chave?: string): Promise<LoteResultado> {
    const corpo = erp.envelope(entidade, registros);
    const r = await erp.enviarLote(corpo, chave);
    expect(r.statusCode, `${entidade}: ${r.body}`).toBe(202);
    const aceito = LoteAceito.parse(r.json());
    await despachar();
    const c = await erp.consultarLote(aceito.lote_id);
    expect(c.statusCode, c.body).toBe(200);
    const res = LoteResultado.parse(c.json());
    expect(res.erros, `${entidade}: ${JSON.stringify(res.erros)}`).toEqual([]);
    expect(res.status, entidade).toBe('concluido');
    return res;
  }

  async function inicio(token: string, instante = OUT): Promise<Inicio> {
    congelado = new Date(instante);
    try {
      const r = await api.chamar(token, { method: 'GET', url: '/v1/core/inicio' });
      expect(r.statusCode, r.body).toBe(200);
      return InicioSchema.parse(r.json());
    } finally {
      congelado = null;
    }
  }
  const pos = (r: Inicio, usuarioId: string): Positivacao => {
    const u = r.usuarios.find((x) => x.usuario_id === usuarioId);
    expect(u, `usuário ${usuarioId} no Início`).toBeDefined();
    return u!.positivacao;
  };
  async function ligar(token: string, nivel: 'tenant' | 'perfil', modulo: string, ativo: boolean, alvo?: string) {
    const r = await licenca(api, token, nivel, modulo, ativo, alvo);
    expect(r.statusCode, `licença ${nivel} ${alvo ?? ''} ${modulo}=${ativo}: ${r.body}`).toBe(200);
  }
  /** Roda `fn` com o Vendedor desligado no tenant e religa no fim (mesmo se falhar). */
  async function semVendedor<T>(tokenAdmin: string, fn: () => Promise<T>): Promise<T> {
    await ligar(tokenAdmin, 'tenant', 'vendedor', false);
    try {
      return await fn();
    } finally {
      await ligar(tokenAdmin, 'tenant', 'vendedor', true);
    }
  }

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    // hora-fixa-ok: login e Hub no relógio real (o JWT é verificado no real); só o Início usa o instante fixo
    api = await subirApi({ relogio: () => (congelado ? new Date(congelado.getTime()) : new Date()) });
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a carga do ERP precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedor1 = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    tk.vendedor2 = (await api.sessao('vendedor2@exemplo.com.br', A)).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br', A)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    for (const token of [tk.adminA, tk.adminB]) await ligar(token, 'tenant', 'integracao', true);
    // RN-INT-13 (v1: cada entidade vem de um único Conector por empresa): o Hub recusa com 422 `entidade_de_outro_conector` o
    // lote de entidade que não está em `integracao.conector.entidades`. Na fixture o Conector de A já alimenta as 8; o de B só
    // cliente e produto. Cadastra no Conector de cada tenant as entidades que o teste carrega (sem tirar as que ele já tinha) e
    // devolve a lista original no afterAll.
    for (const t of [A, B]) {
      const [orig] = await linhas<{ entidades: string[] }>('select entidades from integracao.conector where id = $1 and tenant_id = $2', [t.integracao.conector, t.tenantId]);
      if (!orig) throw new Error(`Conector ${t.integracao.identificador} não encontrado na fixture`);
      entidadesAntes.set(t.integracao.conector, orig.entidades);
      const faltam = ENTIDADES_CARREGADAS.filter((e) => !orig.entidades.includes(e));
      if (faltam.length) await api.admin.query('update integracao.conector set entidades = entidades || $2::text[] where id = $1', [t.integracao.conector, faltam]);
    }
    // eventos antigos da fixture e lotes `recebido` sem staging não podem segurar a fila (mesma premissa da T-0032)
    await despachar();
    // hora-fixa-ok: concluido_em do lote antigo da fixture, nunca comparado
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
    // linhas de base ANTES das notas (mesmo instante de out/2026)
    baseVendedorLigado = pos(await inicio(tk.vendedor1), A.usuarios.vendedor1);
    baseRamoAntigo = await semVendedor(tk.adminA, async () => pos(await inicio(tk.vendedor1), A.usuarios.vendedor1));
  }, 240_000);

  afterAll(async () => {
    for (const [id, entidades] of entidadesAntes) await api?.admin.query('update integracao.conector set entidades = $2::text[] where id = $1', [id, entidades]).catch(() => undefined);
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  it('P-01 carga do ERP pelo Hub: vendedores adotados pelo e-mail (V1 = vendedor-1, V2 = vendedor-2 em A; V1 = vendedor Beta em B) e clientes', async () => {
    await aplicar(erpA, 'vendedor', [vendedor(V1, 'vendedor@exemplo.com.br', 'Vendedor Um (ERP)'), vendedor(V2, 'vendedor2@exemplo.com.br', 'Vendedor Dois (ERP)')]);
    await aplicar(erpA, 'cliente', [
      cliente(CLI.c1, '990800000001', V1),
      cliente(CLI.c2, '990800000002', V1),
      cliente(CLI.c3, '990800000003', V1),
      cliente(CLI.c4, '990800000004', V1),
      cliente(CLI.c5, '990800000005', V1),
    ]);
    await aplicar(erpB, 'vendedor', [vendedor(V1, 'vendedor@exemplo.com.br', 'Vendedor Beta (ERP)')]);
    await aplicar(erpB, 'cliente', [cliente(CLI.b1, '990800000101', V1)]);
    const us = await linhas<{ tenant_id: string; id: string }>('select tenant_id, id from core.usuario where external_id = $1 order by tenant_id', [V1]);
    expect(us.map((u) => u.id).sort()).toEqual([A.usuarios.vendedor1, B.usuarios.vendedor].sort());
    expect(await linhas('select id from core.usuario where external_id = $1', [V2])).toEqual([{ id: A.usuarios.vendedor2 }]);
    expect(await eventosComFalha(A.tenantId)).toEqual([]);
    expect(await eventosComFalha(B.tenantId)).toEqual([]);
  });

  it('P-02 consumidor da nota (migração 0025): grava vendedor_external_id e usuario_id do vendedor DA NOTA; nota sem vendedor fica nula; cada tenant com o seu', async () => {
    const resA = await aplicar(erpA, 'nota', NOTAS_A.map(nota));
    expect(resA.contagens).toMatchObject({ recebidas: NOTAS_A.length, com_erro: 0, novas: NOTAS_A.length });
    await aplicar(erpB, 'nota', NOTAS_B.map(nota));
    const gravadas = await linhas<{ tenant_id: string; external_id: string; vendedor_external_id: string | null; usuario_id: string | null; ano_mes: string }>(
      'select tenant_id, external_id, vendedor_external_id, usuario_id, ano_mes from core.nota_erp where external_id = any($1) and deleted_at is null order by external_id',
      [Object.values(NF)],
    );
    const de = (ext: string) => gravadas.filter((g) => g.external_id === ext);
    expect(gravadas).toHaveLength(Object.values(NF).length);
    expect(de(NF.n1)).toEqual([{ tenant_id: A.tenantId, external_id: NF.n1, vendedor_external_id: V1, usuario_id: A.usuarios.vendedor1, ano_mes: '2026-10' }]);
    expect(de(NF.n5)).toEqual([{ tenant_id: A.tenantId, external_id: NF.n5, vendedor_external_id: null, usuario_id: null, ano_mes: '2026-10' }]);
    // o vendedor da NOTA (V2), não o dono do cliente na carteira (V1)
    expect(de(NF.n8)).toMatchObject([{ vendedor_external_id: V2, usuario_id: A.usuarios.vendedor2 }]);
    // RN-CORE-11: 01/10 03h30 UTC = 30/09 23h30 em Manaus
    expect(de(NF.n6)).toMatchObject([{ ano_mes: '2026-09' }]);
    // mesmo external_id de vendedor (V1) nos dois tenants: cada nota aponta para o usuário do PRÓPRIO tenant
    expect(de(NF.b1)).toEqual([{ tenant_id: B.tenantId, external_id: NF.b1, vendedor_external_id: V1, usuario_id: B.usuarios.vendedor, ano_mes: '2026-10' }]);
    expect(await eventosComFalha(A.tenantId)).toEqual([]);
    expect(await eventosComFalha(B.tenantId)).toEqual([]);
  });

  // D-T0080a (fechado): a fonte ERP liga pela Integração ativa em `plataforma.tenant_modulo`, não pelos módulos do usuário
  // (tenant ∩ perfil, RN-CORE-03). O manifesto da Integração declara perfis ['admin', 'analista'] e nem a fixture nem a demo
  // (db/seeds/demo/demo.ts, PERFIL_MODULOS) dão 'integracao' ao vendedor/supervisor: é o mundo real, e P-04 garante isso.
  it('P-03 [D-T0080a] Integração ativa no TENANT (perfil vendedor sem a licença, como na demo) e Vendedor desligado: positivação pelas notas', async () => {
    expect(ids(await api.meusModulos(tk.vendedor1)), 'vendedor-1 sem a licença da Integração no perfil').not.toContain('integracao');
    const r = await semVendedor(tk.adminA, () => inicio(tk.vendedor1));
    expect(pos(r, A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 1 });
  });

  it('P-04 premissa dos casos seguintes: Integração ativa no tenant, mas NENHUM dos perfis consultados (vendedor, supervisor em A; vendedor em B) tem a licença dela', async () => {
    const tenants = await linhas<{ tenant_id: string }>(
      "select tenant_id from plataforma.tenant_modulo where modulo = 'integracao' and ativo and deleted_at is null and tenant_id = any($1) order by tenant_id",
      [[A.tenantId, B.tenantId]],
    );
    expect(tenants.map((t) => t.tenant_id)).toEqual([A.tenantId, B.tenantId].sort());
    for (const [nome, token] of [['vendedor-1', tk.vendedor1], ['vendedor-2', tk.vendedor2], ['supervisor', tk.supervisor], ['vendedor Beta', tk.vendedorB]] as const) {
      expect(ids(await api.meusModulos(token)), `${nome} sem 'integracao' nos módulos do usuário`).not.toContain('integracao');
    }
  });

  it('P-05 RN-CORE-27, Vendedor desligado: cliente com 2 notas conta 1 (no 1º dia); devolução não positiva; nota sem vendedor não conta; nota de setembro no fuso fica fora', async () => {
    await semVendedor(tk.adminA, async () => {
      const r1 = await inicio(tk.vendedor1);
      expect(r1.dia).toBe('2026-10-20');
      // C1 (N1 05/10 + N2 12/10) até ontem; C2 (N3 hoje) hoje; C3 sem vendedor, C4 em setembro, C5 só devolução: fora
      expect(pos(r1, A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 1 });
      // o mesmo cliente C1 positiva também o vendedor-2 pela nota DELE (N8 10/10); uma vez para cada vendedor
      expect(pos(await inicio(tk.vendedor2), A.usuarios.vendedor2)).toEqual({ ate_ontem: 1, hoje: 0 });
      // supervisor da Equipe 1: vê o vendedor-1 com os mesmos números; o promotor segue sem positivação (RN-PRO-01)
      const sup = await inicio(tk.supervisor);
      expect(pos(sup, A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 1 });
      expect(pos(sup, A.usuarios.promotor)).toBeNull();
    });
  });

  it('P-06 idempotência (RN-INT-02): o MESMO lote de notas de novo (outra Idempotency-Key) não duplica nota, não publica evento e não muda a positivação', async () => {
    const eventos = async () => (await linhas<{ n: number }>("select count(*)::int as n from plataforma.evento where tenant_id = $1 and nome = 'integracao.nota.atualizado@1'", [A.tenantId]))[0]!.n;
    const antes = await eventos();
    // os MESMOS registros que o Hub guardou (mesmo conteúdo e mesmo alterado_em), num lote novo com outra Idempotency-Key
    const iguais = await linhas<{ payload: Record<string, unknown> }>(
      "select payload from integracao.registro_atual where tenant_id = $1 and entidade = 'nota' and external_id = any($2) and deleted_at is null",
      [A.tenantId, NOTAS_A.map((n) => n.ext)],
    );
    expect(iguais).toHaveLength(NOTAS_A.length);
    const res = await aplicar(erpA, 'nota', iguais.map((l) => l.payload), sha256(`${P}-reenvio-notas`));
    expect(res.contagens).toMatchObject({ recebidas: NOTAS_A.length, com_erro: 0, novas: 0, atualizadas: 0 });
    expect(await eventos()).toBe(antes);
    const contagem = await linhas<{ external_id: string; n: number }>(
      'select external_id, count(*)::int as n from core.nota_erp where external_id = any($1) group by external_id',
      [NOTAS_A.map((n) => n.ext)],
    );
    expect(contagem.every((c) => c.n === 1), JSON.stringify(contagem)).toBe(true);
    await semVendedor(tk.adminA, async () => {
      expect(pos(await inicio(tk.vendedor1), A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 1 });
    });
  });

  it('P-07 RN-CORE-27: nota cancelada depois retira o cliente se não houver outra no mês (C2 sai); com outra válida, continua (C1 fica pela N2)', async () => {
    const n3 = NOTAS_A.find((n) => n.ext === NF.n3)!;
    const n1 = NOTAS_A.find((n) => n.ext === NF.n1)!;
    await aplicar(erpA, 'nota', [nota({ ...n3, cancelada: true })]);
    await semVendedor(tk.adminA, async () => {
      expect(pos(await inicio(tk.vendedor1), A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 0 });
    });
    await aplicar(erpA, 'nota', [nota({ ...n1, cancelada: true })]);
    expect(await linhas('select cancelada from core.nota_erp where external_id = any($1) order by external_id', [[NF.n1, NF.n3]])).toEqual([{ cancelada: true }, { cancelada: true }]);
    await semVendedor(tk.adminA, async () => {
      expect(pos(await inicio(tk.vendedor1), A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 0 });
    });
  });

  it('P-08 Vendedor LIGADO: vale só o pedido (RN-CORE-20); as notas não somam (mesmo número da linha de base, antes de qualquer nota)', async () => {
    const r = await inicio(tk.vendedor1);
    expect(pos(r, A.usuarios.vendedor1)).toEqual(baseVendedorLigado);
    expect(baseVendedorLigado, 'com o Vendedor ligado a positivação tem fonte (pedido)').not.toBeNull();
  });

  it('P-09 multi-tenant: vendedor Beta conta só a nota de B (mesmo external_id de vendedor V1 que em A); A não muda; nenhuma nota de um tenant no outro', async () => {
    await semVendedor(tk.adminB, async () => {
      const rb = await inicio(tk.vendedorB);
      expect(rb.usuarios.map((u) => u.usuario_id)).toEqual([B.usuarios.vendedor]);
      expect(pos(rb, B.usuarios.vendedor)).toEqual({ ate_ontem: 1, hoje: 0 });
    });
    await semVendedor(tk.adminA, async () => {
      expect(pos(await inicio(tk.vendedor1), A.usuarios.vendedor1)).toEqual({ ate_ontem: 1, hoje: 0 });
    });
    const porTenant = await linhas<{ tenant_id: string; external_id: string }>('select tenant_id, external_id from core.nota_erp where external_id = any($1)', [Object.values(NF)]);
    expect(porTenant.filter((l) => l.tenant_id === B.tenantId).map((l) => l.external_id)).toEqual([NF.b1]);
    expect(porTenant.filter((l) => l.tenant_id === A.tenantId).map((l) => l.external_id)).not.toContain(NF.b1);
    // RLS: como macuxi_app no tenant B, nenhuma nota de A aparece
    const c = await api.pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, B.tenantId);
      const vistas = (await c.query<{ external_id: string }>('select external_id from core.nota_erp where external_id = any($1)', [Object.values(NF)])).rows.map((l) => l.external_id);
      expect(vistas.every((e) => e === NF.b1), JSON.stringify(vistas)).toBe(true);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('P-10 mês novo zera: em 03/11 o vendedor-1 e o vendedor-2 ficam com 0 (não nulo: a fonte ERP existe no tenant)', async () => {
    await semVendedor(tk.adminA, async () => {
      const r1 = await inicio(tk.vendedor1, NOV);
      expect(r1.periodo).toBe('2026-11');
      expect(pos(r1, A.usuarios.vendedor1)).toEqual({ ate_ontem: 0, hoje: 0 });
      expect(pos(await inicio(tk.vendedor2, NOV), A.usuarios.vendedor2)).toEqual({ ate_ontem: 0, hoje: 0 });
    });
  });

  it('P-11 Integração desligada no tenant (Vendedor desligado): volta ao ramo antigo (core.positivacao_do_mes), igual à linha de base sem notas', async () => {
    await ligar(tk.adminA, 'tenant', 'integracao', false);
    try {
      await semVendedor(tk.adminA, async () => {
        expect(pos(await inicio(tk.vendedor1), A.usuarios.vendedor1)).toEqual(baseRamoAntigo);
      });
    } finally {
      await ligar(tk.adminA, 'tenant', 'integracao', true);
    }
  });
});
