/**
 * Validação da RN-CORE-15 (incluída na T-0017; agente `testes`, Sprint 1) de ponta a ponta pelo `createApp` REAL:
 * o analista bloqueia pelo BKO (`PUT /v1/core/dispositivos/:id/bloqueio`, auditado) um aparelho em uso; a partir daí
 * NENHUM usuário do tenant entra por ele (login e refresh → 423 `DISPOSITIVO_BLOQUEADO`, só revelado a quem acertou a
 * senha ou tem sessão válida); o tenant B não é afetado nem enxerga/bloqueia o aparelho de A; desbloquear devolve o
 * acesso. No app: a função pura do Core (`tratarAparelhoBloqueado`) com `motor.limparAparelho()` real apaga linhas,
 * cursores e a fila não enviada. Cenários S1-030..S1-035 de tests/plano/sprint-1.md (S1-035 = O-5,
 * corte imediato: o JWT de acesso leva o aparelho e cada requisição o confere).
 */
import { AVISO_APARELHO_LIMPO, RefreshRespostaSchema } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import { criarArmazenamentoEmMemoria, criarMotorSync, criarRegistroSync, definirEntidadeSync, type LinhaSync, type PaginaSync, type TransporteSync } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tratarAparelhoBloqueado } from '../../../modules/core/app/lib/aparelho-bloqueado';
import { entidadesCliente } from '../../../modules/core/app/lib/entidades-cliente';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';

/** Aparelho NOVO do vendedor-1 (UUID gerado "no aparelho"); registrado pelo próprio login. */
const APARELHO = '0d000000-0000-4000-8000-0000000015a1';
const OUTRO_APARELHO = '0d000000-0000-4000-8000-0000000015a2';
const APARELHO_B = '0d000000-0000-4000-8000-0000000015b1';

describe.skipIf(semBanco())('RN-CORE-15 — aparelho bloqueado vale para o tenant inteiro e não afeta o tenant B (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let analista: string;
  let adminB: string;

  const refresh = (refresh_token: string, dispositivo_id?: string) =>
    api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token, ...(dispositivo_id ? { dispositivo_id } : {}) } });
  const bloquear = (token: string, id: string, motivo?: string) =>
    api.chamar(token, { method: 'PUT', url: `/v1/core/dispositivos/${id}/bloqueio`, payload: motivo ? { motivo } : {} });
  const desbloquear = (token: string, id: string) => api.chamar(token, { method: 'DELETE', url: `/v1/core/dispositivos/${id}/bloqueio` });

  beforeAll(async () => {
    api = await subirApi();
    analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S1-030: só admin e analista bloqueiam; vendedor, promotor, supervisor, gerente e assistente → 403 PERFIL_SEM_ACESSO', async () => {
    for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br', 'supervisor@exemplo.com.br', 'gerente@exemplo.com.br', 'assistente@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const r = await bloquear(t, A.dispositivos.vendedor1);
      expect([r.statusCode, erroDe(r).codigo], email).toEqual([403, 'PERFIL_SEM_ACESSO']);
      const l = await api.chamar(t, { method: 'GET', url: '/v1/core/dispositivos' });
      expect([l.statusCode, erroDe(l).codigo], `lista ${email}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
    }
    const ainda = await api.admin.query('select bloqueado_em from core.dispositivo where id = $1', [A.dispositivos.vendedor1]);
    expect(ainda.rows[0].bloqueado_em).toBeNull();
  });

  it('S1-031: aparelho em uso bloqueado pelo BKO → refresh 423 e a família cai; login de QUALQUER usuário de A por ele → 423; senha errada segue 401', async () => {
    const login = await api.entrar('vendedor@exemplo.com.br', { dispositivo_id: APARELHO });
    expect(login.statusCode, login.body).toBe(200);
    const sessao = login.json() as { refresh_token: string; access_token: string };
    const lista = await api.chamar(analista, { method: 'GET', url: '/v1/core/dispositivos' });
    expect((lista.json() as { itens: Array<{ id: string; bloqueado_em: string | null }> }).itens).toContainEqual(expect.objectContaining({ id: APARELHO, bloqueado_em: null }));

    const b = await bloquear(analista, APARELHO, 'aparelho roubado');
    expect(b.statusCode, b.body).toBe(200);
    const aud = await api.admin.query<{ acao: string; usuario_id: string }>('select acao, usuario_id from plataforma.auditoria where entidade_id = $1', [APARELHO]);
    expect(aud.rows).toEqual([{ acao: 'dispositivo.bloquear', usuario_id: A.usuarios.analista }]);

    const r1 = await refresh(sessao.refresh_token);
    expect([r1.statusCode, erroDe(r1).codigo]).toEqual([423, 'DISPOSITIVO_BLOQUEADO']);
    // a família foi revogada: o mesmo refresh não serve mais (401, sem revelar de novo)
    const r2 = await refresh(sessao.refresh_token);
    expect(r2.statusCode).toBe(401);

    for (const email of ['vendedor@exemplo.com.br', 'supervisor@exemplo.com.br', 'admin@exemplo.com.br', 'promotor@exemplo.com.br']) {
      const r = await api.entrar(email, { dispositivo_id: APARELHO });
      expect([r.statusCode, erroDe(r).codigo], email).toEqual([423, 'DISPOSITIVO_BLOQUEADO']);
      const errada = await api.entrar(email, { dispositivo_id: APARELHO, senha: 'Errada@9999' });
      expect([errada.statusCode, erroDe(errada).codigo], `${email} senha errada`).toEqual([401, 'CREDENCIAIS_INVALIDAS']);
    }
    // por outro aparelho o usuário entra normalmente
    expect((await api.entrar('vendedor@exemplo.com.br', { dispositivo_id: OUTRO_APARELHO })).statusCode).toBe(200);
  });

  it('S1-032 RN-CORE-05: o tenant B não é afetado — entra e renova pelo próprio aparelho; não vê nem bloqueia o aparelho de A; o id de A em B não vira 423', async () => {
    const loginB = await api.entrar('vendedor@exemplo.com.br', { tenant: B, dispositivo_id: APARELHO_B });
    expect(loginB.statusCode, loginB.body).toBe(200);
    const rb = await refresh((loginB.json() as { refresh_token: string }).refresh_token);
    expect(rb.statusCode, rb.body).toBe(200);
    RefreshRespostaSchema.parse(rb.json());
    expect((await api.entrar('vendedor@exemplo.com.br', { tenant: B, dispositivo_id: B.dispositivos.vendedor })).statusCode).toBe(200);

    const listaB = await api.chamar(adminB, { method: 'GET', url: '/v1/core/dispositivos' });
    expect(listaB.statusCode, listaB.body).toBe(200);
    const idsB = (listaB.json() as { itens: Array<{ id: string }> }).itens.map((i) => i.id);
    expect(idsB).not.toContain(APARELHO);
    expect(idsB).not.toContain(A.dispositivos.vendedor1);
    for (const r of [await bloquear(adminB, A.dispositivos.vendedor1), await desbloquear(adminB, APARELHO)])
      expect([r.statusCode, erroDe(r).codigo]).toEqual([404, 'DISPOSITIVO_NAO_ENCONTRADO']);
    const estadoA = await api.admin.query<{ id: string; bloqueado: boolean }>('select id, bloqueado_em is not null as bloqueado from core.dispositivo where id = any($1::uuid[]) order by id', [
      [APARELHO, A.dispositivos.vendedor1],
    ]);
    expect(Object.fromEntries(estadoA.rows.map((x) => [x.id, x.bloqueado]))).toEqual({ [APARELHO]: true, [A.dispositivos.vendedor1]: false });

    // o id do aparelho bloqueado de A apresentado no login de B: nunca 423 (não revela o estado de A) nem 500
    const cruzado = await api.entrar('vendedor@exemplo.com.br', { tenant: B, dispositivo_id: APARELHO });
    expect(cruzado.statusCode).not.toBe(423);
    expect(cruzado.statusCode).toBeLessThan(500);
    expect(cruzado.body).not.toMatch(/Alfa|aaaaaaaa/);
  });

  it('S1-033: desbloquear (auditado) devolve o acesso pelo aparelho a qualquer usuário de A', async () => {
    const d = await desbloquear(analista, APARELHO);
    expect(d.statusCode, d.body).toBe(200);
    const aud = await api.admin.query<{ acao: string }>('select acao from plataforma.auditoria where entidade_id = $1 order by created_at', [APARELHO]);
    expect(aud.rows.map((x) => x.acao)).toEqual(['dispositivo.bloquear', 'dispositivo.desbloquear']);
    for (const email of ['vendedor@exemplo.com.br', 'supervisor@exemplo.com.br']) {
      const r = await api.entrar(email, { dispositivo_id: APARELHO });
      expect(r.statusCode, `${email}: ${r.body}`).toBe(200);
    }
  });

  it('S1-034 (app): 423 no refresh → tratarAparelhoBloqueado + motor.limparAparelho() apagam linhas, cursores e a fila não enviada, com aviso e volta ao login', async () => {
    const login = await api.entrar('vendedor@exemplo.com.br', { dispositivo_id: APARELHO });
    const s = login.json() as { access_token: string; refresh_token: string };
    const transporte: TransporteSync = {
      push: async (itens) => itens.map((i) => ({ id: i.id, status: 'rejeitado' as const, codigo: 'SYNC_NAO_IMPLEMENTADO', mensagem: 'fila de teste' })),
      async pull(entidade, cursor) {
        const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
        const r = await api.chamar(s.access_token, { method: 'GET', url: `/v1/sync/pull?${q}` });
        if (r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`);
        return r.json() as PaginaSync<LinhaSync>;
      },
    };
    const registro = criarRegistroSync([manifestoCore]);
    for (const e of entidadesCliente) registro.registrar(e);
    // entidade de envio do Core (checkout) só para haver fila não enviada; o transporte de teste a deixa pendente
    registro.registrar(definirEntidadeSync({ nome: 'visita_checkout', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: z.unknown() }));
    const armazenamento = criarArmazenamentoEmMemoria();
    const motor = criarMotorSync({ registro, armazenamento, transporte });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core']);
    await new Promise((r) => setTimeout(r, 2_500)); // horizonte seguro do pull
    await motor.sincronizar();
    expect((await motor.linhas('cliente')).length).toBeGreaterThan(0);
    await motor.armazenamentoDoModulo('core').gravar('rascunho', { x: 1 });
    // item feito no aparelho e ainda não enviado (entidade de push do Core no manifesto)
    await motor.enfileirar({ id: '0e000000-0000-4000-8000-0000000015f1', entidade: 'visita_checkout', payload: { id: '0e000000-0000-4000-8000-0000000015f1' } });
    expect(motor.estado().fila).toHaveLength(1);
    expect(Object.keys(armazenamento.conteudo()).length).toBeGreaterThan(0);

    expect((await bloquear(analista, APARELHO)).statusCode).toBe(200);
    const r = await refresh(s.refresh_token);
    expect(r.statusCode).toBe(423);
    const avisos: string[] = [];
    let login2 = false;
    let sessaoEncerrada = false;
    const tratou = await tratarAparelhoBloqueado(erroDe(r), {
      apagarDadosLocais: () => motor.limparAparelho(),
      encerrarSessao: async () => {
        sessaoEncerrada = true;
      },
      avisar: (m) => avisos.push(m),
      irParaLogin: () => {
        login2 = true;
      },
    });
    expect(tratou).toBe(true);
    expect(armazenamento.conteudo()).toEqual({});
    expect(motor.estado().fila).toEqual([]);
    expect(await motor.linhas('cliente')).toEqual([]);
    expect(await motor.linhas('titulo')).toEqual([]);
    expect([sessaoEncerrada, login2, avisos]).toEqual([true, true, [AVISO_APARELHO_LIMPO]]);
    // qualquer outro erro não toca no aparelho
    expect(await tratarAparelhoBloqueado({ codigo: 'SESSAO_INVALIDA' }, { apagarDadosLocais: () => Promise.reject(new Error('não devia')), encerrarSessao: async () => undefined, avisar: () => undefined, irParaLogin: () => undefined })).toBe(false);
  });

  it('S1-035 O-5 (RN-CORE-15, corte imediato): bloqueado no BKO, a PRÓXIMA requisição do mesmo token já recebe 423 em toda superfície (rota do Core, me/modulos, pull, push, arquivos), sem gravar nada; sessão sem aparelho e o tenant B seguem; desbloqueio devolve o mesmo token', async () => {
    const D_VENDEDOR = '0d000000-0000-4000-8000-0000000015c1';
    const D_RENOVADO = '0d000000-0000-4000-8000-0000000015c2';
    const D_B = '0d000000-0000-4000-8000-0000000015c3';
    const token = async (email: string, dispositivo_id?: string, tenant: typeof A | typeof B = A) => {
      const r = await api.entrar(email, { tenant, ...(dispositivo_id ? { dispositivo_id } : {}) });
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as { access_token: string; refresh_token: string };
    };
    const itemVisita = { id: '0e000000-0000-4000-8000-0000000015d1', entidade: 'visita', operacao: 'upsert', payload: { id: '0e000000-0000-4000-8000-0000000015d1', cliente_id: A.clientes.c1, checkin_em: new Date().toISOString(), extra: true } };
    /** As superfícies autenticadas que o app usa, com o mesmo token. */
    const superficies = (t: string) => ({
      clientes: () => api.chamar(t, { method: 'GET', url: '/v1/core/clientes' }),
      modulos: () => api.chamar(t, { method: 'GET', url: '/v1/me/modulos' }),
      pull: () => api.chamar(t, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' }),
      push: () => api.chamar(t, { method: 'POST', url: '/v1/sync/push', payload: { itens: [itemVisita] } }),
      arquivo: () =>
        api.chamar(t, { method: 'PUT', url: '/v1/arquivos/0e000000-0000-4000-8000-0000000015d2', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
      notificacoes: () => api.chamar(t, { method: 'GET', url: '/v1/core/notificacoes' }),
    });

    const vendedor = await token('vendedor@exemplo.com.br', D_VENDEDOR);
    const supervisorNoMesmo = await token('supervisor@exemplo.com.br', D_VENDEDOR);
    const semAparelho = await token('vendedor@exemplo.com.br');
    const renovado = await token('promotor@exemplo.com.br', D_RENOVADO);
    const doB = await token('vendedor@exemplo.com.br', D_B, B);
    // o acesso emitido pelo REFRESH também leva o aparelho
    const r = await refresh(renovado.refresh_token);
    expect(r.statusCode, r.body).toBe(200);
    const acessoRenovado = (r.json() as { access_token: string }).access_token;
    for (const t of [vendedor.access_token, supervisorNoMesmo.access_token, semAparelho.access_token, acessoRenovado, doB.access_token])
      expect((await api.chamar(t, { method: 'GET', url: '/v1/me/modulos' })).statusCode).toBe(200);

    expect((await bloquear(analista, D_VENDEDOR, 'perdido')).statusCode).toBe(200);
    expect((await bloquear(analista, D_RENOVADO)).statusCode).toBe(200);
    for (const [quem, t] of [
      ['vendedor no aparelho', vendedor.access_token],
      ['supervisor no mesmo aparelho', supervisorNoMesmo.access_token],
      ['acesso emitido pelo refresh', acessoRenovado],
    ] as const) {
      for (const [nome, chamar] of Object.entries(superficies(t))) {
        const x = await chamar();
        expect([x.statusCode, erroDe(x).codigo], `${quem} · ${nome}`).toEqual([423, 'DISPOSITIVO_BLOQUEADO']);
        expect(x.body, `${quem} · ${nome}`).not.toMatch(/Alfa|Auto Peças|aaaaaaaa-0004/);
      }
    }
    // nada do que chegou com o token cortado foi gravado
    expect((await api.admin.query('select count(*)::int as n from core.visita where id = $1', [itemVisita.id])).rows[0].n).toBe(0);
    expect((await api.admin.query("select count(*)::int as n from plataforma.arquivo where id = '0e000000-0000-4000-8000-0000000015d2'")).rows[0].n).toBe(0);
    // a mesma pessoa por sessão sem aparelho e o tenant B (aparelho próprio) seguem normais
    for (const [quem, t] of [
      ['sessão sem aparelho', semAparelho.access_token],
      ['tenant B', doB.access_token],
    ] as const) {
      expect((await api.chamar(t, { method: 'GET', url: '/v1/core/clientes' })).statusCode, quem).toBe(200);
      expect((await api.chamar(t, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' })).statusCode, quem).toBe(200);
    }

    // desbloquear: o MESMO token (ainda dentro dos 15 min) volta a valer, sem novo login
    expect((await desbloquear(analista, D_VENDEDOR)).statusCode).toBe(200);
    expect((await api.chamar(vendedor.access_token, { method: 'GET', url: '/v1/core/clientes' })).statusCode).toBe(200);
    expect((await api.chamar(supervisorNoMesmo.access_token, { method: 'GET', url: '/v1/me/modulos' })).statusCode).toBe(200);
    // o outro aparelho bloqueado segue cortado
    expect((await api.chamar(acessoRenovado, { method: 'GET', url: '/v1/me/modulos' })).statusCode).toBe(423);
  });
});
