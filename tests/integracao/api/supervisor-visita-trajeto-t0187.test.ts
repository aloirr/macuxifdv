/**
 * T-0187 (v1.0.16) — supervisor em campo no Gestão: check-in e checkout do supervisor (RN-CORE-13) e o trajeto dele (interno,
 * desligado de fábrica, visível só ao gerente), com a API REAL (createApp × Postgres como macuxi_app × fixture dois-tenants).
 * Desenho: docs/desenho/T-0187.md §1.1, §1.2, §2 e §4 (branch nuvem/v1016-supervisor-engenheiro-software). Matriz: docs/testes/T-0187.md.
 * Regras: RN-CORE-13 (check-in único, trajeto), RN-CORE-04 (carteira da equipe), RN-CORE-05 (tenant), RN-CORE-11 (uma visita aberta).
 *
 * Convenção: `it` = critério que o `main` já atende; `it.runIf(<código entregue>)` = liga sozinho quando o símbolo do dono chegar
 * (aqui: `APP_RASTREADO_DO_CARGO` do modulo-core, que entra com o portão novo e o 404 do próprio trajeto); `it.todo` = sem como
 * testar até o dono entregar.
 */
import * as portao from '@macuxi/core/contracts';
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
} as const;
/** c1 (Manaus) com GPS na porta; c3 não tem coordenada. */
const EM_C1 = { lat: -3.1019, lng: -60.025, precisao_m: 8 };
/** O portão novo do modulo-core (desenho §1.2): exportado pelos contratos junto com o 404 do próprio trajeto. */
const TEM_PORTAO_NOVO = 'APP_RASTREADO_DO_CARGO' in portao;
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date());

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
    payload: { id: vid, cliente_id: cliente, checkin_em: new Date().toISOString(), extra: true, ...extra },
  });
  const checkout = (cmd: string, vid: string): ItemPush => ({
    id: cmd,
    entidade: 'visita_checkout',
    operacao: 'upsert',
    payload: { id: cmd, visita_id: vid, checkout_em: new Date().toISOString(), resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, etapas: [] },
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
  }, 120_000);

  afterAll(async () => {
    if (!api) return;
    await api.admin.query('delete from core.visita where id = any($1::uuid[])', [Object.values(V)]).catch(() => undefined);
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

  it.todo('3 (aparelho). a visita aberta do próprio supervisor trava o check-in dele em outro cliente na Rota do Gestão (filtro por usuario_id da sessão) — aguardando modulo-core (app/index.ts e a faixa de visita aberta no Gestão)');
  it.todo('5. supervisor sem visita.registrar_gestao: push de visita volta rejeitado PERFIL_SEM_ACESSO e a aba Rota e o Check-in somem — aguardando modulo-core (ação nova no manifesto, visita-push.ts e acesso.ts)');
  it.todo('6. o check-in do supervisor fica fora da cobertura de rota e da meta de visitas do vendedor (RN-GES-05) e aparece em "Visitada por" — aguardando modulo-gestor');

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

    it.todo('8. ponto de supervisor com rastreamento.ativo ligado e no expediente é gravado; o de gerente é descartado (cargo); com o parâmetro desligado (padrão de fábrica) é descartado — aguardando modulo-core (trajeto-push.ts e triarPontoRecebido com APP_RASTREADO_DO_CARGO)');
    it.todo('10. nenhuma tela do Gestão mostra trajeto e nenhuma coordenada vai para log, erro ou Diagnóstico (G4 do docs/seguranca/checklist.md) — aguardando engenheiro-apps (serviço macuxi-trajeto na variante gestao); roteiro manual em docs/testes/T-0187.md');
    it.todo('11. offline: 3 dias de pontos do supervisor sem rede sobem sem duplicar, como no Campo — aguardando engenheiro-apps (captura no Gestão) e modulo-core (portão)');
  });
});
