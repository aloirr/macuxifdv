/**
 * T-0174 (desenho docs/desenho/T-0174.md): frases da tela de carga sem banco real. Portal (só super-admin, contrato do SDK na
 * entrada e na saída, 422 da regra do texto, auditoria da requisição) e a rota do app (sessão do app, sem licença de módulo,
 * só as ativas pela ordem). As funções de verdade da 0075 são testadas no CI pelo banco-dados. Frases fictícias.
 */
import { FRASES_CARGA_INICIAIS, type AcessoPortalAutenticado, type FraseCarga } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { FonteFrasesCarga } from '../src/frases-carga';
import { fontePlataformaNoBanco, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, cab, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: '0a000000-0000-4000-8000-000000000001', usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const URL_PORTAL = '/v1/plataforma/frases-carga';
const URL_APP = '/v1/sync/frases-carga';
const sa = { 'x-quem': 'sa' };
const NOVA = '0f7a0000-0000-4000-8000-000000000001';

/** Imita as funções da 0075 sobre uma lista em memória (duplicidade = 23505, sem achar = P0002). */
function montar(op: { erro?: string; erroApp?: string; licencasSoCore?: boolean } = {}) {
  const frases: FraseCarga[] = FRASES_CARGA_INICIAIS.slice(0, 3).map((f) => ({ ...f }));
  const chamadas = { incluir: [] as unknown[][], editar: [] as unknown[][] };
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const pg = (code: string) => Object.assign(new Error('pg'), { code });
  const repetida = (texto: string, id: string) => frases.some((f) => f.id !== id && f.texto.toLowerCase() === texto.toLowerCase());
  const fonte: FonteFrasesCarga = {
    ativas: async () => {
      if (op.erroApp) throw pg(op.erroApp);
      return { frases: frases.filter((f) => f.ativa).reverse().map(({ id, texto, ordem }) => ({ id, texto, ordem })) };
    },
    listar: async (sid) => {
      expect(sid).toBe(SA.sessao_id);
      if (op.erro) throw pg(op.erro);
      return { itens: frases };
    },
    incluir: async (sid, id, texto) => {
      expect(sid).toBe(SA.sessao_id);
      chamadas.incluir.push([id, texto]);
      const ja = frases.find((f) => f.id === id);
      if (ja) return ja;
      if (repetida(texto, id)) throw pg('23505');
      const n = frases.length + 1;
      const f = { id, numero: n, texto, ativa: true, ordem: n };
      frases.push(f);
      return f;
    },
    editar: async (_sid, id, texto, ativa) => {
      chamadas.editar.push([id, texto, ativa]);
      const f = frases.find((x) => x.id === id);
      if (!f) throw pg('P0002');
      if (texto !== null && repetida(texto, id)) throw pg('23505');
      if (texto !== null) f.texto = texto;
      if (ativa !== null) f.ativa = ativa;
      return f;
    },
  };
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma: { ...fontePlataformaNoBanco, auditar: async (l) => void auditoria.push(l) },
      fonteFrasesCarga: fonte,
      ...(op.licencasSoCore
        ? { licencas: async () => ({ ativosNoTenant: ['core'], doPerfil: ['core'], removidosDoUsuario: [], parametros: {} }) }
        : {}),
    }),
  );
  return { app, frases, chamadas, auditoria };
}

describe('Portal › Frases da carga (só super-admin)', () => {
  it('sem login = 401; admin do cliente = 403 (auditado); nada chega ao banco', async () => {
    const { app, chamadas, auditoria } = montar();
    expect((await app.inject({ method: 'GET', url: URL_PORTAL })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: URL_PORTAL, headers: { 'x-quem': 'cli' }, payload: { texto: 'Frase nova.' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO' });
    expect(chamadas.incluir).toEqual([]);
    expect(auditoria).toMatchObject([{ ator_tipo: 'admin_cliente', acao: 'sa.requisicao', status: 403 }]);
  });

  it('lista: ativas primeiro pelo Nº, inativas no fim; no-store; auditoria', async () => {
    const { app, frases, auditoria } = montar();
    frases[0]!.ativa = false;
    const r = await app.inject({ method: 'GET', url: URL_PORTAL, headers: sa });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.json().itens.map((f: FraseCarga) => f.numero)).toEqual([2, 3, 1]);
    expect(auditoria).toMatchObject([{ ator_tipo: 'super_admin', acao: 'sa.requisicao', rota: URL_PORTAL, status: 200 }]);
  });

  it('inclui com trim: 201, nasce ativa, Nº seguinte; o mesmo id de novo é idempotente', async () => {
    const { app, chamadas } = montar();
    const r = await app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: { id: NOVA, texto: '  Frase nova.  ' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ id: NOVA, numero: 4, texto: 'Frase nova.', ativa: true, ordem: 4 });
    const deNovo = await app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: { id: NOVA, texto: 'Frase nova.' } });
    expect(deNovo.json()).toMatchObject({ id: NOVA, numero: 4 });
    expect(chamadas.incluir).toEqual([
      [NOVA, 'Frase nova.'],
      [NOVA, 'Frase nova.'],
    ]);
  });

  it('sem id no corpo, a API gera um UUID', async () => {
    const { app, chamadas } = montar();
    const r = await app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: { texto: 'Outra frase.' } });
    expect(r.statusCode).toBe(201);
    expect(chamadas.incluir[0]![0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('422 com a frase da tela: vazia, acima de 90 e repetida (sem diferenciar maiúsculas)', async () => {
    const { app, chamadas } = montar();
    const post = (texto: string) => app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: { texto } });
    const vazia = await post('   ');
    expect(vazia.statusCode).toBe(422);
    expect(vazia.json()).toMatchObject({ codigo: 'FRASE_VAZIA', mensagem: 'Escreva a frase.' });
    const longa = await post('x'.repeat(91));
    expect(longa.statusCode).toBe(422);
    expect(longa.json()).toMatchObject({ codigo: 'FRASE_LONGA' });
    expect(chamadas.incluir).toEqual([]);
    const repetida = await post(FRASES_CARGA_INICIAIS[1]!.texto.toUpperCase());
    expect(repetida.statusCode).toBe(422);
    expect(repetida.json()).toMatchObject({ codigo: 'FRASE_DUPLICADA', mensagem: 'Essa frase já está na lista.' });
  });

  it('corpo fora do contrato = 400 (campo a mais, sem texto)', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: { texto: 'x', ativa: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: URL_PORTAL, headers: sa, payload: {} })).statusCode).toBe(400);
  });

  it('PATCH: desativa e reativa só a situação (texto nulo = não muda); edita o texto com trim', async () => {
    const { app, chamadas } = montar();
    const id = FRASES_CARGA_INICIAIS[0]!.id;
    const des = await app.inject({ method: 'PATCH', url: `${URL_PORTAL}/${id}`, headers: sa, payload: { ativa: false } });
    expect(des.statusCode).toBe(200);
    expect(des.json()).toMatchObject({ id, ativa: false, texto: FRASES_CARGA_INICIAIS[0]!.texto });
    const ed = await app.inject({ method: 'PATCH', url: `${URL_PORTAL}/${id}`, headers: sa, payload: { texto: ' Texto novo. ' } });
    expect(ed.json()).toMatchObject({ id, ativa: false, texto: 'Texto novo.' });
    expect(chamadas.editar).toEqual([
      [id, null, false],
      [id, 'Texto novo.', null],
    ]);
  });

  it('PATCH: vazio = 400; texto repetido = 422; id inexistente = 404; sem DELETE', async () => {
    const { app } = montar();
    const id = FRASES_CARGA_INICIAIS[0]!.id;
    expect((await app.inject({ method: 'PATCH', url: `${URL_PORTAL}/${id}`, headers: sa, payload: {} })).statusCode).toBe(400);
    const rep = await app.inject({ method: 'PATCH', url: `${URL_PORTAL}/${id}`, headers: sa, payload: { texto: FRASES_CARGA_INICIAIS[2]!.texto } });
    expect(rep.statusCode).toBe(422);
    expect((await app.inject({ method: 'PATCH', url: `${URL_PORTAL}/${NOVA}`, headers: sa, payload: { ativa: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `${URL_PORTAL}/${id}`, headers: sa })).statusCode).toBe(404);
  });

  it('sessão vencida no meio = 401; antes da 0075 (função ausente) = 503', async () => {
    expect((await montar({ erro: '28000' }).app.inject({ method: 'GET', url: URL_PORTAL, headers: sa })).statusCode).toBe(401);
    const r = await montar({ erro: '42883' }).app.inject({ method: 'GET', url: URL_PORTAL, headers: sa });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'FRASES_CARGA_INDISPONIVEIS' });
  });
});

describe('GET /v1/sync/frases-carga (app)', () => {
  it('sem sessão do app = 401', async () => {
    expect((await montar().app.inject({ method: 'GET', url: URL_APP })).statusCode).toBe(401);
  });

  it('qualquer perfil, mesmo só com o Core (sem licença de módulo): só as ativas, pela ordem, sem fonte', async () => {
    const { app, frases } = montar({ licencasSoCore: true });
    frases[1]!.ativa = false;
    for (const quem of ['vendedor', 'promotor', 'supervisor'] as const) {
      const r = await app.inject({ method: 'GET', url: URL_APP, headers: cab(quem) });
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('private, no-store');
      const corpo = r.json();
      expect(corpo.frases.map((f: { ordem: number }) => f.ordem)).toEqual([1, 3]);
      expect(Object.keys(corpo.frases[0]).sort()).toEqual(['id', 'ordem', 'texto']);
    }
  });

  it('antes da 0075 = 503 (o app segue com a lista que tem)', async () => {
    const r = await montar({ erroApp: '42883' }).app.inject({ method: 'GET', url: URL_APP, headers: cab('vendedor') });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'FRASES_CARGA_INDISPONIVEIS' });
  });
});
