/**
 * v1.0.30 (agente testes) — REENVIO DO PRÉ-CADASTRO RECUSADO COM HISTÓRICO (ADR 0069; RN-CORE-16, RN-CORE-78, RN-CORE-79, RN-INT-22),
 * ponta a ponta entre módulos: app (push real `/v1/sync/push`) e BKO (rotas reais do Core) → outbox → despachante real (`macuxi_worker`)
 * → consumidores da Integração (`core.cliente.pre_cadastrado@1`, `core.cliente.pre_cadastro_revisado@1`) → Hub `/integracao/v1/clientes`
 * (Conector simulado com os cabeçalhos da ADR 0013) → retorno do ERP → consumidor do Core (`integracao.cliente.retorno_erp@1`).
 * `createApp` REAL (8 módulos), JWT de verdade, Postgres pelo `macuxi_app` (RLS), fixture dois-tenants num banco efêmero do arquivo.
 *
 * Matriz (critérios a–i da revisão da v1.0.30):
 *  a. reenvio pelo app no MESMO id com `revisao_base` → revisão + 1, tentativa (hash, origem campo, quem, quando); repetição
 *     idempotente; 409 REVISAO_DESATUALIZADA; 422 CADASTRO_NAO_RECUSADO; fora da carteira = FORA_DA_CARTEIRA.
 *  b. APK v1.0.28 (`id` novo com o CPF/CNPJ do recusado) → revisão nova, herda histórico e Código FDV; o id antigo resolve no BKO.
 *  c. BKO: recusados (documento mascarado; situação recusado | reenviado | aceito), histórico, correção (origem bko); perfis; tenant.
 *  d. lista única de obrigatórios: domain (o que o app roda offline) = resposta da API; empresa sem parâmetro exige IE (CNPJ) e endereço.
 *  e. Hub: reabre a MESMA linha (revisão + 1, hash da tentativa); retorno de revisão antiga obsoleto; vinculado de revisão antiga vale;
 *     erros mascarados e fora do log; Conector sem "Recebe pedidos" = 403.
 *  f. Código FDV em todo cliente vivo; no Hub igual ao do Core; no corpo = 422 CODIGO_FDV_SOMENTE_LEITURA.
 *  g. 23505 em corrida real (mesmo id, mesmo documento) → `ja_existia` / 409 DOCUMENTO_JA_CADASTRADO; id de outro tenant → 409.
 *  i. o push `cliente_pre_cadastro` tem receptor (nunca SYNC_NAO_IMPLEMENTADO).
 *  j. v1.0.34: vendedor_external_id = código no ERP de quem fez o pré-cadastro, do app ao Hub; sem vazar entre tenants.
 * O item h (outbox apagada) tem o teste de banco do engenheiro-software (apps/api/test/outbox-apagada.banco.test.ts).
 *
 * Premissas: licença `integracao` ligada no tenant e nos perfis admin e analista de A e B (como na T-0114); o Core não desliga
 * (RN-CORE-01), então o MODULO_INATIVO das rotas novas fica no teste de permissão do Core. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { createHash, randomUUID } from 'node:crypto';
import { completarCnpj, completarCpf } from '@macuxi/comum/documento';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { ClienteParaErp, RetornoClienteAceito, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HistoricoPreCadastroSchema, PreCadastroAtualSchema, PreCadastroClienteSaidaSchema, RecusadosSaidaSchema } from '../../../modules/core/contracts';
import { camposExigidos, canonicalPreCadastro, validarPreCadastro } from '../../../modules/core/domain';
import { opcoesLogger } from '../../../apps/api/src/config';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { coletor } from '../apoio/coletor-log';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.10';
const IP_B = '203.0.113.5';
const ENDERECO = { logradouro: 'Rua das Flores', numero: '100', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69005-000' };
const CPF_NA_MENSAGEM = '123.456.789-09';
/** Ids criados por este arquivo (o Conector simulado só confere estes contra o contrato). */
const DESTE_ARQUIVO = new Set<string>();

/** CNPJ válido a partir de um número de 8 dígitos (filial 0001), para não colidir com a fixture. */
const cnpj = (base: number): string => completarCnpj(`${String(base).padStart(8, '0')}0001`);
/** CPF válido a partir de 9 dígitos. */
const cpf = (base: number): string => completarCpf(String(base).padStart(9, '0'));

function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = {
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  };
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: cab, remoteAddress: ip, ...(payload ? { payload } : {}) });
  return {
    pendentesBruto: () => chamar('GET', '/clientes/pendentes?limite=100'),
    /** Só os clientes deste arquivo passam pelo contrato: a linha da fixture (c3 de A) tem payload mínimo, fora do `ClienteParaErp`. */
    pendentes: async () => {
      const r = await chamar('GET', '/clientes/pendentes?limite=100');
      expect(r.statusCode, r.body).toBe(200);
      const clientes = (r.json() as { clientes: Array<{ cliente_uuid?: unknown }> }).clientes;
      return clientes.filter((c) => typeof c.cliente_uuid === 'string' && DESTE_ARQUIVO.has(c.cliente_uuid)).map((c) => ClienteParaErp.parse(c));
    },
    retorno: (uuid: string, corpo: object) => chamar('POST', `/clientes/${uuid}/retorno`, { versao_contrato: VERSAO_CONTRATO, cliente_uuid: uuid, ocorrido_em: new Date().toISOString(), ...corpo }),
  };
}

describe.skipIf(semBanco())('v1.0.30 — reenvio do pré-cadastro com histórico (app × BKO × Hub × despachante, dois tenants; ADR 0069)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: ReturnType<typeof conectorSimulado>;
  let erpB: ReturnType<typeof conectorSimulado>;
  const log = coletor();
  const tk = { adminA: '', analistaA: '', vendedor1A: '', vendedor2A: '', supervisorA: '', gerenteA: '', promotorA: '', adminB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  // fluxo principal (cliente Y1 do vendedor-1) e o do APK v1.0.28 (Y2 → X2)
  const Y1 = randomUUID();
  const Y2 = randomUUID();
  const X2 = randomUUID();
  for (const id of [Y1, Y2, X2]) DESTE_ARQUIVO.add(id);
  const DOC_Y1 = cnpj(71_030_001);
  const DOC_Y2 = cnpj(71_030_002);

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  const falhasDos = (ids: string[]) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where agregado_id = any($1) and publicado_em is null and tentativas > 0', [ids]);
  const pre = (id: string, documento: string, extra: Record<string, unknown> = {}) => ({ id, origem: 'campo', razao_social: 'Mercado Revisão Ltda', documento, inscricao_estadual: 'ISENTO', ...ENDERECO, ...extra });
  const postar = (token: string, corpo: object) => api.chamar(token, { method: 'POST', url: '/v1/core/clientes/pre-cadastro', payload: corpo });
  const push = async (token: string, payload: { id: string } & Record<string, unknown>) => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens: [{ entidade: 'cliente_pre_cadastro', id: payload.id, operacao: 'upsert', payload }] } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: Array<{ id: string; status: string; codigo?: string; mensagem?: string }> }).resultados[0]!;
  };
  const cliente = async (id: string) =>
    (
      await linhas<{ status_cadastro: string; revisao_cadastro: number; motivo_recusa: string | null; erros_recusa: unknown; external_id: string | null; codigo_fdv: string | null; apagado: boolean }>(
        'select status_cadastro, revisao_cadastro, motivo_recusa, erros_recusa, external_id, codigo_fdv, deleted_at is not null as apagado from core.cliente where id = $1',
        [id],
      )
    )[0];
  const tentativas = (id: string) =>
    linhas<{ revisao: number; hash: string | null; origem: string; corrigido_por: string | null; corrigido_por_perfil: string | null; enviado_em: Date; resultado: string; cliente_id_original: string | null }>(
      'select revisao, hash, origem, corrigido_por, corrigido_por_perfil, enviado_em, resultado, cliente_id_original from core.cliente_pre_cadastro_tentativa where cliente_id = $1 order by revisao',
      [id],
    );
  const fila = async (uuid: string) =>
    (await linhas<{ tenant_id: string; estado: string; revisao: number; hash: string | null; tentativas: number; motivo: string | null; erros: unknown; recebido_em: Date }>(
      'select tenant_id, estado, revisao, hash, tentativas, motivo, erros, recebido_em from integracao.cliente_fila_erp where cliente_uuid = $1',
      [uuid],
    ))[0];
  const recusados = async (token: string, situacao: 'recusado' | 'reenviado' | 'aceito') => {
    const r = await api.chamar(token, { method: 'GET', url: `/v1/core/clientes/pre-cadastro/recusados?situacao=${situacao}` });
    expect(r.statusCode, r.body).toBe(200);
    return RecusadosSaidaSchema.parse(r.json()).itens;
  };
  const eventosDe = (id: string, nome: string) => linhas<{ payload: Record<string, unknown> }>('select payload from plataforma.evento where agregado_id = $1 and nome = $2', [id, nome]);
  /** O ERP recusa a revisão entregue: GET pendentes (entrega o que faltar) + retorno rejeitado_erp + despacho até o Core. */
  const erpRecusa = async (id: string, revisao: number, motivo: string, erros?: object[]) => {
    await erpA.pendentes();
    expect(await fila(id), `linha do Hub de ${id}`).toMatchObject({ estado: 'enviado', revisao });
    const r = await erpA.retorno(id, { status: 'rejeitado_erp', motivo, revisao, ...(erros ? { erros } : {}) });
    expect(r.statusCode, r.body).toBe(200);
    await despachar();
  };

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi({ logger: { ...opcoesLogger('info'), stream: log.stream } });
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o fluxo precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br', A)).access_token;
    tk.vendedor1A = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    tk.vendedor2A = (await api.sessao('vendedor2@exemplo.com.br', A)).access_token;
    tk.supervisorA = (await api.sessao('supervisor@exemplo.com.br', A)).access_token;
    tk.gerenteA = (await api.sessao('gerente@exemplo.com.br', A)).access_token;
    tk.promotorA = (await api.sessao('promotor@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    for (const [t, token] of [[A, tk.adminA], [B, tk.adminB]] as const) {
      expect((await licenca(api, token, 'tenant', 'integracao', true)).statusCode, `licença integracao em ${t.codigo}`).toBe(200);
      for (const perfil of ['admin', 'analista']) expect((await licenca(api, token, 'perfil', 'integracao', true, perfil)).statusCode).toBe(200);
    }
    await despachar();
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
  }, 240_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  it('i + a + e. o app pré-cadastra pelo push real (sem SYNC_NAO_IMPLEMENTADO), o ERP recusa e o reenvio no MESMO id vira a revisão 2 na MESMA linha do Hub', async () => {
    // i. receptor do push: aceito e gravado pela mesma função da rota
    expect(await push(tk.vendedor1A, pre(Y1, DOC_Y1))).toEqual(expect.objectContaining({ id: Y1, status: 'aceito' }));
    expect(await cliente(Y1)).toMatchObject({ status_cadastro: 'pendente', revisao_cadastro: 1, apagado: false });
    await despachar();
    expect(await falhasDos([Y1])).toEqual([]);
    // e. o Hub entrega a revisão 1 com o hash da tentativa 1 e o Código FDV do Core (f)
    const [t1] = await tentativas(Y1);
    const c1 = await cliente(Y1);
    const entregue = (await erpA.pendentes()).find((c) => c.cliente_uuid === Y1)!;
    expect(entregue).toMatchObject({ revisao: 1, hash: t1!.hash, codigo_fdv: c1!.codigo_fdv, tentativa: 1 });
    expect(c1!.codigo_fdv).toMatch(/^\d{5,}$/);
    // o hash é o sha256 do canônico v1 dos dados (ADR 0069 §2), calculado aqui pela função do domain
    const dados = { ...pre(Y1, DOC_Y1), filial_id: (await linhas<{ filial_id: string }>('select filial_id from core.cliente where id = $1', [Y1]))[0]!.filial_id };
    expect(entregue.hash).toBe(createHash('sha256').update(canonicalPreCadastro(dados), 'utf8').digest('hex'));
    const recebidoEm = (await fila(Y1))!.recebido_em;

    // e. recusa com erros por campo; a mensagem com CPF é mascarada antes de gravar e não vai a log
    const r = await erpA.retorno(Y1, { status: 'rejeitado_erp', motivo: 'IE não confere com a UF', revisao: 1, erros: [{ campo: 'inscricao_estadual', codigo: 'IE_INVALIDA', mensagem: `IE do sócio ${CPF_NA_MENSAGEM} inválida` }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(RetornoClienteAceito.parse(r.json())).toMatchObject({ estado: 'rejeitado', revisao: 1, repetido: false });
    await despachar();
    const recusado = await cliente(Y1);
    expect(recusado).toMatchObject({ status_cadastro: 'recusado', revisao_cadastro: 1, motivo_recusa: 'IE não confere com a UF' });
    expect(JSON.stringify(recusado!.erros_recusa)).not.toContain(CPF_NA_MENSAGEM);
    expect(JSON.stringify((await fila(Y1))!.erros)).not.toContain(CPF_NA_MENSAGEM);
    expect((await tentativas(Y1)).map((t) => t.resultado)).toEqual(['recusado']);

    // a. reenvio pelo app no MESMO id com a revisão vista
    const antes = Date.now();
    expect(await push(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 1, inscricao_estadual: '041234567' }))).toMatchObject({ id: Y1, status: 'aceito' });
    expect(await cliente(Y1)).toMatchObject({ status_cadastro: 'pendente', revisao_cadastro: 2, motivo_recusa: null, erros_recusa: null, codigo_fdv: c1!.codigo_fdv });
    const ts = await tentativas(Y1);
    expect(ts.map((t) => [t.revisao, t.origem, t.corrigido_por, t.corrigido_por_perfil, t.resultado])).toEqual([
      [1, 'campo', A.usuarios.vendedor1, 'vendedor', 'recusado'],
      [2, 'campo', A.usuarios.vendedor1, 'vendedor', 'aguardando'],
    ]);
    expect(ts[1]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ts[1]!.hash).not.toBe(ts[0]!.hash);
    expect(ts[1]!.enviado_em.getTime()).toBeGreaterThan(antes - 60_000);
    // repetição idempotente (o aparelho reenviou o mesmo item): aceito, sem revisão nem evento novo
    expect(await push(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 1, inscricao_estadual: '041234567' }))).toMatchObject({ status: 'aceito' });
    expect((await cliente(Y1))!.revisao_cadastro).toBe(2);
    expect(await eventosDe(Y1, 'core.cliente.pre_cadastro_revisado@1')).toHaveLength(1);
    // outra pessoa corrigiu ao mesmo tempo (mesma base, outros dados) = REVISAO_DESATUALIZADA; pendente = CADASTRO_NAO_RECUSADO
    expect(await push(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 1, numero: '200' }))).toMatchObject({ status: 'rejeitado', codigo: 'REVISAO_DESATUALIZADA' });
    expect(await push(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 2, numero: '200' }))).toMatchObject({ status: 'rejeitado', codigo: 'CADASTRO_NAO_RECUSADO' });
    // a rota HTTP responde os mesmos códigos com o status do contrato
    const conflito = await postar(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 1, numero: '200' }));
    expect([conflito.statusCode, erroDe(conflito).codigo]).toEqual([409, 'REVISAO_DESATUALIZADA']);
    const naoRecusado = await postar(tk.vendedor1A, pre(Y1, DOC_Y1, { revisao_base: 2, numero: '200' }));
    expect([naoRecusado.statusCode, erroDe(naoRecusado).codigo]).toEqual([422, 'CADASTRO_NAO_RECUSADO']);

    // e. a Integração reabre a MESMA linha: pendente, revisão 2, hash da tentativa 2, tentativas 0, motivo e erros limpos, ordem mantida
    await despachar();
    expect(await falhasDos([Y1])).toEqual([]);
    expect(await fila(Y1)).toMatchObject({ estado: 'pendente', revisao: 2, hash: ts[1]!.hash, tentativas: 0, motivo: null, erros: null, recebido_em: recebidoEm });
    expect((await linhas('select 1 from integracao.cliente_fila_erp where cliente_uuid = $1', [Y1])).length).toBe(1);
    const reentregue = (await erpA.pendentes()).find((c) => c.cliente_uuid === Y1)!;
    expect(reentregue).toMatchObject({ revisao: 2, hash: ts[1]!.hash, tentativa: 1, codigo_fdv: c1!.codigo_fdv, inscricao_estadual: '041234567' });

    // e. a recusa atrasada da revisão 1 é obsoleta: 200, nada muda e nada é publicado
    const eventosAntes = (await eventosDe(Y1, 'integracao.cliente.retorno_erp@1')).length;
    const obsoleto = await erpA.retorno(Y1, { status: 'rejeitado_erp', motivo: 'Recusa antiga', revisao: 1 });
    expect(obsoleto.statusCode, obsoleto.body).toBe(200);
    expect(RetornoClienteAceito.parse(obsoleto.json())).toMatchObject({ obsoleto: true, revisao: 2 });
    expect((await eventosDe(Y1, 'integracao.cliente.retorno_erp@1')).length).toBe(eventosAntes);
    await despachar();
    expect(await cliente(Y1)).toMatchObject({ status_cadastro: 'pendente', revisao_cadastro: 2, motivo_recusa: null });
    // revisão maior que a atual = 422 revisao_desconhecida
    const desconhecida = await erpA.retorno(Y1, { status: 'rejeitado_erp', motivo: 'x', revisao: 9 });
    expect(desconhecida.statusCode, desconhecida.body).toBe(422);
  });

  it('a + c (escopo de carteira). correção pelo app fora da carteira = FORA_DA_CARTEIRA, sem gravar', async () => {
    await erpRecusa(Y1, 2, 'Endereço não encontrado');
    expect((await cliente(Y1))!.status_cadastro).toBe('recusado');
    expect(await push(tk.vendedor2A, pre(Y1, DOC_Y1, { revisao_base: 2, inscricao_estadual: '041234567', numero: '300' }))).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
    expect(await cliente(Y1)).toMatchObject({ status_cadastro: 'recusado', revisao_cadastro: 2 });
  });

  /**
   * Defeito da revisão do testes (23/11/2026), corrigido no modulo-core (5b122e9): a rota `POST /v1/core/clientes/pre-cadastro`
   * com `revisao_base` passa a conferir a carteira como o push (ADR 0069 §3): fora da carteira = 403 FORA_DA_CARTEIRA, sem gravar.
   */
  it('a + c (escopo de carteira). a rota POST com revisao_base não corrige o recusado da carteira de outro vendedor (403 FORA_DA_CARTEIRA)', async () => {
    const corpo = pre(Y1, DOC_Y1, { revisao_base: 2, inscricao_estadual: '041234567', numero: '300' });
    const r = await postar(tk.vendedor2A, corpo);
    expect(r.statusCode, `vendedor-2 corrigiu pelo POST o recusado da carteira do vendedor-1: ${r.body}`).toBe(403);
    expect(erroDe(r).codigo).toBe('FORA_DA_CARTEIRA');
    expect(await cliente(Y1)).toMatchObject({ status_cadastro: 'recusado', revisao_cadastro: 2 });
  });

  it('c. BKO: perfis, lista mascarada, histórico, correção origem bko, situações e tenant B', async () => {
    const c = (await cliente(Y1))!;
    const revisao = c.revisao_cadastro;
    // perfis: só analista e admin
    for (const [nome, token] of [['vendedor', tk.vendedor1A], ['supervisor', tk.supervisorA], ['gerente', tk.gerenteA], ['promotor', tk.promotorA]] as const) {
      for (const op of [
        { method: 'GET' as const, url: '/v1/core/clientes/pre-cadastro/recusados' },
        { method: 'GET' as const, url: `/v1/core/clientes/${Y1}/pre-cadastro/historico` },
        { method: 'PUT' as const, url: `/v1/core/clientes/${Y1}/pre-cadastro`, payload: { razao_social: 'X', documento: DOC_Y1, revisao_base: revisao } },
      ]) {
        const r = await api.chamar(token, op);
        expect(r.statusCode, `${nome} ${op.method} ${op.url}: ${r.body}`).toBe(403);
      }
    }
    expect((await cliente(Y1))!.revisao_cadastro).toBe(revisao);
    // lista: documento mascarado, motivo, erros, vendedor e Código FDV
    const item = (await recusados(tk.analistaA, 'recusado')).find((i) => i.cliente_id === Y1)!;
    expect(item).toMatchObject({ revisao, situacao: 'recusado', motivo: 'Endereço não encontrado', codigo_fdv: c!.codigo_fdv, vendedor: { id: A.usuarios.vendedor1 } });
    expect(item.documento_mascarado).not.toBeNull();
    expect(item.documento_mascarado).not.toContain(DOC_Y1);
    expect((item.documento_mascarado ?? '').replace(/\D/g, '')).not.toBe(DOC_Y1);
    expect((await recusados(tk.adminA, 'recusado')).map((i) => i.cliente_id)).toContain(Y1);
    // dados atuais e histórico
    const atual = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/core/clientes/${Y1}/pre-cadastro` });
    expect(atual.statusCode, atual.body).toBe(200);
    expect(PreCadastroAtualSchema.parse(atual.json())).toMatchObject({ id: Y1, revisao, status_cadastro: 'recusado', documento: DOC_Y1 });
    const hist = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/core/clientes/${Y1}/pre-cadastro/historico` });
    expect(hist.statusCode, hist.body).toBe(200);
    const h = HistoricoPreCadastroSchema.parse(hist.json());
    expect(h.revisao_atual).toBe(revisao);
    expect(h.tentativas.map((t) => [t.revisao, t.origem, t.resultado])).toEqual(
      Array.from({ length: revisao }, (_, i) => [revisao - i, 'campo', 'recusado']),
    );
    expect(h.tentativas.at(-1)!.corrigido_por).toMatchObject({ id: A.usuarios.vendedor1, perfil: 'vendedor' });

    // tenant B não vê nem corrige
    expect((await recusados(tk.adminB, 'recusado')).map((i) => i.cliente_id)).not.toContain(Y1);
    for (const op of [
      { method: 'GET' as const, url: `/v1/core/clientes/${Y1}/pre-cadastro` },
      { method: 'GET' as const, url: `/v1/core/clientes/${Y1}/pre-cadastro/historico` },
      { method: 'PUT' as const, url: `/v1/core/clientes/${Y1}/pre-cadastro`, payload: { razao_social: 'Invasor', documento: DOC_Y1, revisao_base: revisao, ...ENDERECO, inscricao_estadual: 'ISENTO' } },
    ]) {
      const r = await api.chamar(tk.adminB, op);
      expect(r.statusCode, `B ${op.method} ${op.url}: ${r.body}`).toBe(404);
    }
    expect((await cliente(Y1))!.revisao_cadastro).toBe(revisao);

    // correção do BKO: revisão nova, origem bko, quem corrigiu; repetição idempotente; base velha = 409; pendente = 422
    const { id: _i, origem: _o, ...dados } = pre(Y1, DOC_Y1, { inscricao_estadual: '041234567', numero: '400' });
    const put = (token: string, corpo: object) => api.chamar(token, { method: 'PUT', url: `/v1/core/clientes/${Y1}/pre-cadastro`, payload: corpo });
    const r1 = await put(tk.analistaA, { ...dados, revisao_base: revisao });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(PreCadastroClienteSaidaSchema.parse(r1.json())).toMatchObject({ id: Y1, status_cadastro: 'pendente', revisao: revisao + 1, ja_existia: false, codigo_fdv: c!.codigo_fdv });
    const r2 = await put(tk.analistaA, { ...dados, revisao_base: revisao });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json()).toMatchObject({ revisao: revisao + 1, ja_existia: true });
    const r3 = await put(tk.adminA, { ...dados, numero: '401', revisao_base: revisao });
    expect([r3.statusCode, erroDe(r3).codigo]).toEqual([409, 'REVISAO_DESATUALIZADA']);
    const r4 = await put(tk.adminA, { ...dados, numero: '401', revisao_base: revisao + 1 });
    expect([r4.statusCode, erroDe(r4).codigo]).toEqual([422, 'CADASTRO_NAO_RECUSADO']);
    const ultima = (await tentativas(Y1)).at(-1)!;
    expect([ultima.revisao, ultima.origem, ultima.corrigido_por, ultima.corrigido_por_perfil, ultima.resultado]).toEqual([revisao + 1, 'bko', A.usuarios.analista, 'analista', 'aguardando']);
    // a auditoria da correção não leva valores nem motivo
    const aud = await linhas<{ depois: unknown }>("select depois from plataforma.auditoria where acao = 'cliente.pre_cadastro_corrigir' and entidade_id = $1", [Y1]);
    expect(JSON.stringify(aud)).not.toMatch(/Endereço não encontrado|041234567|Rua das Flores/);
    // situação reenviado
    expect((await recusados(tk.analistaA, 'reenviado')).find((i) => i.cliente_id === Y1)).toMatchObject({ situacao: 'reenviado', revisao: revisao + 1 });
    expect((await recusados(tk.analistaA, 'recusado')).map((i) => i.cliente_id)).not.toContain(Y1);
    // o Hub reabre a mesma linha com a revisão do BKO
    await despachar();
    expect(await fila(Y1)).toMatchObject({ estado: 'pendente', revisao: revisao + 1, hash: ultima.hash });
  });

  it('e + f. vinculado de revisão ANTERIOR vale (o ERP manda): aprova, grava o Código ERP, tentativas aceitas; situação aceito; depois, 422 CADASTRO_NAO_RECUSADO', async () => {
    const revAtual = (await cliente(Y1))!.revisao_cadastro;
    await erpA.pendentes();
    const r = await erpA.retorno(Y1, { status: 'vinculado', external_id: 'ERP-CLI-1030', revisao: revAtual - 1 });
    expect(r.statusCode, r.body).toBe(200);
    expect(RetornoClienteAceito.parse(r.json())).toMatchObject({ estado: 'vinculado' });
    await despachar();
    expect(await falhasDos([Y1])).toEqual([]);
    const c = await cliente(Y1);
    expect(c).toMatchObject({ status_cadastro: 'aprovado', external_id: 'ERP-CLI-1030', motivo_recusa: null, erros_recusa: null });
    expect(c!.codigo_fdv).toMatch(/^\d{5,}$/);
    const ts = await tentativas(Y1);
    expect(ts.slice(-2).map((t) => t.resultado)).toEqual(['aceito', 'aceito']);
    expect((await recusados(tk.analistaA, 'aceito')).find((i) => i.cliente_id === Y1)).toMatchObject({ situacao: 'aceito' });
    const { id: _i, origem: _o, ...dados } = pre(Y1, DOC_Y1);
    const put = await api.chamar(tk.analistaA, { method: 'PUT', url: `/v1/core/clientes/${Y1}/pre-cadastro`, payload: { ...dados, revisao_base: revAtual } });
    expect([put.statusCode, erroDe(put).codigo]).toEqual([422, 'CADASTRO_NAO_RECUSADO']);
    // linha vinculado nunca reabre nem volta aos pendentes
    expect((await erpA.pendentes()).map((x) => x.cliente_uuid)).not.toContain(Y1);
  });

  it('b. APK v1.0.28: id novo com o CPF/CNPJ do recusado vira o cliente vivo, revisão seguinte, herda histórico e Código FDV; o id antigo resolve no BKO', async () => {
    expect(await push(tk.vendedor1A, pre(Y2, DOC_Y2))).toMatchObject({ status: 'aceito' });
    await despachar();
    await erpRecusa(Y2, 1, 'CNPJ baixado');
    const y = await cliente(Y2);
    expect(y).toMatchObject({ status_cadastro: 'recusado', revisao_cadastro: 1 });
    // o APK v1.0.28 manda um id NOVO, sem revisao_base
    expect(await push(tk.vendedor1A, pre(X2, DOC_Y2, { razao_social: 'Mercado Revisão Novo Ltda' }))).toMatchObject({ id: X2, status: 'aceito' });
    expect(await cliente(Y2)).toMatchObject({ apagado: true });
    expect(await cliente(X2)).toMatchObject({ status_cadastro: 'pendente', revisao_cadastro: 2, codigo_fdv: y!.codigo_fdv, apagado: false });
    expect((await tentativas(X2)).map((t) => [t.revisao, t.resultado, t.cliente_id_original])).toEqual([
      [1, 'recusado', Y2],
      [2, 'aguardando', null],
    ]);
    // o BKO abre pelo id antigo e cai no vivo
    const atual = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/core/clientes/${Y2}/pre-cadastro` });
    expect(atual.statusCode, atual.body).toBe(200);
    expect(PreCadastroAtualSchema.parse(atual.json())).toMatchObject({ id: X2, revisao: 2, codigo_fdv: y!.codigo_fdv });
    // no Hub, X é cliente novo para o ERP, com revisão 2 e o Código FDV herdado; a linha de Y não reabre
    await despachar();
    expect(await falhasDos([X2, Y2])).toEqual([]);
    const entregue = (await erpA.pendentes()).find((c) => c.cliente_uuid === X2);
    expect(entregue).toMatchObject({ revisao: 2, codigo_fdv: y!.codigo_fdv, hash: (await tentativas(X2))[1]!.hash });
    expect((await fila(Y2))!.estado).toBe('rejeitado');
    // o retorno do ERP pelo id antigo grava no vivo (alias)
    const r = await erpA.retorno(Y2, { status: 'vinculado', external_id: 'ERP-CLI-1030-Y2', revisao: 1 });
    expect(r.statusCode, r.body).toBe(200);
    await despachar();
    expect(await cliente(X2)).toMatchObject({ status_cadastro: 'aprovado', external_id: 'ERP-CLI-1030-Y2' });
  });

  it('g + f. 23505 em corrida real: mesmo id = ja_existia; mesmo documento = 409 DOCUMENTO_JA_CADASTRADO; id de outro tenant = 409 CADASTRO_INDISPONIVEL; codigo_fdv no corpo = 422', async () => {
    const id = randomUUID();
    const doc = cnpj(71_030_010);
    const [a, b] = await Promise.all([postar(tk.vendedor1A, pre(id, doc)), postar(tk.vendedor1A, pre(id, doc))]);
    expect([a.statusCode, b.statusCode], `${a.body} | ${b.body}`).toEqual([200, 200]);
    expect([a.json().ja_existia, b.json().ja_existia].sort()).toEqual([false, true]);
    expect(a.json().codigo_fdv).toBe(b.json().codigo_fdv);
    const doc2 = cnpj(71_030_011);
    const [c, d] = await Promise.all([postar(tk.vendedor1A, pre(randomUUID(), doc2)), postar(tk.vendedor1A, pre(randomUUID(), doc2))]);
    const st = [c, d].map((x) => (x.statusCode === 200 ? 200 : `${x.statusCode} ${erroDe(x).codigo}`)).sort();
    expect(st, `${c.body} | ${d.body}`).toEqual([200, '409 DOCUMENTO_JA_CADASTRADO']);
    expect(await linhas('select 1 from core.cliente where documento = $1 and deleted_at is null', [doc2])).toHaveLength(1);
    // id que já existe no tenant B: 409 sem dizer que existe
    const deB = (await linhas<{ id: string }>('select id from core.cliente where tenant_id = $1 and deleted_at is null limit 1', [B.tenantId]))[0]!.id;
    const outro = await postar(tk.vendedor1A, pre(deB, cnpj(71_030_012)));
    expect([outro.statusCode, erroDe(outro).codigo]).toEqual([409, 'CADASTRO_INDISPONIVEL']);
    // f. Código FDV só de leitura
    const comCodigo = await postar(tk.vendedor1A, pre(randomUUID(), cnpj(71_030_013), { codigo_fdv: '00001' }));
    expect([comCodigo.statusCode, erroDe(comCodigo).codigo]).toEqual([422, 'CODIGO_FDV_SOMENTE_LEITURA']);
    expect(await push(tk.vendedor1A, pre(randomUUID(), cnpj(71_030_014), { codigo_fdv: '00001' }))).toMatchObject({ status: 'rejeitado', codigo: 'CODIGO_FDV_SOMENTE_LEITURA' });
  });

  it('d. lista única: o domain (offline no app) dá o mesmo resultado que a API; sem parâmetro, CNPJ exige IE e todo pré-cadastro exige endereço', async () => {
    const g = await api.chamar(tk.adminA, { method: 'GET', url: '/v1/core/parametros/campos-obrigatorios' });
    expect(g.statusCode, g.body).toBe(200);
    const casos = (n: number): Array<[string, Record<string, unknown>]> => [
      ['completo', pre(randomUUID(), cnpj(71_030_100 + n))],
      ['CNPJ sem IE', pre(randomUUID(), cnpj(71_030_120 + n), { inscricao_estadual: null })],
      ['CPF sem IE', pre(randomUUID(), cpf(710_300_100 + n), { inscricao_estadual: null })],
      ['sem CEP', pre(randomUUID(), cnpj(71_030_140 + n), { cep: null })],
      ['sem telefone', pre(randomUUID(), cnpj(71_030_160 + n), { telefone: null })],
      ['CEP inválido', pre(randomUUID(), cnpj(71_030_180 + n), { cep: '123' })],
    ];
    const conferir = async (exigidos: ReturnType<typeof camposExigidos>, n: number) => {
      const saida: Record<string, { status: number; campos: string[] }> = {};
      for (const [nome, corpo] of casos(n)) {
        const dom = validarPreCadastro(corpo, exigidos);
        const r = await postar(tk.vendedor1A, corpo);
        const campos = r.statusCode === 200 ? [] : (((erroDe(r).detalhes as { campos?: string[] } | undefined)?.campos ?? []) as string[]);
        expect([r.statusCode, [...campos].sort()], `${nome}: ${r.body}`).toEqual([dom.ok ? 200 : 422, Object.keys(dom.erros).sort()]);
        saida[nome] = { status: r.statusCode, campos };
      }
      return saida;
    };
    // com o parâmetro do tenant (o que o app recebe no pull)
    await conferir(camposExigidos((g.json() as { obrigatorios: unknown }).obrigatorios), 0);
    // empresa sem nenhuma das chaves: padrão da RN-CORE-16
    await api.admin.query(
      "update plataforma.parametro set deleted_at = now() where tenant_id = $1 and modulo = 'core' and chave in ('cliente.campos_obrigatorios', 'cliente.pre_cadastro.obrigatorios') and deleted_at is null",
      [A.tenantId],
    );
    const semParametro = await conferir(camposExigidos(undefined), 1);
    expect(semParametro['completo']!.status).toBe(200);
    expect(semParametro['CNPJ sem IE']).toEqual({ status: 422, campos: ['inscricao_estadual'] });
    expect(semParametro['CPF sem IE']!.status).toBe(200);
    expect(semParametro['sem CEP']).toEqual({ status: 422, campos: ['cep'] });
  });

  it('e. Hub: Conector sem "Recebe pedidos" = 403 nas duas rotas; o Conector de B não vê os clientes de A; o log não leva motivo, erros, hash nem CPF/CNPJ', async () => {
    expect((await erpB.pendentes()).map((c) => c.cliente_uuid)).not.toEqual(expect.arrayContaining([Y1, X2]));
    const deA = await erpB.retorno(X2, { status: 'rejeitado_erp', motivo: 'tentativa de B' });
    expect(deA.statusCode, deA.body).not.toBe(200);
    expect((await cliente(X2))!.status_cadastro).toBe('aprovado');
    await api.admin.query('update integracao.conector set recebe_pedidos = false where id = $1', [A.integracao.conector]);
    try {
      expect((await erpA.pendentesBruto()).statusCode).toBe(403);
      expect((await erpA.retorno(Y1, { status: 'rejeitado_erp', motivo: 'x' })).statusCode).toBe(403);
    } finally {
      await api.admin.query('update integracao.conector set recebe_pedidos = true where id = $1', [A.integracao.conector]);
    }
    const hashes = (await linhas<{ hash: string }>('select hash from core.cliente_pre_cadastro_tentativa where hash is not null')).map((l) => l.hash);
    const texto = log.linhas.join('\n');
    expect(log.linhas.some((l) => l.includes('retorno do cliente aplicado'))).toBe(true);
    for (const proibido of ['IE não confere com a UF', 'Endereço não encontrado', 'CNPJ baixado', CPF_NA_MENSAGEM, '12345678909', DOC_Y1, DOC_Y2, ...hashes]) {
      expect(texto.includes(proibido), `log com "${proibido.slice(0, 12)}…"`).toBe(false);
    }
  });

  it('j. v1.0.34: vendedor_external_id = código no ERP de quem fez o pré-cadastro, do app ao Hub; sem vazar entre tenants', async () => {
    const [V1, VB] = [randomUUID(), randomUUID()];
    for (const id of [V1, VB]) DESTE_ARQUIVO.add(id);
    const tokenVendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    const codigo = (id: string, valor: string | null) => api.admin.query('update core.usuario set external_id = $2 where id = $1', [id, valor]);
    await codigo(A.usuarios.vendedor1, 'V-1034');
    await codigo(B.usuarios.vendedor, 'V-B-1034');
    try {
      expect(await push(tk.vendedor1A, pre(V1, cnpj(71_034_001)))).toMatchObject({ id: V1, status: 'aceito' });
      expect(await push(tokenVendedorB, pre(VB, cnpj(71_034_005)))).toMatchObject({ id: VB, status: 'aceito' });
      await despachar();
      expect(await falhasDos([V1, VB])).toEqual([]);

      const deA = new Map((await erpA.pendentes()).map((c) => [c.cliente_uuid, c]));
      expect(deA.get(V1)).toMatchObject({ vendedor_external_id: 'V-1034', revisao: 1 });
      expect(JSON.stringify([...deA.values()])).not.toContain('V-B-1034');

      const deB = await erpB.pendentes();
      expect(deB.find((c) => c.cliente_uuid === VB)).toMatchObject({ vendedor_external_id: 'V-B-1034' });
    } finally {
      await codigo(A.usuarios.vendedor1, null);
      await codigo(B.usuarios.vendedor, null);
    }
  });

  it('f. todo cliente vivo tem Código FDV, sem repetir no tenant', async () => {
    expect(await linhas('select id from core.cliente where deleted_at is null and codigo_fdv is null')).toEqual([]);
    expect(await linhas('select tenant_id, codigo_fdv from core.cliente where deleted_at is null group by 1, 2 having count(*) > 1')).toEqual([]);
  });
});
