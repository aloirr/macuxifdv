/**
 * v1.0.14 — Parâmetros do Core pela API REAL (#457 com o #456): o "parado" sai do Início e mora só em Parâmetros › Alertas
 * (RN-CORE-26), contador das Frases do dia × a lista (RN-CORE-41), perfil e licença (RN-CORE-01). Matriz:
 * docs/testes/v1014-parametros.md (seção "Início × Alertas" e "Core"). `createApp` + os 8 módulos + Postgres efêmero (dois-tenants).
 * Roda só com banco e com a rota `parametros/parado-min` no Core (`TEM_PARADO`, lido do contrato em tempo de execução): no main sem
 * o #457 o arquivo pula. A tela (título, só consulta) está em tests/modulos/parametros-core-n8-v1014.test.ts e no e2e.
 */
import * as contratosCore from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const TEM_PARADO = (contratosCore as unknown as Record<string, unknown>).CAMINHO_PARAMETRO_PARADO_MIN === 'parametros/parado-min';
const INICIO = '/v1/core/parametros/inicio';
const PARADO = '/v1/core/parametros/parado-min';
const ALERTAS = '/v1/core/parametros/alertas-produtividade';
const DIAS = [1, 2, 3, 4, 5];

describe.skipIf(semBanco() || !TEM_PARADO)('v1.0.14 Parâmetros do Core pela API (RN-CORE-26, RN-CORE-41, RN-CORE-01)', () => {
  let api: ApiDeTeste;
  const token: Record<'admin' | 'analista' | 'gerente' | 'adminB', string> = { admin: '', analista: '', gerente: '', adminB: '' };
  const chamar = async (t: string, method: 'GET' | 'PUT', url: string, payload?: object) => {
    const r = await api.chamar(t, { method, url, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, corpo: r.json() as Record<string, unknown>, r };
  };
  const auditorias = async (tenant: string, acao: string) =>
    Number((await api.admin.query<{ n: string }>('select count(*) as n from plataforma.auditoria where tenant_id = $1 and acao = $2', [tenant, acao])).rows[0]!.n);

  beforeAll(async () => {
    api = await subirApi();
    token.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    token.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    token.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    token.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe('Início × Alertas: o "parado" mora só em Parâmetros › Alertas', () => {
    it('PUT do Início com parado_min = 400 VALIDACAO e nada muda (nem dias úteis, nem parado)', async () => {
      const antes = await chamar(token.admin, 'GET', INICIO);
      expect(antes.status).toBe(200);
      const r = await chamar(token.admin, 'PUT', INICIO, { dias_uteis_semana: [1, 2, 3, 4, 5, 6], parado_min: 45 });
      expect(r.status, JSON.stringify(r.corpo)).toBe(400);
      expect(erroDe(r.r)).toMatchObject({ codigo: 'VALIDACAO' });
      expect(JSON.stringify(r.corpo)).toMatch(/parado_min/);
      expect((await chamar(token.admin, 'GET', INICIO)).corpo).toEqual(antes.corpo);
    });

    it('PUT do Início só com dias úteis = 200 e devolve o parado em vigor sem gravá-lo', async () => {
      const parado = (await chamar(token.admin, 'GET', PARADO)).corpo.parado_min;
      const r = await chamar(token.admin, 'PUT', INICIO, { dias_uteis_semana: DIAS });
      expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      expect(r.corpo).toEqual({ dias_uteis_semana: DIAS, parado_min: parado });
      expect(Object.keys(r.corpo).filter((k) => /almoco|janela/.test(k))).toEqual([]);
    });

    it('GET/PUT do parado em Parâmetros › Alertas: padrão 60; grava 45; o GET do Início (que o Gestão lê) mostra 45; idempotente', async () => {
      expect((await chamar(token.analista, 'GET', PARADO)).corpo).toEqual({ parado_min: 60 });
      const auditadas = await auditorias(A.tenantId, 'parametro.alertas_produtividade');
      const r = await chamar(token.analista, 'PUT', PARADO, { parado_min: 45 });
      expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      expect(r.corpo).toEqual({ parado_min: 45 });
      expect((await chamar(token.admin, 'GET', PARADO)).corpo).toEqual({ parado_min: 45 });
      expect((await chamar(token.admin, 'GET', INICIO)).corpo.parado_min).toBe(45);
      // reenvio igual: 200, sem gravar nem auditar de novo
      expect((await chamar(token.analista, 'PUT', PARADO, { parado_min: 45 })).status).toBe(200);
      expect(await auditorias(A.tenantId, 'parametro.alertas_produtividade')).toBe(auditadas + 1);
    });

    it('faixa 15..480 (limites aceitos; 14 e 481 = 422 RN-CORE-26); corpo com outro campo = 400', async () => {
      for (const v of [15, 480]) expect((await chamar(token.admin, 'PUT', PARADO, { parado_min: v })).status, String(v)).toBe(200);
      for (const v of [14, 481, 30.5]) {
        const r = await chamar(token.admin, 'PUT', PARADO, { parado_min: v });
        expect([r.status, erroDe(r.r).codigo], String(v)).toEqual([422, 'RN-CORE-26']);
      }
      expect((await chamar(token.admin, 'PUT', PARADO, { parado_min: 60, dias_uteis_semana: DIAS })).status).toBe(400);
      expect((await chamar(token.admin, 'PUT', PARADO, { parado_min: 60 })).status).toBe(200);
    });

    it('o parâmetro dos alertas (GET) não traz o parado; perfil sem a ação (gerente) = 403; tenant B não vê o parado de A', async () => {
      const g = await chamar(token.admin, 'GET', ALERTAS);
      expect(g.status).toBe(200);
      expect(JSON.stringify(g.corpo)).not.toMatch(/parado_min/);
      for (const url of [PARADO, ALERTAS]) expect((await chamar(token.gerente, 'GET', url)).status, url).toBe(403);
      expect((await chamar(token.gerente, 'PUT', PARADO, { parado_min: 30 })).status).toBe(403);
      expect((await chamar(token.analista, 'PUT', PARADO, { parado_min: 90 })).status).toBe(200);
      expect((await chamar(token.adminB, 'GET', PARADO)).corpo).toEqual({ parado_min: 60 });
      expect((await chamar(token.analista, 'PUT', PARADO, { parado_min: 60 })).status).toBe(200);
    });
  });

  describe('Frases do dia: o contador do título é o número da lista (valor × regra)', () => {
    it('GET /v1/core/frases devolve todas as frases não removidas do tenant (ativas e desativadas), nenhuma de B', async () => {
      const r = await chamar(token.admin, 'GET', '/v1/core/frases');
      expect(r.status).toBe(200);
      const itens = r.corpo.itens as { id: string; ativa: boolean }[];
      const noBanco = await api.admin.query<{ id: string }>('select id from core.frase_dia where tenant_id = $1 and deleted_at is null', [A.tenantId]);
      expect(itens.map((f) => f.id).sort()).toEqual(noBanco.rows.map((f) => f.id).sort());
      const deB = await api.admin.query<{ id: string }>('select id from core.frase_dia where tenant_id = $1', [B.tenantId]);
      expect(itens.filter((f) => deB.rows.some((b) => b.id === f.id))).toEqual([]);
    });

    it('quem não tem frase_dia.editar (gerente) recebe 403 no GET: o painel não aparece para ele (sem modo consulta nas frases)', async () => {
      expect((await chamar(token.gerente, 'GET', '/v1/core/frases')).status).toBe(403);
    });
  });

  describe('Licença (RN-CORE-01): painel de módulo desligado na empresa responde 403 MODULO_INATIVO', () => {
    it('Vendedor desligado no tenant: GET /v1/vendedor/alcadas (Parâmetros › Pedidos) = 403 MODULO_INATIVO; religado, 200', async () => {
      const alcadas = () => chamar(token.gerente, 'GET', '/v1/vendedor/alcadas');
      const antes = await alcadas();
      expect(antes.status, JSON.stringify(antes.corpo)).toBe(200);
      expect((await licenca(api, token.admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        const r = await alcadas();
        expect([r.status, erroDe(r.r).codigo]).toEqual([403, 'MODULO_INATIVO']);
        // o Core segue (RN-CORE-03): os painéis do Core continuam respondendo
        expect((await chamar(token.admin, 'GET', PARADO)).status).toBe(200);
      } finally {
        expect((await licenca(api, token.admin, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect((await alcadas()).status).toBe(200);
    });
  });
});
