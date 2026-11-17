/**
 * Critérios de aceite da T-0032 sobre os HANDLERS REAIS da Integração (`modules/integracao/api`, dono: modulo-integracao) ×
 * Postgres (fixture dois-tenants, papel macuxi_app, RLS). Contrato pedido no recado do engenheiro-software (T-0032, onda 2):
 * `criarModuloApiIntegracao({ pepper })` → `ModuloApi` com `conector` (ids de `ROTAS_HUB`) e as rotas do BKO do desenho §6.
 *
 * Enquanto o módulo não exporta `criarModuloApiIntegracao` (ou a rota do bloco), o bloco PULA com o motivo no título — os testes
 * ligam sozinhos quando os handlers chegam. Cobertura (desenho §9): RN-INT-12 (Idempotency-Key, replay, 409), RN-INT-01/P-1
 * (lote só de inválidas aceito), RN-INT-11 (426 como pausa; sinal liberado), A5/P-4 (retorno com parte dos itens inválida =
 * 200 + `itens_descartados` + `pedido_retorno_erro`), A9/P-3 (decidir inativação: admin e analista sim, supervisor e vendedor
 * 403, autor da sessão, auditoria), RN-INT-13 (409 `topologia_conflitante` com a mensagem do domain), monitor no formato do
 * contrato e só para quem tem `monitor.ver`, e multi-tenant em tudo. Nenhuma data fixa contra o now() do banco (relogio-varredura.md).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import * as apiIntegracao from '@macuxi/integracao/api';
import { MonitorResumo, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ModuloApi, ModuloId, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';
import { licencasDoTenantNoBanco, type FonteLicencasTenant } from '../src/licencas';
import { modulosDeTeste } from './apoio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** = `PEPPER_HUB_FIXTURE` da fixture dois-tenants (conferido em conector.banco.test.ts). */
const PEPPER = 'fixture-pepper-hub-somente-teste-0032';

type CriarModuloApi = (o: { pepper: () => string | undefined }) => ModuloApi;
const criar = (apiIntegracao as Record<string, unknown>).criarModuloApiIntegracao as CriarModuloApi | undefined;
const real: ModuloApi | null = typeof criar === 'function' ? criar({ pepper: () => PEPPER }) : null;
const temConector = (id: string) => !!real?.conector?.rotas.some((r) => r.id === id);
const temRota = (metodo: string, caminho: string) => !!real?.rotas?.some((r) => r.metodo === metodo && r.caminho === caminho);
const pula = (cond: boolean, oque: string) => (cond ? '' : ` [PULADO: ${oque} ainda não existe em modules/integracao/api]`);

const quem: Record<string, UsuarioAutenticado> = {
  adminA: { id: A.usuarios.admin, tenant_id: A.tenantId, perfil: 'admin' },
  analistaA: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' },
  supervisorA: { id: A.usuarios.supervisor, tenant_id: A.tenantId, perfil: 'supervisor' },
  vendedorA: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' },
  adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' },
};
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'integracao'];
const comIntegracao: FonteLicencasTenant = async (t, b) => {
  const l = await licencasDoTenantNoBanco(t, b);
  return { ...l, ativosNoTenant: [...l.ativosNoTenant, 'integracao' as ModuloId] };
};

const VERSAO_OK = '1.2.0';
const cabA = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${A.integracao.chave.chave}`,
  'x-macuxi-conector-id': A.integracao.identificador,
  'x-macuxi-conector-versao': VERSAO_OK,
  ...extra,
});
const cabB = () => ({ authorization: `Bearer ${B.integracao.chave.chave}`, 'x-macuxi-conector-id': B.integracao.identificador, 'x-macuxi-conector-versao': VERSAO_OK });
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';

describe.skipIf(semBanco() || !real)(`Hub da Integração × Postgres — handlers reais (T-0032)${pula(!!real, 'criarModuloApiIntegracao')}`, () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;
  const agoraIso = () => new Date().toISOString();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    app = createApp({
      banco: criarBancoApp(pool),
      modulos: modulosDeTeste({ integracao: real! }),
      autenticar: async (h) => quem[h['x-teste-usuario'] ?? ''] ?? null,
      licencas: async () => ({ ativosNoTenant: TODOS, doPerfil: TODOS, removidosDoUsuario: [], parametros: {} }),
      licencasTenant: comIntegracao,
    });
  });
  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await pool?.end();
  });

  // ------------------------------------------------------------------ A2 POST /lotes (RN-INT-12, RN-INT-01/P-1)
  describe.skipIf(!temConector('enviar_lote'))(`POST /integracao/v1/lotes${pula(temConector('enviar_lote'), 'enviar_lote')}`, () => {
    const lote = (mensagem: string) => ({
      versao_contrato: VERSAO_CONTRATO,
      entidade: 'estoque',
      modo: 'delta',
      conector_id: A.integracao.identificador,
      versao_conector: VERSAO_OK,
      registros: [],
      linhas_invalidas: [{ external_id: `E-${randomUUID().slice(0, 8)}`, codigo: 'campo_obrigatorio', campo: 'quantidade', mensagem }],
    });

    it('sem Idempotency-Key = 400 chave_idempotencia_invalida, sem lote criado', async () => {
      const r = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabA(), payload: lote('sem chave') });
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'chave_idempotencia_invalida', requisicao_id: expect.any(String) });
    });

    it('P-1: lote só de linhas inválidas é aceito (202); mesma chave e conteúdo = mesmo lote_id com Idempotent-Replay; conteúdo diferente = 409', async () => {
      const chave = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const corpo = lote('falta a quantidade');
      const r1 = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabA({ 'idempotency-key': chave }), payload: corpo });
      expect(r1.statusCode, r1.body).toBe(202);
      expect(r1.json()).toMatchObject({ status: 'recebido', entidade: 'estoque', modo: 'delta', recebidos: 1 });
      const r2 = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabA({ 'idempotency-key': chave }), payload: corpo });
      expect(r2.statusCode, r2.body).toBe(202);
      expect(r2.json()).toMatchObject({ lote_id: r1.json().lote_id, repetido: true });
      expect(r2.headers['idempotent-replay']).toBe('true');
      const r3 = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabA({ 'idempotency-key': chave }), payload: lote('outro conteúdo') });
      expect(r3.statusCode, r3.body).toBe(409);
      expect(r3.json().codigo).toBe('chave_idempotencia_reutilizada');
      const n = await admin.query('select 1 from integracao.lote where tenant_id = $1 and chave_idempotencia = $2', [A.tenantId, chave]);
      expect(n.rowCount).toBe(1);
      // o lote novo publica integracao.lote.recebido@1 uma vez (a repetição não publica de novo)
      const ev = await admin.query<{ n: string }>("select count(*)::text as n from plataforma.evento where tenant_id = $1 and nome = 'integracao.lote.recebido@1' and payload->>'lote_id' = $2", [A.tenantId, r1.json().lote_id]);
      expect(ev.rows[0]?.n).toBe('1');
    });

    it('RN-INT-11: abaixo da mínima do tenant (A: 1.1.0) o lote recebe 426 com a versão mínima; o sinal de vida passa', async () => {
      const r = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: cabA({ 'x-macuxi-conector-versao': '1.0.0', 'idempotency-key': randomUUID().replace(/-/g, '') }), payload: lote('velho') });
      expect(r.statusCode, r.body).toBe(426);
      expect(r.json()).toMatchObject({ codigo: 'versao_conector_nao_suportada', detalhes: { versao_minima: '1.1.0' } });
      if (!temConector('sinal')) return;
      const s = await app.inject({
        method: 'POST',
        url: '/integracao/v1/sinal',
        headers: cabA({ 'x-macuxi-conector-versao': '1.0.0' }),
        payload: { conector_id: A.integracao.identificador, versao_conector: '1.0.0', versao_contrato: VERSAO_CONTRATO, em: agoraIso(), fila: [], entidades: [], parado_por_versao: true },
      });
      expect(s.statusCode, s.body).toBe(200);
      expect(s.json().politica_versao).toMatchObject({ versao_minima: '1.1.0' });
    });
  });

  // ------------------------------------------------------------------ A5 POST /pedidos/{uuid}/retorno (RN-INT-08, P-4)
  describe.skipIf(!temConector('retorno_pedido'))(`A5 retorno do ERP${pula(temConector('retorno_pedido'), 'retorno_pedido')}`, () => {
    const pedido = randomUUID();
    const P1 = `P1-${pedido.slice(0, 6)}`;
    const P2 = `P2-${pedido.slice(0, 6)}`;

    // RN-INT-08: enviado → integrado → faturado_*. O Conector real manda 'integrado' (com numero_erp) antes de faturar, então a
    // fixture parte do pedido já aceito pelo ERP (decisão do gerente na T-0032: a regra do domain não muda por causa do teste).
    beforeAll(async () => {
      const agora = agoraIso();
      const itens = [
        { sequencia: 1, produto_external_id: P1, quantidade: 10, preco_unitario_cents: 1000, desconto_cents: 0, total_cents: 10_000 },
        { sequencia: 2, produto_external_id: P2, quantidade: 5, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 2500 },
      ];
      const payload = { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedido, cliente_external_id: 'CLI-1', vendedor_external_id: 'VEN-1', condicao_pagamento_erp: null, criado_em: agora, aprovado_em: agora, observacao: null, itens, desconto_total_cents: 0, total_cents: 12_500, tentativa: 1 };
      const origem = { pedido_uuid: pedido, cliente_external_id: 'CLI-1', vendedor_external_id: 'VEN-1', condicao_pagamento_codigo: null, criado_em: agora, aprovado_em: agora, observacao: null, itens, desconto_total_cents: 0, total_cents: 12_500 };
      await admin.query(
        `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, numero_erp, payload, payload_origem, conector_id, enviado_em, tentativas, aprovado_em)
         values ($1, $2, 'integrado', 'ERP-77', $3::jsonb, $4::jsonb, $5, now(), 1, now())`,
        [A.tenantId, pedido, JSON.stringify(payload), JSON.stringify(origem), A.integracao.conector],
      );
    });

    const retorno = () => ({
      versao_contrato: VERSAO_CONTRATO,
      pedido_uuid: pedido,
      status: 'faturado_parcial',
      numero_erp: 'ERP-77',
      nota: { numero: `NF-${pedido.slice(0, 6)}`, serie: '1', emitida_em: agoraIso(), total_cents: 4000 },
      itens_faturados: [
        { sequencia: 1, produto_external_id: P1, quantidade: 4, valor_cents: 4000 },
        { sequencia: 9, produto_external_id: 'P9-INEXISTENTE', quantidade: 1, valor_cents: 100 },
      ],
      ocorrido_em: agoraIso(),
    });

    it('multi-tenant: o Conector de B não toca no pedido de A', async () => {
      const r = await app.inject({ method: 'POST', url: `/integracao/v1/pedidos/${pedido}/retorno`, headers: cabB(), remoteAddress: IP_B, payload: retorno() });
      expect([403, 404, 422], r.body).toContain(r.statusCode);
      const f = await admin.query<{ estado: string }>('select estado from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2', [A.tenantId, pedido]);
      expect(f.rows[0]?.estado).toBe('integrado');
    });

    it('P-4: parte dos itens inválida → 200 com itens_descartados; o status vale e o erro fica em pedido_retorno_erro', async () => {
      const r = await app.inject({ method: 'POST', url: `/integracao/v1/pedidos/${pedido}/retorno`, headers: cabA(), payload: retorno() });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ pedido_uuid: pedido, status: 'faturado_parcial', repetido: false });
      expect(r.json().itens_descartados).toEqual([expect.objectContaining({ indice: 1, sequencia: 9, codigo: 'sequencia_inexistente' })]);
      const erros = await admin.query<{ codigo: string; sequencia: number; pedido_retorno_id: string | null; conector_id: string }>(
        'select codigo, sequencia, pedido_retorno_id, conector_id from integracao.pedido_retorno_erro where tenant_id = $1 and pedido_uuid = $2',
        [A.tenantId, pedido],
      );
      expect(erros.rows).toEqual([{ codigo: 'sequencia_inexistente', sequencia: 9, pedido_retorno_id: expect.any(String), conector_id: A.integracao.conector }]);
      const f = await admin.query<{ estado: string }>('select estado from integracao.pedido_fila_erp where tenant_id = $1 and pedido_uuid = $2', [A.tenantId, pedido]);
      expect(f.rows[0]?.estado).toBe('faturado_parcial');
      const ev = await admin.query("select 1 from plataforma.evento where tenant_id = $1 and nome = 'integracao.pedido.retorno_erp@1' and agregado_id = $2", [A.tenantId, pedido]);
      expect(ev.rowCount).toBe(1);
    });

    it('retorno sem itens inválidos não leva itens_descartados (campo omitido)', async () => {
      const ok = { ...retorno(), status: 'faturado_total', nota: { numero: `NF2-${pedido.slice(0, 6)}`, serie: '1', emitida_em: agoraIso(), total_cents: 2500 }, itens_faturados: [{ sequencia: 2, produto_external_id: P2, quantidade: 5, valor_cents: 2500 }] };
      const r = await app.inject({ method: 'POST', url: `/integracao/v1/pedidos/${pedido}/retorno`, headers: cabA(), payload: ok });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).not.toHaveProperty('itens_descartados');
    });

    // #476: o monitor devolve só o que a tela lê (lotes e resumo dos pedidos); o alerta `retorno_com_itens_descartados` saiu da
    // resposta e a regra fica no domain (`montarAlertasMonitor`, com teste lá) até uma tela da área "Alertas" ler. Aqui fica a
    // fonte do alerta (erro do item descartado nas últimas 24 h) e a permissão do monitor.
    it.skipIf(!temRota('GET', 'monitor'))('monitor no formato novo; erro do item descartado nas últimas 24 h; supervisor não vê o monitor', async () => {
      const a = await app.inject({ method: 'GET', url: '/v1/integracao/monitor', headers: { 'x-teste-usuario': 'analistaA' } });
      expect(a.statusCode, a.body).toBe(200);
      expect(MonitorResumo.safeParse(a.json()).success, a.body).toBe(true);
      expect(a.json()).not.toHaveProperty('alertas');
      const erros = await admin.query(
        "select 1 from integracao.pedido_retorno_erro where tenant_id = $1 and pedido_uuid = $2 and created_at > now() - interval '24 hours'",
        [A.tenantId, pedido],
      );
      expect(erros.rowCount).toBeGreaterThan(0);
      const s = await app.inject({ method: 'GET', url: '/v1/integracao/monitor', headers: { 'x-teste-usuario': 'supervisorA' } });
      expect(s.statusCode, s.body).toBe(403);
    });
  });

  // ------------------------------------------------------------------ A9 decidir inativação (RN-INT-06, P-3)
  const DECIDIR = 'inativacoes/:id/decidir';
  describe.skipIf(!temRota('POST', DECIDIR))(`A9 POST /v1/integracao/${DECIDIR}${pula(temRota('POST', DECIDIR), DECIDIR)}`, () => {
    const conector = randomUUID();
    const pend: Record<'estoque' | 'titulo', string> = { estoque: randomUUID(), titulo: randomUUID() };

    beforeAll(async () => {
      // Conector próprio do teste, INATIVO (não mexe na topologia nem na P-7 de A), com uma pendência aguardando por entidade
      await admin.query(
        `insert into integracao.conector (id, tenant_id, identificador, nome, ativo, recebe_pedidos, entidades)
         values ($1, $2, $3, 'Teste decisão', false, false, array['estoque', 'titulo'])`,
        [conector, A.tenantId, `teste-dec-${conector.slice(0, 8)}`],
      );
      for (const entidade of ['estoque', 'titulo'] as const) {
        const sessao = randomUUID();
        await admin.query(
          `insert into integracao.sessao_carga (id, tenant_id, sessao_uuid, conector_id, entidade, ultima_parte, fechada_em, situacao)
           values ($1, $2, $3, $4, $5, 1, now(), 'completa')`,
          [sessao, A.tenantId, randomUUID(), conector, entidade],
        );
        await admin.query(
          `insert into integracao.pendencia_inativacao (id, tenant_id, sessao_id, entidade, conector_id, lote_id, candidatos, total_ativos, percentual, limite_pct, expira_em)
           values ($1, $2, $3, $4, $5, $6, 5, 10, 50, 30, now() + interval '7 days')`,
          [pend[entidade], A.tenantId, sessao, entidade, conector, randomUUID()],
        );
      }
    });

    const decidir = (u: string, id: string, corpo: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/v1/integracao/inativacoes/${id}/decidir`, headers: { 'x-teste-usuario': u }, payload: corpo });
    const estado = async (id: string) =>
      (await admin.query<{ estado: string }>('select estado from integracao.pendencia_inativacao where id = $1', [id])).rows[0]?.estado;

    it('supervisor e vendedor → 403 PERFIL_SEM_ACESSO; a pendência continua aguardando', async () => {
      for (const u of ['supervisorA', 'vendedorA']) {
        const r = await decidir(u, pend.estoque, { acao: 'confirmar' });
        expect(r.statusCode, r.body).toBe(403);
        expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
      }
      expect(await estado(pend.estoque)).toBe('aguardando');
    });

    it('multi-tenant: admin de B não acha a pendência de A (404)', async () => {
      const r = await decidir('adminB', pend.estoque, { acao: 'confirmar' });
      expect(r.statusCode, r.body).toBe(404);
      expect(await estado(pend.estoque)).toBe('aguardando');
    });

    it('admin confirma: autor da sessão (o do corpo é ignorado), auditoria do módulo e da plataforma na mesma transação', async () => {
      const r = await decidir('adminA', pend.estoque, { acao: 'confirmar', motivo: 'conferido com o ERP', decidida_por: B.usuarios.admin });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().pendencia).toMatchObject({ id: pend.estoque, estado: 'confirmada', decidida_por: A.usuarios.admin, decidida_por_perfil: 'admin' });
      expect(r.json().auditoria).toMatchObject({ acao: 'confirmar', decidida_por: A.usuarios.admin, perfil: 'admin', quantidade: 5 });
      const aud = await admin.query<{ decidida_por: string; perfil: string; inativadas: number | null }>(
        'select decidida_por, perfil, inativadas from integracao.inativacao_auditoria where pendencia_id = $1',
        [pend.estoque],
      );
      expect(aud.rows).toEqual([{ decidida_por: A.usuarios.admin, perfil: 'admin', inativadas: expect.any(Number) }]);
      const plat = await admin.query<{ usuario_id: string; modulo: string }>(
        "select usuario_id, modulo from plataforma.auditoria where acao = 'inativacao.decidir' and entidade_id = $1",
        [pend.estoque],
      );
      expect(plat.rows).toEqual([{ usuario_id: A.usuarios.admin, modulo: 'integracao' }]);
      // decidir de novo = 422 RN-INT-06 (já decidida), sem segunda auditoria
      const de_novo = await decidir('analistaA', pend.estoque, { acao: 'recusar' });
      expect(de_novo.statusCode, de_novo.body).toBe(422);
      expect((await admin.query('select 1 from integracao.inativacao_auditoria where pendencia_id = $1', [pend.estoque])).rowCount).toBe(1);
    });

    it('analista recusa: 200, perfil analista e inativadas nulo na auditoria', async () => {
      const r = await decidir('analistaA', pend.titulo, { acao: 'recusar' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ inativadas: 0, pendencia: { estado: 'recusada', decidida_por: A.usuarios.analista, decidida_por_perfil: 'analista' } });
      const aud = await admin.query<{ perfil: string; inativadas: number | null }>('select perfil, inativadas from integracao.inativacao_auditoria where pendencia_id = $1', [pend.titulo]);
      expect(aud.rows).toEqual([{ perfil: 'analista', inativadas: null }]);
    });
  });

  // ------------------------------------------------------------------ A9 topologia (RN-INT-13, P-6/P-7)
  describe.skipIf(!temRota('POST', 'conectores'))(`A9 POST /v1/integracao/conectores${pula(temRota('POST', 'conectores'), 'POST conectores')}`, () => {
    it('RN-INT-13: Conector novo com entidade do erp-alfa → 409 topologia_conflitante com a mensagem do domain e conflitos em detalhes', async () => {
      const identificador = `teste-topo-${randomUUID().slice(0, 8)}`;
      const r = await app.inject({
        method: 'POST',
        url: '/v1/integracao/conectores',
        headers: { 'x-teste-usuario': 'adminA' },
        payload: { conector_id: identificador, nome: 'Segundo ERP', entidades: ['cliente'], recebe_pedidos: false },
      });
      expect(r.statusCode, r.body).toBe(409);
      const corpo = r.json();
      expect(corpo.codigo).toBe('topologia_conflitante');
      expect(corpo.mensagem).toContain('"cliente"');
      expect(corpo.mensagem).toContain(`"${A.integracao.identificador}"`);
      expect(corpo.detalhes).toMatchObject({ conflitos: [{ codigo: 'entidade_em_outro_conector', entidade: 'cliente', conector_id: A.integracao.identificador }], entidades_livres: [] });
      expect((await admin.query('select 1 from integracao.conector where tenant_id = $1 and identificador = $2', [A.tenantId, identificador])).rowCount).toBe(0);
    });

    it('conector.gerenciar é só admin: analista → 403', async () => {
      const r = await app.inject({ method: 'POST', url: '/v1/integracao/conectores', headers: { 'x-teste-usuario': 'analistaA' }, payload: { conector_id: 'teste-analista', nome: 'X', entidades: ['rota'] } });
      expect(r.statusCode, r.body).toBe(403);
    });
  });
});
