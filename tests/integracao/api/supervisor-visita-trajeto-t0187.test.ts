/**
 * T-0187 (v1.0.16) — supervisor em campo no Gestão: check-in e checkout do supervisor (RN-CORE-13) e o trajeto dele (interno,
 * desligado de fábrica, visível só ao gerente), com a API REAL (createApp × Postgres como macuxi_app × fixture dois-tenants).
 * Desenho: docs/desenho/T-0187.md §1.1, §1.2, §2 e §4 (branch nuvem/v1016-supervisor-engenheiro-software). Matriz: docs/testes/T-0187.md.
 * Regras: RN-CORE-13 (check-in único, trajeto), RN-CORE-04 (carteira da equipe), RN-CORE-05 (tenant), RN-CORE-11 (uma visita aberta).
 *
 * Convenção: `it` = critério que o `main` já atende; `it.runIf(<código entregue>)` = liga sozinho quando o símbolo do dono chegar
 * (aqui: `APP_RASTREADO_DO_CARGO` e `ACAO_VISITA_REGISTRAR_GESTAO` do modulo-core); `it.todo` = só no aparelho, com o roteiro
 * manual da matriz.
 */
import * as portao from '@macuxi/core/contracts';
import { ENTIDADE_PONTO_TRAJETO, PARAMETROS_RASTREAMENTO_PADRAO } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';

const id = (n: number) => `0f187100-0000-4000-8000-${String(n).padStart(12, '0')}`;
const V = {
  supC1: id(1),
  supC3SemGps: id(2),
  checkout: id(3),
  vendC1: id(4),
  supC1b: id(5),
  supB: id(6),
  checkoutVend: id(7),
  checkoutSup: id(8),
  semGestao: id(9),
  semGestaoCheckout: id(10),
} as const;
/** Pontos do trajeto (critérios 8 e 11): 3 dias úteis sem feriado (seg 16 a qua 18/11/2026, 11h em Manaus), dois por dia. */
const P = (n: number) => id(100 + n);
const DIAS = ['2026-11-16', '2026-11-17', '2026-11-18'];
const PONTOS_SUP = DIAS.flatMap((d, i) => [0, 1].map((k) => ({ id: P(i * 2 + k), capturado_em: `${d}T15:${k ? '10' : '00'}:00.000Z`, latitude: -3.1019 - k / 1000, longitude: -60.025, precisao_m: 10, velocidade_ms: null })));
const PONTO_GER = { id: P(50), capturado_em: '2026-11-18T15:00:00.000Z', latitude: -3.1, longitude: -60.02, precisao_m: 10, velocidade_ms: null };
const TODO_DIA = [{ inicio_min: 0, fim_min: 1439 }];
const EXPEDIENTE = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, TODO_DIA]));
/** O Core entregou a ação de gestão (manifesto) — o push de visita do supervisor sem ela volta PERFIL_SEM_ACESSO. */
const TEM_ACAO_GESTAO = 'ACAO_VISITA_REGISTRAR_GESTAO' in portao;
/** c1 (Manaus) com GPS na porta; c3 não tem coordenada. */
const EM_C1 = { lat: -3.1019, lng: -60.025, precisao_m: 8 };
/** O portão novo do modulo-core (desenho §1.2): exportado pelos contratos junto com o 404 do próprio trajeto. */
const TEM_PORTAO_NOVO = 'APP_RASTREADO_DO_CARGO' in portao;
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date()); // hora-fixa-ok: a API real data a visita no relógio dela; os dias fixos são só do capturado_em dos pontos (8 e 11)

describe.skipIf(semBanco())('T-0187 — check-in, checkout e trajeto do supervisor (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', promotor: '', supervisor: '', gerente: '', analista: '', vendedorB: '' };

  const push = async (token: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const checkin = (vid: string, cliente: string, extra: Record<string, unknown> = {}): ItemPush => ({
    id: vid,
    entidade: 'visita',
    operacao: 'upsert',
    payload: { id: vid, cliente_id: cliente, checkin_em: new Date().toISOString(), extra: true, ...extra }, // hora-fixa-ok: idem
  });
  const checkout = (cmd: string, vid: string): ItemPush => ({
    id: cmd,
    entidade: 'visita_checkout',
    operacao: 'upsert',
    payload: { id: cmd, visita_id: vid, checkout_em: new Date().toISOString(), resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, etapas: [] }, // hora-fixa-ok: idem
  });
  const visita = async (vid: string) =>
    (await api.admin.query<{ usuario_id: string; cliente_id: string; sem_gps: boolean; checkin_lat: string | null; checkout_em: Date | null }>('select usuario_id::text, cliente_id::text, sem_gps, checkin_lat::text, checkout_em from core.visita where id = $1', [vid])).rows;
  const eventos = async (vid: string, nome: string) => (await api.admin.query<{ payload: Record<string, unknown> }>('select payload from plataforma.evento where agregado_id = $1 and nome = $2', [vid, nome])).rows;
  const trajeto = (token: string, usuario: string) => api.chamar(token, { method: 'GET', url: `/v1/core/trajeto?usuario_id=${usuario}&data=${HOJE}` });

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    await api.admin.query('delete from core.visita where id = any($1::uuid[])', [Object.values(V)]);
    await api.admin.query('delete from core.ponto_trajeto where id = any($1::uuid[])', [[...PONTOS_SUP.map((x) => x.id), PONTO_GER.id]]);
  }, 120_000);

  afterAll(async () => {
    if (!api) return;
    await api.admin.query('delete from core.visita where id = any($1::uuid[])', [Object.values(V)]).catch(() => undefined);
    await api.admin.query('delete from core.ponto_trajeto where id = any($1::uuid[])', [[...PONTOS_SUP.map((x) => x.id), PONTO_GER.id]]).catch(() => undefined);
    await api.fechar();
  });

  // ------------------------------------------------------------------------------------------ Critérios 2, 3 e 4
  it('2. check-in do supervisor em c1 (cliente da equipe) grava core.visita com o usuario_id dele e o GPS do momento; publica core.visita.checkin@1', async () => {
    expect((await push(tk.supervisor, [checkin(V.supC1, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ id: V.supC1, status: 'aceito' });
    const [v] = await visita(V.supC1);
    expect(v).toMatchObject({ usuario_id: A.usuarios.supervisor, cliente_id: A.clientes.c1, sem_gps: false });
    expect(Number(v!.checkin_lat)).toBeCloseTo(EM_C1.lat, 4);
    const ev = await eventos(V.supC1, 'core.visita.checkin@1');
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.payload)).toContain(A.usuarios.supervisor);
  });

  it('4. offline → reconexão: o reenvio do mesmo id do aparelho responde aceito e não duplica a visita nem o evento', async () => {
    expect((await push(tk.supervisor, [checkin(V.supC1, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ id: V.supC1, status: 'aceito' });
    expect(await visita(V.supC1)).toHaveLength(1);
    expect(await eventos(V.supC1, 'core.visita.checkin@1')).toHaveLength(1);
  });

  it('3 (API). a visita aberta do vendedor-1 em c1 não trava o check-in do supervisor no mesmo cliente; as duas ficam abertas', async () => {
    expect((await push(tk.vendedor, [checkin(V.vendC1, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ status: 'aceito' });
    expect((await push(tk.supervisor, [checkin(V.supC1b, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ status: 'aceito' });
    expect((await visita(V.vendC1))[0]!.checkout_em, 'a do vendedor segue aberta').toBeNull();
    expect((await visita(V.supC1b))[0]!.checkout_em).toBeNull();
    expect((await push(tk.vendedor, [checkout(V.checkoutVend, V.vendC1)]))[0]).toMatchObject({ status: 'aceito' });
  });

  it('2 (sem GPS) e checkout. check-in em c3 sem GPS grava sem_gps; o checkout do supervisor grava como o do vendedor e publica core.visita.checkout@1', async () => {
    expect((await push(tk.supervisor, [checkin(V.supC3SemGps, A.clientes.c3)]))[0]).toMatchObject({ status: 'aceito' });
    expect((await visita(V.supC3SemGps))[0]).toMatchObject({ sem_gps: true, checkin_lat: null, usuario_id: A.usuarios.supervisor });
    expect((await push(tk.supervisor, [checkout(V.checkout, V.supC3SemGps)]))[0]).toMatchObject({ status: 'aceito' });
    expect((await visita(V.supC3SemGps))[0]!.checkout_em).not.toBeNull();
    expect(await eventos(V.supC3SemGps, 'core.visita.checkout@1')).toHaveLength(1);
  });

  it.todo('3 (aparelho). a visita aberta do próprio supervisor trava o check-in dele em outro cliente na Rota do Gestão (filtro por usuario_id da sessão na tela) — roteiro manual em docs/testes/T-0187.md');
  it.runIf(TEM_ACAO_GESTAO)('5. supervisor sem visita.registrar_gestao (sobreposição no perfil, como o BKO grava): check-in e checkout voltam PERFIL_SEM_ACESSO e nada é gravado; com a ação de volta, aceito', async () => {
    const sobrepor = (concedida: boolean | null) =>
      concedida === null
        ? api.admin.query("delete from plataforma.perfil_permissao where tenant_id = $1 and chave = 'visita.registrar_gestao' and perfil_id = (select id from plataforma.perfil where tenant_id = $1 and codigo = 'supervisor')", [A.tenantId])
        : api.admin.query("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) select $1, id, 'visita.registrar_gestao', $2 from plataforma.perfil where tenant_id = $1 and codigo = 'supervisor'", [A.tenantId, concedida]);
    await sobrepor(null);
    await sobrepor(false);
    try {
      expect((await push(tk.supervisor, [checkin(V.semGestao, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ id: V.semGestao, status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
      expect(await visita(V.semGestao)).toEqual([]);
    } finally {
      await sobrepor(null);
    }
    expect((await push(tk.supervisor, [checkin(V.semGestao, A.clientes.c1, EM_C1)]))[0]).toMatchObject({ id: V.semGestao, status: 'aceito' });
    expect((await push(tk.supervisor, [checkout(V.semGestaoCheckout, V.semGestao)]))[0]).toMatchObject({ status: 'aceito' });
  });
  it.todo('6 (tela). a ficha do Gestão mostra o supervisor em "Visitada por" — tela; a regra (fora da cobertura e da meta, RN-GES-05) está em tests/modulos/supervisor-campo-t0187.test.ts; roteiro manual em docs/testes/T-0187.md');

  // ------------------------------------------------------------------------------------------ Critério 19 (tenant)
  it('19 (visita). o supervisor de A não faz check-in no c1 de B: rejeitado FORA_DA_CARTEIRA e nada gravado', async () => {
    const r = (await push(tk.supervisor, [checkin(V.supB, B.clientes.c1, EM_C1)]))[0];
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
    expect(await visita(V.supB)).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------ Rastreamento (7 a 11)
  describe('Rastreamento do supervisor: interno, desligado de fábrica e visível só ao gerente', () => {
    it('9 (perfis). vendedor, promotor e analista não veem trajeto de ninguém (403); o supervisor vê o do vendedor da equipe (200)', async () => {
      for (const [quem, token] of [['vendedor', tk.vendedor], ['promotor', tk.promotor], ['analista', tk.analista]] as const) {
        const r = await trajeto(token, A.usuarios.vendedor1);
        expect([403, 404], `${quem}: ${r.body}`).toContain(r.statusCode);
        expect(r.body, quem).not.toContain('latitude');
      }
      const ok = await trajeto(tk.supervisor, A.usuarios.vendedor1);
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('19 (trajeto). o supervisor de A com o id do vendedor de B recebe 404 (um id de outro tenant = um id que não existe)', async () => {
      const r = await trajeto(tk.supervisor, B.usuarios.vendedor);
      expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([404, 'USUARIO_NAO_ENCONTRADO']);
    });

    it.runIf(TEM_PORTAO_NOVO)('9. GET /v1/core/trajeto do próprio usuário = 404 USUARIO_NAO_ENCONTRADO para o supervisor e para o gerente', async () => {
      for (const [quem, token, eu] of [['supervisor', tk.supervisor, A.usuarios.supervisor], ['gerente', tk.gerente, A.usuarios.gerente]] as const) {
        const r = await trajeto(token, eu);
        expect([r.statusCode, erroDe(r).codigo], `${quem}: ${r.body}`).toEqual([404, 'USUARIO_NAO_ENCONTRADO']);
      }
    });

    it.runIf(TEM_PORTAO_NOVO)('9. o gerente vê o trajeto do supervisor da equipe abaixo (200)', async () => {
      const r = await trajeto(tk.gerente, A.usuarios.supervisor);
      expect(r.statusCode, r.body).toBe(200);
    });

    // 8 e 11 (API): o parâmetro `rastreamento` é do tenant A e o trajeto-envio-t0156 também o liga (mesmo valor); o teste guarda o que havia e devolve
    it.runIf(TEM_PORTAO_NOVO)('8 e 11 (API). rastreamento ligado e no expediente: o ponto do supervisor é gravado (app Gestão pelo cargo); o do gerente é descartado; 3 dias de pontos sem rede reenviados não duplicam', async () => {
      const antes = (await api.admin.query<{ valor: unknown }>("select valor from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId])).rows[0];
      const pontos = async (ids: readonly string[]) =>
        (await api.admin.query<{ id: string; usuario_id: string }>('select id::text, usuario_id::text from core.ponto_trajeto where tenant_id = $1 and id = any($2::uuid[]) order by capturado_em', [A.tenantId, ids])).rows;
      const item = (pt: { id: string }): ItemPush => ({ id: pt.id, entidade: ENTIDADE_PONTO_TRAJETO, operacao: 'upsert', payload: pt });
      await api.admin.query("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId]);
      await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'rastreamento', $2::jsonb)", [A.tenantId, JSON.stringify({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true, expediente: EXPEDIENTE })]);
      try {
        const lote = PONTOS_SUP.map(item);
        for (const r of await push(tk.supervisor, lote)) expect(r.status, JSON.stringify(r)).toBe('aceito');
        // 11: o reenvio do mesmo lote (rede voltou, a confirmação não chegou) não duplica
        for (const r of await push(tk.supervisor, lote)) expect(r.status, JSON.stringify(r)).toBe('aceito');
        const gravados = await pontos(PONTOS_SUP.map((x) => x.id));
        expect(gravados.map((g) => [g.id, g.usuario_id])).toEqual(PONTOS_SUP.map((x) => [x.id, A.usuarios.supervisor]));
        // 8: o gerente nunca é rastreado (cargo), mesmo ligado e no expediente
        await push(tk.gerente, [item(PONTO_GER)]);
        expect(await pontos([PONTO_GER.id])).toEqual([]);
        // 9: o gerente vê o trajeto do supervisor; o supervisor não vê o dele (404)
        const g = await api.chamar(tk.gerente, { method: 'GET', url: `/v1/core/trajeto?usuario_id=${A.usuarios.supervisor}&data=2026-11-18` });
        expect(g.statusCode, g.body).toBe(200);
        expect((await api.chamar(tk.supervisor, { method: 'GET', url: `/v1/core/trajeto?usuario_id=${A.usuarios.supervisor}&data=2026-11-18` })).statusCode).toBe(404);
      } finally {
        await api.admin.query("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId]);
        if (antes) await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'rastreamento', $2::jsonb)", [A.tenantId, JSON.stringify(antes.valor)]);
      }
    });
    it.todo('8 (desligado de fábrica, API) — coberto no domínio (7/8 em tests/modulos/supervisor-campo-t0187.test.ts) e no trajeto.db.test.ts do modulo-core: desligar o parâmetro do tenant A aqui colidiria com o trajeto-envio-t0156 em paralelo');
    it.todo('11 (aparelho). a captura do trajeto no Gestão (serviço macuxi-trajeto na variante gestao) e a fila de 3 dias sem rede — roteiro manual em docs/testes/T-0187.md (aparelho real, GPS em segundo plano)');
    it.todo('10 (aparelho). nenhuma coordenada vai para log, erro ou Diagnóstico do Gestão (G4 do docs/seguranca/checklist.md) e a ficha não mostra o próprio trajeto — roteiro manual em docs/testes/T-0187.md (a API do próprio trajeto = 404 está no 9)');
  });
});
