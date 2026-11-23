/**
 * v1.0.31 "Zerar dados" (ADR 0068; RN-PLA-12; desenho docs/desenho/empresa-zerar.md §3 a §6 e §11, roteiro do testes) ponta a ponta na
 * API REAL (`createApp` com os 8 módulos, portal com o pool do `macuxi_portal`, ações da empresa ligadas como no servidor com
 * `MACUXI_EMPRESA_ACOES=1`), o worker REAL do zerar (`criarWorkerZerar`, papel `macuxi_worker`) e o Hub REAL (`POST /integracao/v1/lotes`
 * → despachante → consumidores do Core), no banco efêmero dois-tenants. A regra do que sai é a `plataforma.limpar_cadastros` (0100),
 * testada tabela a tabela no `db/testes/empresa-zerar.db.test.ts` (banco-dados); aqui ficam os critérios entre módulos:
 *  Z-01 só o super-admin: anônimo 401, token do BKO 401 e admin do cliente no portal 403 no pedido e na leitura da prévia
 *       (`POST …/zerar/previa`, `GET …/zerar/previa/:previa_id`) e no pedido e na leitura do zerar;
 *       no `GET /v1/integracao/monitor/detalhes`, anônimo 401 e BKO e admin do cliente 403; o super-admin lê os detalhes (200) e nada é pedido;
 *  Z-02 o super-admin reprocessa um lote pelo portal (`POST /v1/integracao/lotes/:id/reprocessar`, `superAdmin: 'aceita'`): volta a
 *       `recebido`, a auditoria diz `via: super_admin` e o despachante conclui de novo;
 *  Z-03 Hub em processamento: a prévia mostra o bloqueio e o pedido = 409 `ZERAR_HUB_PROCESSANDO`; nada é pedido;
 *  A prévia é do worker (0100 revista): `POST …/zerar/previa` (202 em_andamento) → `cicloPrevia` do worker real → `GET
 *  …/zerar/previa/:previa_id` pronta; "prévia = executado" = as mesmas (tabela, linhas) com contagem e o mesmo total (soft + físico).
 *  Z-04 zerar por entidade (`cliente`): prévia = executado; prévia idempotente pelo id; a cascata leva endereço, título e nota; produto e o outro tenant intactos;
 *       ficam usuários, perfis, credenciais, conectores, plano, licenças e parâmetros; pedido idempotente pelo id; a cópia de cada
 *       linha está em `plataforma.limpeza_copia` ANTES de a linha sair (gatilho espião, mesma transação); cursor da entidade nulo e
 *       `registro_atual` sem o hash velho;
 *  Z-05 `restaurar_limpeza` (workflow) volta as contagens, o `registro_atual` e o cursor;
 *  Z-06 o ERP reenvia depois do zerar: a MESMA carga de clientes, endereços, títulos e notas (mesma chave de idempotência) é aceita
 *       como NOVA (não `repetido` nem `inalterada`) e recria as linhas — a cascata também apaga lote, registro_atual e cursor; B intacto;
 *  Z-07 erro no meio da limpeza (gatilho que falha no `core.nota_erp`, depois de o Hub e os clientes já terem saído na transação):
 *       o zerar fecha `falhou` (`ZERAR_FALHOU`) e nada sai, nem a cópia fica;
 *  Z-08 a empresa inteira: prévia = executado; o total da prévia = a soma das linhas fora de core.filial, plataforma.sync_pacote e
 *       plataforma.tenant (valor × regra); ficam administradores, perfis, credenciais, conectores, plano, licenças e parâmetros (os
 *       usuários não administradores saem); todos os cursores nulos e nenhum `registro_atual`; o ERP reenvia e as linhas voltam; B intacto;
 *  Z-09 teto de 3 tentativas: a prévia e o zerar pegados 3 vezes sem fechar (o processo caiu) fecham `falhou` `ZERAR_FALHOU` na 4ª
 *       vez; o zerar audita `tenant.zerar_falhou` e nada sai;
 *  Z-10 a trava é só da empresa: com a prévia e com o zerar de A abertos numa transação do worker (locks seguros), o Hub de B
 *       recebe e conclui um lote; depois o zerar de A conclui.
 * Sem banco (ou sem os papéis do portal e do worker) o describe é pulado; com MACUXI_PG_EXIGIR=1 a falta do banco é erro.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CursorEntidade, LoteAceito, LoteResultado, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import {
  CABECALHO_TENANT_PLATAFORMA,
  CODIGOS_ZERAR_EMPRESA,
  ENTIDADES_ZERAR,
  ERROS_WORKER_ZERAR,
  mensagemDaPreviaZerar,
  PreviaZerarSchema,
  ZerarEmpresaSchema,
  type LinhaLimpeza,
  type LinhaPreviaZerar,
  type PreviaZerar,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { criarWorkerZerar } from '../../../apps/api/src/empresa-zerar-worker';
import { A, B, comToken, erroDe, licenca, novoIp, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { criarSuperAdmin, criarUsuarioNoTenant, escolherEmpresa, sessaoDoPortal } from '../apoio/portal';

const ESTADO = estadoBanco();
const SEM_PAPEIS = ESTADO.disponivel && (!ESTADO.urlPortal || !ESTADO.urlWorker) ? 'sem as senhas do macuxi_portal ou do macuxi_worker' : null;
const Z = CODIGOS_ZERAR_EMPRESA;

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-v1031-zerar-dados';
const SA = { email: 'operador.zerar.v1031@exemplo.com.br', nome: 'Operador Zerar Fictício', senha: 'Zerar#Portal-V1031' };
const CLIENTE_PORTAL = { email: 'admin.portal.zerar.v1031@exemplo.com.br', nome: 'Admin Portal Zerar Fictício', senha: 'Cliente#Zerar-V1031' };
const P = `Z31${randomUUID().slice(0, 4).toUpperCase()}`;
const EXT = {
  c1: `${P}-C1`,
  c2: `${P}-C2`,
  e1: `${P}-E1`,
  t1: `${P}-T1`,
  n1: `${P}-N1`,
  p1: `${P}-P1`,
  p2: `${P}-P2`,
  bc1: `${P}-BC1`,
  bp1: `${P}-BP1`,
} as const;
const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.31';
const IP_B = '203.0.113.31';
type EntidadeHub = 'cliente' | 'cliente_endereco' | 'titulo' | 'nota' | 'produto';
const ENTIDADES_A: readonly EntidadeHub[] = ['cliente', 'cliente_endereco', 'titulo', 'nota', 'produto'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
let seq = 0;
// hora-fixa-ok: alterado_em do Hub no relógio real (só ordena as versões da linha)
const alterado = () => new Date(Date.now() - 3_600_000 + (seq += 1) * 1_000).toISOString();
// hora-fixa-ok: emissão de 10 dias atrás (só um dado do título e da nota)
const DIA = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
const doc = (raiz: string) => {
  // CNPJ fictício com dígitos verificadores válidos (o Core confere o documento)
  const d = raiz.split('').map(Number);
  const dv = (n: number[]) => {
    const pesos = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = n.reduce((a, x, i) => a + x * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join('');
};

/** Corpo e cabeçalhos de um lote, como o apps/conector monta (a chave é o SHA-256 do conteúdo, sem o `enviado_em`). */
interface Carga {
  entidade: EntidadeHub;
  conector: string;
  chave: string;
  corpo: Record<string, unknown>;
  tenant: Tenant;
}
const carga = (t: Tenant, entidade: EntidadeHub, registros: object[], geracao = ''): Carga => {
  const conector = t.integracao.identificador;
  const corpo = { versao_contrato: VERSAO_CONTRATO, entidade, modo: 'delta' as const, conector_id: conector, versao_conector: VERSAO_CONECTOR, enviado_em: alterado(), registros };
  return { entidade, conector, corpo, tenant: t, chave: sha256(JSON.stringify({ ...corpo, enviado_em: undefined, geracao })) };
};

describe.skipIf(semBanco() || !!SEM_PAPEIS)('v1.0.31 — Zerar dados da empresa (portal + worker + Hub, createApp real × Postgres; ADR 0068, RN-PLA-12)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const tk = { sa: '', cliente: '', bkoA: '', bkoB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  const segredoAntes = process.env.MACUXI_JWT_SEGREDO_PLATAFORMA;
  const cargas: Partial<Record<EntidadeHub, Carga>> = {};
  const cargasB: Carga[] = [];
  let medidaA = '';
  let medidaB = '';
  let loteProdutoA = '';
  const lotesOriginais: Partial<Record<EntidadeHub, string>> = {};

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const um = async <T>(sql: string, p: unknown[] = []): Promise<T> => Object.values((await q(sql, p))[0] ?? {})[0] as T;

  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 60 ciclos');
  };
  const cabecalhosHub = (c: { tenant: Tenant }, chave?: string) => ({
    authorization: `Bearer ${c.tenant.integracao.chave.chave}`,
    'x-macuxi-conector-id': c.tenant.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
    ...(chave ? { 'idempotency-key': chave } : {}),
  });
  const ipDe = (t: Tenant) => (t.tenantId === B.tenantId ? IP_B : IP_A);
  /** Envia pelo Hub, despacha e devolve o aceite e o resultado do lote. */
  async function enviar(c: Carga): Promise<{ aceito: LoteAceito; resultado: LoteResultado }> {
    const r = await api.app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabecalhosHub(c, c.chave), remoteAddress: ipDe(c.tenant), payload: c.corpo });
    expect(r.statusCode, `${c.tenant.codigo}/${c.entidade}: ${r.body}`).toBe(202);
    const aceito = LoteAceito.parse(r.json());
    await despachar();
    const l = await api.app.inject({ method: 'GET', url: `/integracao/v1/lotes/${aceito.lote_id}`, headers: cabecalhosHub(c), remoteAddress: ipDe(c.tenant) });
    expect(l.statusCode, l.body).toBe(200);
    const resultado = LoteResultado.parse(l.json());
    expect(resultado.erros, `${c.tenant.codigo}/${c.entidade}: ${JSON.stringify(resultado.erros)}`).toEqual([]);
    expect(resultado.status, `${c.tenant.codigo}/${c.entidade}`).toBe('concluido');
    return { aceito, resultado };
  }
  const cursor = async (t: Tenant, entidade: string) => {
    const r = await api.app.inject({ method: 'GET', url: `/integracao/v1/cursores/${entidade}`, headers: cabecalhosHub({ tenant: t }), remoteAddress: ipDe(t) });
    expect(r.statusCode, `${t.codigo}/${entidade}: ${r.body}`).toBe(200);
    return CursorEntidade.parse(r.json()).cursor;
  };

  // ---------- portal ----------
  const urlEmpresa = (resto: string, t: Tenant = A) => `/v1/plataforma/empresas/${t.tenantId}/${resto}`;
  const comoPortal = (token: string | null, op: InjectOptions & { url: string }, tenant?: Tenant): Promise<LightMyRequestResponse> =>
    api.app.inject({ ...op, remoteAddress: novoIp(), headers: { ...comToken(token), ...(tenant ? { [CABECALHO_TENANT_PLATAFORMA]: tenant.tenantId } : {}), ...((op.headers as Record<string, string>) ?? {}) } });
  const pedirPrevia = (id: string, entidades?: string[]) =>
    comoPortal(tk.sa, { method: 'POST', url: urlEmpresa('zerar/previa'), payload: { id, ...(entidades ? { entidades } : {}) } });
  const lerPrevia = async (id: string): Promise<PreviaZerar> => {
    const r = await comoPortal(tk.sa, { method: 'GET', url: urlEmpresa(`zerar/previa/${id}`) });
    expect(r.statusCode, r.body).toBe(200);
    return PreviaZerarSchema.parse(r.json());
  };
  /** Pede a prévia (202 em andamento), roda o worker real (`cicloPrevia`) e devolve a prévia pronta lida pelo portal. */
  async function previa(entidades?: string[]): Promise<PreviaZerar> {
    const id = randomUUID();
    const r = await pedirPrevia(id, entidades);
    expect(r.statusCode, r.body).toBe(202);
    expect(PreviaZerarSchema.parse(r.json())).toMatchObject({ id, situacao: 'em_andamento', linhas: null, total: null, erro_codigo: null });
    expect(await criarWorkerZerar({ pool: worker }).cicloPrevia()).toBe('pronta');
    const p = await lerPrevia(id);
    expect(p).toMatchObject({ id, situacao: 'pronta', erro_codigo: null });
    return p;
  }
  /** "prévia = executado": as mesmas (tabela, linhas) com contagem, como multiconjunto (a prévia não tem o modo). */
  const tabelasComLinhas = (l: readonly (LinhaLimpeza | LinhaPreviaZerar)[]) =>
    l.filter((x) => x.linhas > 0).map((x) => `${x.tabela}|${x.linhas}`).sort();
  const pedir = (id: string, entidades: string[] | null, extra: Record<string, unknown> = {}) =>
    comoPortal(tk.sa, { method: 'POST', url: urlEmpresa('zerar'), payload: { id, codigo_confirmacao: A.codigo, senha: SA.senha, ...(entidades ? { entidades } : {}), ...extra } });
  const lerZerar = async (): Promise<ZerarEmpresa> => {
    const r = await comoPortal(tk.sa, { method: 'GET', url: urlEmpresa('zerar') });
    expect(r.statusCode, r.body).toBe(200);
    return ZerarEmpresaSchema.parse(r.json());
  };
  /** Pede, roda o worker real e devolve o zerar concluído. */
  async function zerar(entidades: string[] | null): Promise<ZerarEmpresa> {
    const id = randomUUID();
    const r = await pedir(id, entidades);
    expect(r.statusCode, r.body).toBe(202);
    expect(await criarWorkerZerar({ pool: worker }).ciclo()).toBe('concluido');
    const z = await lerZerar();
    expect(z).toMatchObject({ id, situacao: 'concluido', erro_codigo: null });
    return z;
  }

  // ---------- retratos ----------
  /** Vivos com external_id do prefixo deste arquivo, por tabela, num tenant. */
  const vivos = async (t: Tenant = A) =>
    (
      await q<{ r: Record<string, number> }>(
        `select jsonb_build_object(
           'cliente', (select count(*) from core.cliente where tenant_id = $1 and deleted_at is null and external_id like $2),
           'cliente_endereco', (select count(*) from core.cliente_endereco where tenant_id = $1 and deleted_at is null and external_id like $2),
           'titulo', (select count(*) from core.titulo where tenant_id = $1 and deleted_at is null and external_id like $2),
           'nota', (select count(*) from core.nota_erp where tenant_id = $1 and deleted_at is null and external_id like $2),
           'produto', (select count(*) from core.produto where tenant_id = $1 and deleted_at is null and external_id like $2),
           'registro_atual', (select count(*) from integracao.registro_atual where tenant_id = $1 and external_id like $2),
           'usuarios', (select count(*) from core.usuario where tenant_id = $1 and deleted_at is null)) as r`,
        [t.tenantId, `${P}-%`],
      )
    )[0]!.r;
  /**
   * O que FICA (RN-PLA-12), sem `updated_at`: administradores, perfis e o vínculo dos administradores, credenciais, conectores, plano,
   * licenças (módulos do tenant e dos perfis) e parâmetros. `todosUsuarios` = também os não administradores (zerar por entidade).
   */
  const ficam = async (todosUsuarios: boolean) =>
    (
      await q<{ r: Record<string, string | null> }>(
        `with adm as (select u.id from core.usuario u where u.tenant_id = $1 and ($2 or u.perfil = 'admin'))
         select jsonb_build_object(
           'usuarios', (select md5(string_agg((to_jsonb(u) - 'updated_at')::text, '|' order by u.id)) from core.usuario u where u.id in (select id from adm)),
           'usuario_perfil', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.usuario_perfil x where x.tenant_id = $1 and x.usuario_id in (select id from adm)),
           'perfis', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.perfil x where x.tenant_id = $1),
           'perfil_modulo', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.perfil_modulo x where x.tenant_id = $1),
           'perfil_permissao', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.perfil_permissao x where x.tenant_id = $1),
           'credenciais', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from integracao.credencial x where x.tenant_id = $1),
           'conectores', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from integracao.conector x where x.tenant_id = $1),
           'assinatura', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.assinatura x where x.tenant_id = $1),
           'tenant_modulo', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.tenant_modulo x where x.tenant_id = $1),
           'parametros', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from plataforma.parametro x where x.tenant_id = $1)) as r`,
        [A.tenantId, todosUsuarios],
      )
    )[0]!.r;
  /** Retrato do OUTRO tenant (B): domínio e Hub inteiros, sem `updated_at`. */
  const retratoB = async () =>
    (
      await q<{ r: Record<string, string | null> }>(
        `select jsonb_build_object(${[
          'core.cliente',
          'core.cliente_endereco',
          'core.produto',
          'core.usuario',
          'core.filial',
          'vendedor.pedido',
          'integracao.registro_atual',
          'integracao.cursor_entidade',
          'integracao.lote',
          'integracao.conector',
          'integracao.credencial',
          'plataforma.tenant_modulo',
        ]
          .map((t) => `'${t}', (select md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by x.id)) from ${t} x where x.tenant_id = $1)`)
          .join(', ')}) as r`,
        [B.tenantId],
      )
    )[0]!.r;
  const copias = (lote?: string) => um<string>(`select count(*)::text from plataforma.limpeza_copia where empresa_id = $1 ${lote ? 'and lote = $2' : ''}`, lote ? [A.tenantId, lote] : [A.tenantId]).then(Number);
  const pedidosZerar = () => um<string>('select count(*)::text from plataforma.zerar_empresa where empresa_id = $1', [A.tenantId]).then(Number);

  // ---------- massa do Hub ----------
  const cliente = (ext: string, n: number) => ({
    external_id: ext,
    alterado_em: alterado(),
    razao_social: `Mercado ${ext} Ltda`,
    nome_fantasia: `Mercado ${ext}`,
    documento: doc(`31031031000${n}`),
    inscricao_estadual: 'ISENTO',
    vendedor_external_id: null,
    endereco: { logradouro: 'Av. Constantino Nery', numero: `${n}`, bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69010-000' },
    latitude: -3.1,
    longitude: -60.02,
    telefone: null,
    email: null,
    limite_credito_cents: 1_000_000,
    contatos: [],
  });
  const produto = (ext: string, sigla: string) => ({ external_id: ext, alterado_em: alterado(), sku: `${ext}-SKU`, ean: null, nome: `Produto ${ext}`, marca: null, categoria: null, unidade: sigla });

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    process.env.MACUXI_JWT_SEGREDO_PLATAFORMA = SEGREDO_PLATAFORMA;
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA }, empresaAcoesPortal: true, planosPortal: true });
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker: o zerar e a carga do ERP precisam do worker');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.bkoA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.bkoB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    for (const [t, token] of [
      [A, tk.bkoA],
      [B, tk.bkoB],
    ] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
    }
    // o Conector de A recebe as entidades da massa; o de B já tem cliente e produto
    await q('update integracao.conector set entidades = (select array(select distinct unnest(entidades || $2::text[]))) where id = $1', [A.integracao.conector, ENTIDADES_A]);
    await despachar();
    // hora-fixa-ok: os lotes abertos da fixture ficam concluídos (sem isso o zerar é recusado por Hub em processamento)
    await q("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    medidaA = await um<string>('select sigla from core.medida where tenant_id = $1 and deleted_at is null order by sigla limit 1', [A.tenantId]);
    medidaB = await um<string>('select sigla from core.medida where tenant_id = $1 and deleted_at is null order by sigla limit 1', [B.tenantId]);
    expect(medidaA && medidaB, 'medida cadastrada nos dois tenants').toBeTruthy();

    // super-admin (deploy) e o admin do cliente no portal
    await criarSuperAdmin(api.admin, SA);
    tk.sa = (await sessaoDoPortal(api, SA.email, SA.senha)).token;
    await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...CLIENTE_PORTAL });
    const s = await sessaoDoPortal(api, CLIENTE_PORTAL.email, CLIENTE_PORTAL.senha);
    if (s.empresa?.id === A.tenantId) tk.cliente = s.token;
    else {
      const esc = await escolherEmpresa(api, s.token, A.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      tk.cliente = (esc.json() as { token: string }).token;
    }
    // plano da empresa (fica)
    const plano = await comoPortal(tk.sa, { method: 'POST', url: urlEmpresa('assinatura'), payload: { plano: 'pme', ciclo: 'mensal', adicionais: [], pedido_id: randomUUID() } });
    expect([201, 409], plano.body).toContain(plano.statusCode); // a fixture pode já trazer o plano (409 ASSINATURA_EXISTENTE)
    expect(await um<string>('select count(*)::text from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [A.tenantId])).toBe('1');

    // carga do ERP em A (pela ordem de carga) e em B
    cargas.produto = carga(A, 'produto', [produto(EXT.p1, medidaA), produto(EXT.p2, medidaA)]);
    cargas.cliente = carga(A, 'cliente', [cliente(EXT.c1, 1), cliente(EXT.c2, 2)]);
    cargas.cliente_endereco = carga(A, 'cliente_endereco', [
      { external_id: EXT.e1, alterado_em: alterado(), cliente_external_id: EXT.c1, tipo: 'entrega', logradouro: 'Rua de Entrega', numero: '10', cidade: 'Manaus', uf: 'AM', cep: '69010-001' },
    ]);
    cargas.titulo = carga(A, 'titulo', [
      { external_id: EXT.t1, alterado_em: alterado(), cliente_external_id: EXT.c1, numero: `${P}/1`, parcela: 1, emissao: DIA, vencimento: DIA, valor_cents: 12_300, saldo_cents: 12_300, situacao: 'aberto' },
    ]);
    cargas.nota = carga(A, 'nota', [
      {
        external_id: EXT.n1,
        alterado_em: alterado(),
        cliente_external_id: EXT.c1,
        vendedor_external_id: null,
        tipo: 'faturamento',
        numero: '310310',
        serie: '1',
        emitida_em: `${DIA}T15:00:00Z`,
        total_cents: 12_300,
        quantidade_itens: 1,
        pedido_uuid: null,
        cancelada: false,
      },
    ]);
    for (const e of ['produto', 'cliente', 'cliente_endereco', 'titulo', 'nota'] as const) {
      const { aceito } = await enviar(cargas[e]!);
      lotesOriginais[e] = aceito.lote_id;
      if (e === 'produto') loteProdutoA = aceito.lote_id;
    }
    cargasB.push(carga(B, 'produto', [produto(EXT.bp1, medidaB)]), carga(B, 'cliente', [cliente(EXT.bc1, 9)]));
    for (const c of cargasB) await enviar(c);
    expect(await vivos()).toMatchObject({ cliente: 2, cliente_endereco: 1, titulo: 1, nota: 1, produto: 2 });
    expect(await vivos(B)).toMatchObject({ cliente: 1, produto: 1 });
  }, 300_000);

  afterAll(async () => {
    await worker?.end();
    await api?.fechar();
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    if (segredoAntes === undefined) delete process.env.MACUXI_JWT_SEGREDO_PLATAFORMA;
    else process.env.MACUXI_JWT_SEGREDO_PLATAFORMA = segredoAntes;
  });

  it('Z-01 só o super-admin: anônimo 401, BKO 401 e admin do cliente 403 no zerar; monitor/detalhes 401 anônimo e 403 BKO e admin do cliente; o super-admin lê os detalhes', async () => {
    const rotas: (InjectOptions & { url: string })[] = [
      { method: 'POST', url: urlEmpresa('zerar/previa'), payload: { id: randomUUID() } },
      { method: 'POST', url: urlEmpresa('zerar/previa'), payload: { id: randomUUID(), entidades: ['cliente'] } },
      { method: 'GET', url: urlEmpresa(`zerar/previa/${randomUUID()}`) },
      { method: 'POST', url: urlEmpresa('zerar'), payload: { id: randomUUID(), codigo_confirmacao: A.codigo, senha: CLIENTE_PORTAL.senha } },
      { method: 'POST', url: urlEmpresa('zerar'), payload: { id: randomUUID(), codigo_confirmacao: A.codigo, senha: CLIENTE_PORTAL.senha, entidades: ['cliente'] } },
      { method: 'GET', url: urlEmpresa('zerar') },
    ];
    for (const op of rotas) {
      const nome = `${op.method} ${op.url}`;
      expect((await comoPortal(null, op)).statusCode, `anônimo ${nome}`).toBe(401);
      expect((await comoPortal(tk.bkoA, op)).statusCode, `token do BKO ${nome}`).toBe(401);
      const cli = await comoPortal(tk.cliente, op);
      expect([cli.statusCode, erroDe(cli).codigo], `admin do cliente ${nome}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
    }
    const detalhes = { method: 'GET' as const, url: '/v1/integracao/monitor/detalhes' };
    expect((await comoPortal(null, detalhes, A)).statusCode, 'anônimo monitor/detalhes').toBe(401);
    // `superAdmin: 'exige'`: o admin do tenant (BKO) e o admin do cliente no portal têm o monitor, mas não os detalhes
    for (const [quem, r] of [
      ['BKO', await comoPortal(tk.bkoA, detalhes)],
      ['admin do cliente', await comoPortal(tk.cliente, detalhes, A)],
    ] as const)
      expect([r.statusCode, erroDe(r).codigo], `${quem} monitor/detalhes`).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const ok = await comoPortal(tk.sa, detalhes, A);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.body).toContain('erp-alfa');
    expect(ok.body, 'detalhes sem dado de linha (só códigos e contagens)').not.toContain('Mercado');
    expect(await pedidosZerar(), 'nada foi pedido').toBe(0);
    expect(await um<string>('select count(*)::text from plataforma.zerar_previa where empresa_id = $1', [A.tenantId]), 'nenhuma prévia pedida').toBe('0');
    // a prévia do super-admin não é lida pelo admin do cliente (403, nunca o conteúdo)
    const pv = await previa(['cliente']);
    const cli = await comoPortal(tk.cliente, { method: 'GET', url: urlEmpresa(`zerar/previa/${pv.id}`) });
    expect([cli.statusCode, erroDe(cli).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    // prévia inexistente (ou de outra empresa) = 404 ZERAR_PREVIA_NAO_ENCONTRADA
    for (const url of [urlEmpresa(`zerar/previa/${randomUUID()}`), urlEmpresa(`zerar/previa/${pv.id}`, B)]) {
      const r = await comoPortal(tk.sa, { method: 'GET', url });
      expect([r.statusCode, erroDe(r).codigo], url).toEqual([404, Z.previaNaoEncontrada]);
    }
  });

  it('Z-02 o super-admin reprocessa um lote pelo portal: volta a recebido, auditoria via super_admin, o despachante conclui de novo', async () => {
    await q("update integracao.lote set status = 'concluido_com_erros' where tenant_id = $1 and id = $2", [A.tenantId, loteProdutoA]);
    const r = await comoPortal(tk.sa, { method: 'POST', url: `/v1/integracao/lotes/${loteProdutoA}/reprocessar`, payload: {} }, A);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ lote_id: loteProdutoA, status: 'recebido' });
    const aud = await q<{ depois: { via?: string } }>(
      "select depois from plataforma.auditoria where tenant_id = $1 and acao = 'lote.reprocessar' and entidade_id = $2 order by created_at desc limit 1",
      [A.tenantId, loteProdutoA],
    );
    expect(aud[0]?.depois.via).toBe('super_admin');
    await despachar();
    expect(await um<string>('select status from integracao.lote where id = $1', [loteProdutoA])).toBe('concluido');
    expect(await vivos()).toMatchObject({ produto: 2 });
  });

  it('Z-03 Hub em processamento: a prévia mostra o bloqueio e o pedido = 409 ZERAR_HUB_PROCESSANDO; nada é pedido', async () => {
    await q("update integracao.lote set status = 'processando' where id = $1", [loteProdutoA]);
    try {
      const p = await previa(['cliente']);
      expect(p.bloqueio).toBe(Z.hubProcessando);
      const r = await pedir(randomUUID(), ['cliente']);
      expect([r.statusCode, erroDe(r).codigo]).toEqual([409, Z.hubProcessando]);
      expect(await pedidosZerar()).toBe(0);
    } finally {
      await q("update integracao.lote set status = 'concluido' where id = $1", [loteProdutoA]);
    }
  });

  let zCliente: ZerarEmpresa;
  let antesDoZerar: Record<string, number>;

  it('Z-04 zerar `cliente`: prévia = executado; cascata leva endereço, título e nota; produto e B intactos; ficam usuários, perfis, credenciais, plano e parâmetros; cópia antes de cada linha sair', async () => {
    antesDoZerar = await vivos();
    const fica0 = await ficam(true);
    const b0 = await retratoB();
    expect(await cursor(A, 'cliente')).not.toBeNull();
    expect(await cursor(A, 'produto')).not.toBeNull();

    const pv = await previa(['cliente']);
    expect([pv.entidades, pv.bloqueio]).toEqual([['cliente'], null]);
    // idempotente: o mesmo id devolve a mesma prévia (pronta), sem contar de novo
    const deNovo = await pedirPrevia(pv.id, ['cliente']);
    expect([deNovo.statusCode, PreviaZerarSchema.parse(deNovo.json())]).toEqual([202, pv]);
    expect(await criarWorkerZerar({ pool: worker }).cicloPrevia(), 'nenhuma prévia pendente').toBeNull();
    const tabelas = new Map(pv.linhas!.map((t) => [t.tabela, t]));
    expect(tabelas.get('core.cliente')).toMatchObject({ tabela: 'core.cliente', linhas: 2 });
    for (const t of ['core.cliente_endereco', 'core.titulo', 'core.nota_erp']) expect(tabelas.get(t)?.linhas, `cascata ${t}`).toBeGreaterThanOrEqual(1);
    for (const t of ['core.produto', 'catalogo.tabela_preco', 'catalogo.estoque_saldo', 'core.usuario']) expect(tabelas.has(t), `${t} fica`).toBe(false);
    expect(pv.entidades_afetadas).toEqual(expect.arrayContaining(['cliente', 'cliente_endereco', 'titulo', 'nota']));
    expect(pv.entidades_afetadas).not.toContain('produto');
    // a prévia não muda nada
    expect(await vivos()).toEqual(antesDoZerar);
    expect(await copias()).toBe(0);

    // espião: cada linha que sai (soft no domínio, físico no Hub) já tem a cópia na limpeza_copia, na mesma transação
    await q(`create table if not exists public.zerar_espiao (tabela text not null, id uuid not null, tem_copia boolean not null)`);
    await q(`create or replace function public.zerar_espiao() returns trigger language plpgsql security definer set search_path = pg_catalog as $f$
      begin
        insert into public.zerar_espiao values (tg_table_schema || '.' || tg_table_name, old.id,
          exists (select 1 from plataforma.limpeza_copia c where c.tabela = tg_table_schema || '.' || tg_table_name and c.linha ->> 'id' = old.id::text));
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end $f$`);
    const soft = ['core.cliente', 'core.cliente_endereco', 'core.titulo', 'core.nota_erp'];
    const fisico = ['integracao.registro_atual', 'integracao.cursor_entidade', 'integracao.lote'];
    for (const t of soft)
      await q(`create trigger zerar_espiao before update on ${t} for each row when (old.deleted_at is null and new.deleted_at is not null) execute function public.zerar_espiao()`);
    for (const t of fisico) await q(`create trigger zerar_espiao before delete on ${t} for each row execute function public.zerar_espiao()`);
    try {
      // idempotência: o mesmo id devolve o mesmo zerar; outro id com este em andamento = 409
      const id = randomUUID();
      const p1 = await pedir(id, ['cliente']);
      expect(p1.statusCode, p1.body).toBe(202);
      const p2 = await pedir(id, ['cliente']);
      expect([p2.statusCode, p2.json()]).toEqual([202, p1.json()]);
      const outro = await pedir(randomUUID(), ['produto']);
      expect([outro.statusCode, erroDe(outro).codigo]).toEqual([409, Z.zerarEmAndamento]);
      expect(await criarWorkerZerar({ pool: worker }).ciclo()).toBe('concluido');
      expect(await criarWorkerZerar({ pool: worker }).ciclo(), 'um pedido, uma execução').toBeNull();
      zCliente = await lerZerar();
      expect(zCliente).toMatchObject({ id, situacao: 'concluido', entidades: ['cliente'] });
    } finally {
      for (const t of [...soft, ...fisico]) await q(`drop trigger if exists zerar_espiao on ${t}`);
    }
    // prévia = executado (mesma regra, nada mudou entre as duas)
    expect(tabelasComLinhas(zCliente.contagem!)).toEqual(tabelasComLinhas(pv.linhas!));
    expect(zCliente.linhas_apagadas).toBe(pv.total);
    expect(zCliente.entidades_afetadas).toEqual(pv.entidades_afetadas);

    const espiao = await q<{ tabela: string; n: string; sem_copia: string }>(
      'select tabela, count(*)::text as n, count(*) filter (where not tem_copia)::text as sem_copia from public.zerar_espiao group by tabela order by tabela',
    );
    const porTabela = Object.fromEntries(espiao.map((e) => [e.tabela, { n: Number(e.n), sem_copia: Number(e.sem_copia) }]));
    for (const t of [...soft, ...fisico]) expect(porTabela[t]?.n, `${t}: linhas que saíram vistas pelo espião`).toBeGreaterThan(0);
    for (const [t, v] of Object.entries(porTabela)) expect(v.sem_copia, `${t}: linha saiu sem cópia antes`).toBe(0);
    expect(await copias(zCliente.lote)).toBeGreaterThanOrEqual(espiao.reduce((a, e) => a + Number(e.n), 0));

    // saíram os clientes e a cascata; ficaram os produtos, todos os usuários, perfis, credenciais, conectores, plano, licenças e parâmetros
    expect(await vivos()).toMatchObject({ cliente: 0, cliente_endereco: 0, titulo: 0, nota: 0, produto: 2, usuarios: antesDoZerar.usuarios });
    expect(await ficam(true)).toEqual(fica0);
    expect(await retratoB(), 'o outro tenant intacto').toEqual(b0);
    // o ERP pode reenviar: cursor da entidade nulo e registro_atual sem o hash velho (das linhas que saíram, inclusive pela cascata)
    expect(await cursor(A, 'cliente')).toBeNull();
    expect(await cursor(A, 'produto')).not.toBeNull();
    // toda entidade afetada pela cascata perde lote, registro_atual e cursor (defeito do reteste v1.0.31, corrigido no 2d9578b81)
    for (const e of ['cliente_endereco', 'titulo', 'nota'] as const) {
      expect(await cursor(A, e), `cursor de ${e} (cascata)`).toBeNull();
      expect(await um<string>('select count(*)::text from integracao.lote where id = $1', [lotesOriginais[e]]), `lote de ${e} (cascata)`).toBe('0');
    }
    expect(await um<string>('select count(*)::text from integracao.lote where id = $1', [loteProdutoA]), 'o lote de produto fica').toBe('1');
    const ra = await q<{ entidade: string; n: string }>(
      'select entidade, count(*)::text as n from integracao.registro_atual where tenant_id = $1 and external_id like $2 group by entidade order by entidade',
      [A.tenantId, `${P}-%`],
    );
    expect(ra).toEqual([{ entidade: 'produto', n: '2' }]);
  });

  it('Z-05 restaurar_limpeza (workflow) volta as contagens, o registro_atual e o cursor', async () => {
    const c = await api.admin.connect();
    try {
      await c.query('begin');
      await c.query('select * from plataforma.restaurar_limpeza($1, $2)', [A.tenantId, zCliente.lote]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    expect(await vivos()).toEqual(antesDoZerar);
    expect(await cursor(A, 'cliente')).not.toBeNull();
    expect(await um<string | null>('select desfeito_em::text from plataforma.zerar_empresa where id = $1', [zCliente.id])).not.toBeNull();
    // controle: com o registro_atual de volta, a mesma carga com chave nova sai "inalterada"
    const { resultado } = await enviar(carga(A, 'cliente', cargas.cliente!.corpo.registros as object[], 'controle-z05'));
    expect(resultado.contagens).toMatchObject({ recebidas: 2, novas: 0, inalteradas: 2 });
  });

  it('Z-06 o ERP reenvia depois do zerar `cliente`: a mesma carga (mesma chave) de cliente, endereço, título e nota é aceita como nova (não repetido) e recria as linhas; B intacto', async () => {
    const b0 = await retratoB();
    const z = await zerar(['cliente']);
    expect(z.entidades_afetadas).toEqual(expect.arrayContaining(['cliente', 'cliente_endereco', 'titulo', 'nota']));
    expect(await vivos()).toMatchObject({ cliente: 0, cliente_endereco: 0, titulo: 0, nota: 0, produto: 2 });
    const idsVelhos = (await q<{ id: string }>('select id from core.cliente where tenant_id = $1 and external_id like $2', [A.tenantId, `${P}-C%`])).map((r) => r.id);

    // a MESMA carga de clientes do início (mesmo corpo, mesma Idempotency-Key): lote novo, linhas novas
    const { aceito, resultado } = await enviar(cargas.cliente!);
    expect(aceito.lote_id, 'lote novo, não o da carga original (a chave foi a mesma)').not.toBe(lotesOriginais.cliente);
    expect(aceito.repetido ?? false, 'cliente: não repetido').toBe(false);
    expect(resultado.contagens).toMatchObject({ recebidas: 2, novas: 2, atualizadas: 0, inalteradas: 0 });
    const vivosNovos = await q<{ id: string }>('select id from core.cliente where tenant_id = $1 and external_id like $2 and deleted_at is null', [A.tenantId, `${P}-C%`]);
    expect(vivosNovos).toHaveLength(2);
    for (const v of vivosNovos) expect(idsVelhos, 'cliente recriado (linha nova)').not.toContain(v.id);
    // as entidades afetadas pela cascata: o reenvio DELTA com a MESMA chave de título, nota e endereço é aceito como NOVO (não `repetido`)
    // e recria as linhas — o zerar por entidade apagou o lote, o registro_atual e o cursor de cada uma (2d9578b81)
    for (const e of ['cliente_endereco', 'titulo', 'nota'] as const) {
      expect(await cursor(A, e), `cursor de ${e} antes do reenvio`).toBeNull();
      const { aceito: a, resultado: r } = await enviar(cargas[e]!);
      expect(a.lote_id, `${e}: lote novo com a mesma chave`).not.toBe(lotesOriginais[e]);
      expect(a.repetido ?? false, `${e}: não repetido`).toBe(false);
      expect(r.contagens, e).toMatchObject({ recebidas: 1, novas: 1, atualizadas: 0, inalteradas: 0 });
    }
    expect(await vivos()).toMatchObject({ cliente: 2, cliente_endereco: 1, titulo: 1, nota: 1, produto: 2 });
    expect(await cursor(A, 'cliente')).not.toBeNull();
    expect(await retratoB()).toEqual(b0);
  });

  it('Z-07 erro no meio da limpeza (depois de o Hub e os clientes saírem na transação): fecha falhou ZERAR_FALHOU e nada sai, nem a cópia fica', async () => {
    const antes = await vivos();
    const copiasAntes = await copias();
    const cursorAntes = await cursor(A, 'cliente');
    await q(`create or replace function public.zerar_falha_no_meio() returns trigger language plpgsql set search_path = pg_catalog as $f$
      begin raise exception 'falha simulada no meio do zerar'; end $f$`);
    await q('create trigger zerar_falha_no_meio before update on core.nota_erp for each row when (old.deleted_at is null and new.deleted_at is not null) execute function public.zerar_falha_no_meio()');
    const id = randomUUID();
    try {
      const r = await pedir(id, ['cliente']);
      expect(r.statusCode, r.body).toBe(202);
      expect(await criarWorkerZerar({ pool: worker }).ciclo()).toBe('falhou');
    } finally {
      await q('drop trigger if exists zerar_falha_no_meio on core.nota_erp');
    }
    expect(await lerZerar()).toMatchObject({ id, situacao: 'falhou', erro_codigo: ERROS_WORKER_ZERAR.falhou, linhas_apagadas: null, contagem: null });
    expect(await vivos()).toEqual(antes);
    expect(await copias(), 'nenhuma cópia do lote que falhou').toBe(copiasAntes);
    expect(await cursor(A, 'cliente')).toEqual(cursorAntes);
  });

  it('Z-08 a empresa inteira: prévia = executado; ficam administradores, perfis, credenciais, conectores, plano, licenças e parâmetros; Hub zerado; o ERP reenvia e as linhas voltam; B intacto', async () => {
    const fica0 = await ficam(false);
    const b0 = await retratoB();
    const usuariosAntes = await um<string>('select count(*)::text from core.usuario where tenant_id = $1 and deleted_at is null', [A.tenantId]).then(Number);
    const admins = await um<string>("select count(*)::text from core.usuario where tenant_id = $1 and deleted_at is null and perfil = 'admin'", [A.tenantId]).then(Number);
    expect(usuariosAntes).toBeGreaterThan(admins);

    const pv = await previa();
    expect([pv.entidades, pv.bloqueio]).toEqual([null, null]);
    // valor × regra: o total da prévia (o número da tela) = as linhas que SAEM; core.filial, plataforma.sync_pacote e plataforma.tenant mudam e não saem
    const ficamNaEmpresa = new Set(['core.filial', 'plataforma.sync_pacote', 'plataforma.tenant']);
    expect(pv.total).toBe(pv.linhas!.filter((l) => !ficamNaEmpresa.has(l.tabela)).reduce((a, l) => a + l.linhas, 0));
    expect(pv.linhas!.some((l) => ficamNaEmpresa.has(l.tabela)), 'a empresa inteira mexe em filial, pacote de sync ou tenant').toBe(true);
    const z = await zerar(null);
    expect(tabelasComLinhas(z.contagem!)).toEqual(tabelasComLinhas(pv.linhas!));
    expect(z.linhas_apagadas).toBe(pv.total);

    expect(await ficam(false)).toEqual(fica0);
    expect(await vivos()).toMatchObject({ cliente: 0, cliente_endereco: 0, titulo: 0, nota: 0, produto: 0, registro_atual: 0, usuarios: admins });
    expect(await um<string>('select count(*)::text from integracao.registro_atual where tenant_id = $1', [A.tenantId])).toBe('0');
    expect(await um<string>('select count(*)::text from integracao.lote where tenant_id = $1', [A.tenantId])).toBe('0');
    for (const e of ENTIDADES_ZERAR) {
      const r = await api.app.inject({ method: 'GET', url: `/integracao/v1/cursores/${e}`, headers: cabecalhosHub({ tenant: A }), remoteAddress: IP_A });
      // 200 com cursor nulo; entidade que o Conector não recebe = recusa do Hub (nunca um cursor)
      if (r.statusCode === 200) expect(CursorEntidade.parse(r.json()).cursor, `cursor de ${e}`).toBeNull();
      else expect(r.statusCode, `${e}: ${r.body}`).toBe(403);
    }
    expect(await retratoB()).toEqual(b0);

    // a credencial ficou: o ERP reenvia a MESMA carga (mesmas chaves) e tudo volta como novo
    for (const e of ['produto', 'cliente'] as const) {
      const { resultado } = await enviar(cargas[e]!);
      expect(resultado.contagens, e).toMatchObject({ novas: 2, inalteradas: 0 });
    }
    expect(await vivos()).toMatchObject({ cliente: 2, produto: 2 });
    expect(await retratoB()).toEqual(b0);
  });

  /** Simula o processo que caiu depois de pegar o job: pega pelo worker e vence a concessão. */
  const pegarSemFechar = async (funcao: 'pegar_previa_zerar' | 'pegar_zerar', tabela: 'zerar_previa' | 'zerar_empresa', id: string) => {
    const r = await worker.query<{ id: string | null }>(`select id from plataforma.${funcao}()`);
    expect(r.rows[0]?.id ?? null, `${funcao} reserva o job`).toBe(id);
    await q(`update plataforma.${tabela} set bloqueado_ate = now() - interval '1 second' where id = $1`, [id]);
  };

  it('Z-09 teto de 3 tentativas: prévia e zerar pegados 3 vezes sem fechar fecham falhou ZERAR_FALHOU na 4ª; nada sai', async () => {
    const antes = await vivos();
    const copiasAntes = await copias();
    // prévia
    const pid = randomUUID();
    expect((await pedirPrevia(pid, ['cliente'])).statusCode).toBe(202);
    for (let i = 1; i <= 3; i += 1) await pegarSemFechar('pegar_previa_zerar', 'zerar_previa', pid);
    expect(await um<string>('select tentativas::text from plataforma.zerar_previa where id = $1', [pid])).toBe('3');
    expect(await criarWorkerZerar({ pool: worker }).cicloPrevia(), 'a 4ª não conta: fecha falhou').toBeNull();
    const pf = await lerPrevia(pid);
    expect(pf).toMatchObject({ id: pid, situacao: 'falhou', erro_codigo: ERROS_WORKER_ZERAR.falhou, linhas: null, total: null });
    expect(mensagemDaPreviaZerar(pf.erro_codigo!)).toBe('Não foi possível contar os dados. Tente de novo.');
    // zerar
    const zid = randomUUID();
    const r = await pedir(zid, ['cliente']);
    expect(r.statusCode, r.body).toBe(202);
    for (let i = 1; i <= 3; i += 1) await pegarSemFechar('pegar_zerar', 'zerar_empresa', zid);
    expect(await criarWorkerZerar({ pool: worker }).ciclo(), 'a 4ª não executa: fecha falhou').toBeNull();
    expect(await lerZerar()).toMatchObject({ id: zid, situacao: 'falhou', erro_codigo: ERROS_WORKER_ZERAR.falhou, linhas_apagadas: null, contagem: null });
    expect(
      await um<string>("select count(*)::text from plataforma.auditoria_plataforma where acao = 'tenant.zerar_falhou' and tenant_alvo_id = $1 and detalhes ->> 'zerar_id' = $2", [A.tenantId, zid]),
      'auditoria do teto',
    ).toBe('1');
    expect(await vivos()).toEqual(antes);
    expect(await copias()).toBe(copiasAntes);
    // a empresa fica livre para outro zerar (o que falhou não segura)
    const pv = await previa(['cliente']);
    expect(pv.bloqueio).toBeNull();
  });

  it('Z-10 a trava é só da empresa: com a prévia e com o zerar de A abertos no worker, o Hub de B recebe e conclui um lote', async () => {
    const segura = new pg.Client({ connectionString: api.banco.urlWorker ?? undefined });
    await segura.connect();
    const comPrazo = <T>(p: Promise<T>, oQue: string) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${oQue}: travado pela empresa A`)), 20_000))]);
    const produtosB = async () => (await vivos(B)).produto ?? 0;
    try {
      // 1) prévia da empresa inteira de A contada e NÃO fechada (transação aberta)
      const pid = randomUUID();
      expect((await pedirPrevia(pid)).statusCode).toBe(202);
      await segura.query('begin');
      const job = (await segura.query<{ id: string }>('select id from plataforma.pegar_previa_zerar()')).rows[0];
      expect(job?.id).toBe(pid);
      await segura.query('select plataforma.executar_previa_zerar($1)', [pid]);
      const n0 = await produtosB();
      await comPrazo(enviar(carga(B, 'produto', [produto(`${P}-BP2`, medidaB)])), 'Hub de B durante a prévia de A');
      expect(await produtosB()).toBe(n0 + 1);
      await segura.query('commit');
      expect((await lerPrevia(pid)).situacao).toBe('pronta');

      // 2) zerar de A (produto) executado e NÃO fechado: as travas do Hub de A estão seguras
      const zid = randomUUID();
      const r = await pedir(zid, ['produto']);
      expect(r.statusCode, r.body).toBe(202);
      await segura.query('begin');
      const jz = (await segura.query<{ id: string }>('select id from plataforma.pegar_zerar()')).rows[0];
      expect(jz?.id).toBe(zid);
      await segura.query("set local lock_timeout = '5s'");
      await segura.query('select plataforma.executar_zerar($1)', [zid]);
      await comPrazo(enviar(carga(B, 'produto', [produto(`${P}-BP3`, medidaB)])), 'Hub de B durante o zerar de A');
      expect(await produtosB()).toBe(n0 + 2);
      await segura.query('commit');
      expect(await lerZerar()).toMatchObject({ id: zid, situacao: 'concluido', entidades: ['produto'] });
      expect(await vivos()).toMatchObject({ produto: 0, cliente: 2 });
      expect(await produtosB()).toBe(n0 + 2);
    } catch (e) {
      await segura.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      await segura.end();
    }
  });
});
