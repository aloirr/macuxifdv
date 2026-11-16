/**
 * T-0181 — frases da tela de carga (desenho docs/desenho/T-0181.md; spec docs/design/carga-aviso-frases/ §2 a §4). Integração
 * de ponta a ponta: API real (`createApp` + Core + módulos, `macuxi_app` e o 2º pool do `macuxi_portal`) sobre o banco efêmero do
 * arquivo com a 0081 (banco-dados) e o contrato do SDK (`@macuxi/platform-sdk`, engenheiro-software). Padrão dos testes do portal
 * (T-0093/T-0158): super-admin pelo caminho do deploy, admin do cliente da fixture. Só o que a API e a integração veem: o que é
 * só do banco (SQLSTATE das `sa_*` chamadas direto, catálogo de funções, privilégios dos papéis) fica em
 * `db/testes/t0181-frase-carga.db.test.ts` e em `tests/integracao/banco/conformidade.test.ts` (RD-0525).
 *
 * FC-01 seed: as 30 iniciais, ativas, Nº = ordem = 1..30, id = `uuid_de_chave('plataforma:frase_carga:NN')`, iguais às
 *       `FRASES_CARGA_INICIAIS` do SDK (id, Nº, texto, ordem); portal e app devolvem as mesmas 30;
 * FC-02 portal só super-admin: sem token 401, token do app 401, admin do cliente 403 `PERFIL_SEM_ACESSO` em GET/POST/PATCH
 *       (nada muda);
 * FC-03 incluir: nasce ativa com Nº e ordem seguintes, texto com trim; reenvio com o mesmo id é idempotente; o mesmo id com
 *       outro texto 422; sem id a API gera; a auditoria tem id e Nº, nunca o texto;
 * FC-04 texto: vazio 422 `FRASE_VAZIA`; exatamente 90 (com acento) 201; 91 422 `FRASE_LONGA`; repetida sem diferenciar
 *       maiúsculas nem espaços 422 `FRASE_DUPLICADA`;
 * FC-05 editar: texto com trim, Nº e ordem mantidos; a própria com outra caixa passa; repetida 422; vazio 422; > 90 422;
 *       corpo vazio 400; id inexistente ou apagado 404; id fora de UUID 400;
 * FC-06 ativar/desativar: a inativa sai do `/v1/sync/frases-carga` e vai para o fim da lista do portal (ordem do banco);
 *       reativada volta;
 * FC-07 sem exclusão: DELETE 404 e a frase continua;
 * FC-08 `/v1/sync/frases-carga`: sem sessão 401; vendedor, promotor e admin, de A e de B, recebem a MESMA lista (global), só
 *       ativas e vivas, pela ordem, só `id`, `texto`, `ordem`, `no-store`; com o módulo do perfil desligado continua 200.
 * Roda só com banco e o papel do portal (CI); sem eles, pula. A matriz é esta lista FC-01..08 (docs/testes/T-0181.md).
 */
import crypto from 'node:crypto';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import {
  FRASE_CARGA_MAX,
  FRASES_CARGA_INICIAIS,
  FraseCargaSchema,
  FrasesCargaAppRespostaSchema,
  FrasesCargaListaSchema,
  ROTA_PORTAL_FRASES_CARGA,
  ROTA_SYNC_FRASES_CARGA,
  type FraseCarga,
} from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, comToken, erroDe, licenca, SENHA, subirApi, type ApiDeTeste } from '../apoio/api';
import { auditoriaDoPortal, criarSuperAdmin, sessaoDoPortal } from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0181-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;
const SUPER = { email: 'frases.t0181@exemplo.com.br', nome: 'Operador Frases Fictício', senha: 'Frases#Macuxi-2026' };

/** Frases de teste (fictícias; nunca repetem as 30 iniciais). */
const NOVA = 'Frase de teste da T-0181 sobre o lavrado.';
const NOVA_EDITADA = 'Frase de teste da T-0181, editada no portal.';
const SEM_ID = 'Outra frase de teste da T-0181, sem id no corpo.';
/** Exatamente 90 pontos de código, com acento (char_length do Postgres = Array.from no SDK). */
const COM_90 = `Limite T-0181 ${'ã'.repeat(FRASE_CARGA_MAX - 'Limite T-0181 '.length)}`;
const COM_91 = `${COM_90}x`;

type Item = Pick<FraseCarga, 'id' | 'numero' | 'texto' | 'ativa' | 'ordem'>;

describe.skipIf(semBanco() || !!SEM_PORTAL)('T-0181 frases da tela de carga: portal só super-admin, sem exclusão, app só as ativas', () => {
  let api: ApiDeTeste;
  let tokenSA = '';
  let tokenCli = '';
  const app: Record<'vendedorA' | 'promotorA' | 'adminA' | 'vendedorB' | 'adminB', string> = {
    vendedorA: '',
    promotorA: '',
    adminA: '',
    vendedorB: '',
    adminB: '',
  };
  /** Ids das frases criadas nos casos (FC-03 em diante). */
  const criadas = { nova: crypto.randomUUID(), semId: '' };
  /** Todo texto de frase que passou pelas rotas: nunca pode aparecer na auditoria. */
  const textosDeTeste = [NOVA, NOVA_EDITADA, SEM_ID, COM_90];

  const portal = (token: string | null, op: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url?: string; payload?: object }): Promise<LightMyRequestResponse> =>
    api.app.inject({
      method: op.method,
      url: op.url ?? ROTA_PORTAL_FRASES_CARGA,
      headers: comToken(token),
      ...(op.payload !== undefined ? { payload: op.payload } : {}),
    });
  const incluir = (payload: object, token = tokenSA) => portal(token, { method: 'POST', payload });
  const editar = (id: string, payload: object, token = tokenSA) => portal(token, { method: 'PATCH', url: `${ROTA_PORTAL_FRASES_CARGA}/${id}`, payload });

  async function listaDoPortal(): Promise<Item[]> {
    const r = await portal(tokenSA, { method: 'GET' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    return FrasesCargaListaSchema.parse(r.json()).itens;
  }
  async function doApp(token: string): Promise<{ id: string; texto: string; ordem: number }[]> {
    const r = await api.chamar(token, { method: 'GET', url: ROTA_SYNC_FRASES_CARGA });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    const corpo = r.json() as { frases: Record<string, unknown>[] };
    for (const f of corpo.frases) expect(Object.keys(f).sort()).toEqual(['id', 'ordem', 'texto']);
    return FrasesCargaAppRespostaSchema.parse(corpo).frases;
  }
  /** Linhas da tabela pela administração (inclusive as apagadas), pelo Nº. */
  async function noBanco(): Promise<(Item & { viva: boolean; id_por_chave: boolean })[]> {
    const r = await api.admin.query<Item & { viva: boolean; id_por_chave: boolean }>(
      `select id::text as id, numero, texto, ativa, ordem, deleted_at is null as viva,
              id = plataforma.uuid_de_chave('plataforma:frase_carga:' || lpad(numero::text, 2, '0')) as id_por_chave
         from plataforma.frase_carga order by numero`,
    );
    return r.rows;
  }
  beforeAll(async () => {
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA } });
    await criarSuperAdmin(api.admin, SUPER);
    tokenSA = (await sessaoDoPortal(api, SUPER.email, SUPER.senha)).token;
    // admin do cliente da fixture (só A): entra direto, com a empresa escolhida
    tokenCli = (await sessaoDoPortal(api, 'admin@exemplo.com.br', SENHA)).token;
    app.vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    app.promotorA = (await api.sessao('promotor@exemplo.com.br', A)).access_token;
    app.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    app.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    app.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe('FC-01 seed das 30 iniciais = FRASES_CARGA_INICIAIS do SDK', () => {
    it('o banco tem as 30, vivas e ativas, Nº = ordem = 1..30, id = uuid_de_chave(plataforma:frase_carga:NN), mesmo texto do SDK', async () => {
      expect(FRASES_CARGA_INICIAIS).toHaveLength(30);
      const linhas = await noBanco();
      expect(linhas).toHaveLength(30);
      expect(linhas.filter((l) => !l.id_por_chave).map((l) => l.numero)).toEqual([]);
      expect(linhas.map(({ id, numero, texto, ativa, ordem }) => ({ id, numero, texto, ativa, ordem }))).toEqual(
        FRASES_CARGA_INICIAIS.map(({ id, numero, texto, ativa, ordem }) => ({ id, numero, texto, ativa, ordem })),
      );
      expect(linhas.every((l) => l.viva && l.ativa)).toBe(true);
      expect(linhas.filter((l) => Array.from(l.texto).length > FRASE_CARGA_MAX).map((l) => l.numero)).toEqual([]);
      // o Nº 1 do desenho (§1), calculado pelo banco
      const um = await api.admin.query<{ id: string }>("select plataforma.uuid_de_chave('plataforma:frase_carga:01')::text as id");
      expect(um.rows[0]!.id).toBe('30db8593-800a-56dc-98dc-b8976806ace5');
    });

    it('o portal (super-admin) lista as 30 iguais às do SDK; o app recebe as 30 pela ordem, com id, texto e ordem do SDK', async () => {
      const itens = await listaDoPortal();
      expect(itens).toEqual(FRASES_CARGA_INICIAIS.map((f) => FraseCargaSchema.parse(f)));
      expect(await doApp(app.vendedorA)).toEqual(FRASES_CARGA_INICIAIS.map(({ id, texto, ordem }) => ({ id, texto, ordem })));
    });
  });

  describe('FC-02 portal só do super-admin', () => {
    it('sem token = 401; token do app (tenant) = 401', async () => {
      expect((await portal(null, { method: 'GET' })).statusCode).toBe(401);
      expect((await portal(app.adminA, { method: 'GET' })).statusCode).toBe(401);
      expect((await incluir({ texto: 'Frase de quem não entrou no portal.' }, app.adminA)).statusCode).toBe(401);
    });

    it('admin do cliente = 403 PERFIL_SEM_ACESSO em GET, POST e PATCH, e nada muda no banco', async () => {
      const antes = await noBanco();
      const id = FRASES_CARGA_INICIAIS[0]!.id;
      for (const r of [
        await portal(tokenCli, { method: 'GET' }),
        await incluir({ id: crypto.randomUUID(), texto: 'Frase que o admin do cliente tentou incluir.' }, tokenCli),
        await editar(id, { ativa: false }, tokenCli),
        await editar(id, { texto: 'Texto que o admin do cliente tentou gravar.' }, tokenCli),
      ]) {
        expect(r.statusCode, r.body).toBe(403);
        expect(erroDe(r).codigo).toBe('PERFIL_SEM_ACESSO');
      }
      expect(await noBanco()).toEqual(antes);
    });

  });

  describe('FC-03 incluir (nasce ativa, Nº seguinte, idempotente pelo id)', () => {
    it('201 com trim: ativa, Nº 31 e ordem 31; o app passa a receber no fim', async () => {
      const r = await incluir({ id: criadas.nova, texto: `   ${NOVA}   ` });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(FraseCargaSchema.parse(r.json())).toEqual({ id: criadas.nova, numero: 31, texto: NOVA, ativa: true, ordem: 31 });
      const doVendedor = await doApp(app.vendedorA);
      expect(doVendedor).toHaveLength(31);
      expect(doVendedor.at(-1)).toEqual({ id: criadas.nova, texto: NOVA, ordem: 31 });
    });

    it('reenvio com o mesmo id e o mesmo texto (outra caixa) = 201 com a frase já gravada, sem linha nova', async () => {
      const r = await incluir({ id: criadas.nova, texto: NOVA.toUpperCase() });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json()).toEqual({ id: criadas.nova, numero: 31, texto: NOVA, ativa: true, ordem: 31 });
      expect(await noBanco()).toHaveLength(31);
    });

    it('o mesmo id com outro texto = 422 FRASE_DUPLICADA, sem linha nova', async () => {
      const r = await incluir({ id: criadas.nova, texto: 'Texto diferente com o id já usado.' });
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).codigo).toBe('FRASE_DUPLICADA');
      expect(await noBanco()).toHaveLength(31);
    });

    it('sem id no corpo, a API gera um UUID; Nº 32', async () => {
      const r = await incluir({ texto: SEM_ID });
      expect(r.statusCode, r.body).toBe(201);
      const f = FraseCargaSchema.parse(r.json());
      expect(f).toMatchObject({ numero: 32, ordem: 32, ativa: true, texto: SEM_ID });
      criadas.semId = f.id;
    });

    it('a auditoria registra sa.frase_carga.incluir com id e Nº (uma por frase nova, nenhuma no reenvio), nunca o texto', async () => {
      const linhas = await auditoriaDoPortal(api.admin);
      const inclusoes = linhas.filter((l) => l.acao === 'sa.frase_carga.incluir');
      expect(inclusoes.map((l) => l.detalhes)).toEqual([
        { frase_id: criadas.nova, numero: 31, origem: 'banco' },
        { frase_id: criadas.semId, numero: 32, origem: 'banco' },
      ]);
      expect(inclusoes.map((l) => [l.ator_tipo, l.super_admin_id !== null])).toEqual([['super_admin', true], ['super_admin', true]]);
      const vazou = linhas.filter((l) => textosDeTeste.some((t) => l.bruto.includes(t)) || FRASES_CARGA_INICIAIS.some((f) => l.bruto.includes(f.texto)));
      expect(vazou.map((l) => l.acao)).toEqual([]);
    });
  });

  describe('FC-04 regra do texto (até 90, sem vazia, sem repetida)', () => {
    it('vazia (só espaços) = 422 FRASE_VAZIA', async () => {
      const r = await incluir({ texto: '    ' });
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).codigo).toBe('FRASE_VAZIA');
    });

    it('exatamente 90 caracteres (com acento) = 201; 91 = 422 FRASE_LONGA', async () => {
      expect(Array.from(COM_90)).toHaveLength(FRASE_CARGA_MAX);
      const ok = await incluir({ texto: COM_90 });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(FraseCargaSchema.parse(ok.json()).texto).toBe(COM_90);
      const longa = await incluir({ texto: COM_91 });
      expect(longa.statusCode, longa.body).toBe(422);
      expect(erroDe(longa).codigo).toBe('FRASE_LONGA');
    });

    it('repetida sem diferenciar maiúsculas nem espaços nas pontas = 422 FRASE_DUPLICADA (pelo índice único do banco); nada novo', async () => {
      const antes = (await noBanco()).length;
      const r = await incluir({ id: crypto.randomUUID(), texto: `  ${FRASES_CARGA_INICIAIS[3]!.texto.toUpperCase()} ` });
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r)).toMatchObject({ codigo: 'FRASE_DUPLICADA', mensagem: 'Essa frase já está na lista.' });
      expect(await noBanco()).toHaveLength(antes);
    });
  });

  describe('FC-05 editar', () => {
    it('texto com trim: 200, Nº e ordem mantidos, continua ativa', async () => {
      const r = await editar(criadas.nova, { texto: `  ${NOVA_EDITADA}  ` });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ id: criadas.nova, numero: 31, texto: NOVA_EDITADA, ativa: true, ordem: 31 });
      expect((await doApp(app.vendedorA)).find((f) => f.id === criadas.nova)?.texto).toBe(NOVA_EDITADA);
    });

    it('a própria frase com outra caixa passa (a própria não conta como repetida)', async () => {
      const r = await editar(criadas.nova, { texto: NOVA_EDITADA.toUpperCase() });
      expect(r.statusCode, r.body).toBe(200);
      const volta = await editar(criadas.nova, { texto: NOVA_EDITADA });
      expect(volta.statusCode, volta.body).toBe(200);
    });

    it('texto de outra frase = 422 FRASE_DUPLICADA; vazio = 422 FRASE_VAZIA; 91 = 422 FRASE_LONGA; corpo vazio = 400; nada muda', async () => {
      const antes = await noBanco();
      const dup = await editar(criadas.nova, { texto: FRASES_CARGA_INICIAIS[5]!.texto.toLowerCase() });
      expect(dup.statusCode, dup.body).toBe(422);
      expect(erroDe(dup).codigo).toBe('FRASE_DUPLICADA');
      const vazia = await editar(criadas.nova, { texto: '   ' });
      expect(vazia.statusCode, vazia.body).toBe(422);
      expect(erroDe(vazia).codigo).toBe('FRASE_VAZIA');
      const longa = await editar(criadas.nova, { texto: COM_91 });
      expect(longa.statusCode, longa.body).toBe(422);
      expect(erroDe(longa).codigo).toBe('FRASE_LONGA');
      expect((await editar(criadas.nova, {})).statusCode).toBe(400);
      expect((await editar(criadas.nova, { ativa: false, campo: 'a mais' })).statusCode).toBe(400);
      expect(await noBanco()).toEqual(antes);
    });

    it('id inexistente = 404 FRASE_NAO_ENCONTRADA; id fora de UUID = 400', async () => {
      const r = await editar(crypto.randomUUID(), { ativa: true });
      expect(r.statusCode, r.body).toBe(404);
      expect(erroDe(r).codigo).toBe('FRASE_NAO_ENCONTRADA');
      expect((await editar('nao-e-uuid', { ativa: true })).statusCode).toBe(400);
    });

    it('a auditoria registra sa.frase_carga.editar com texto_mudou, sem o texto', async () => {
      const edicoes = (await auditoriaDoPortal(api.admin)).filter((l) => l.acao === 'sa.frase_carga.editar');
      expect(edicoes.length).toBeGreaterThanOrEqual(3);
      expect(edicoes[0]!.detalhes).toEqual({ frase_id: criadas.nova, numero: 31, texto_mudou: true, ativa: true, origem: 'banco' });
      expect(edicoes.filter((l) => textosDeTeste.some((t) => l.bruto.includes(t) || l.bruto.includes(t.toUpperCase())))).toEqual([]);
    });
  });

  describe('FC-06 ativar e desativar (sem apagar)', () => {
    const n1 = FRASES_CARGA_INICIAIS[0]!;

    it('desativar a Nº 1: 200 ativa=false, texto igual; sai do app; vai para o fim da lista do portal', async () => {
      const r = await editar(n1.id, { ativa: false });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ ...n1, ativa: false });
      const doApp1 = await doApp(app.vendedorA);
      expect(doApp1.map((f) => f.id)).not.toContain(n1.id);
      expect(doApp1.map((f) => f.ordem)).toEqual([...doApp1.map((f) => f.ordem)].sort((a, b) => a - b));
      const itens = await listaDoPortal();
      expect(itens.at(-1)).toEqual({ ...n1, ativa: false });
      expect(itens.slice(0, -1).every((f) => f.ativa)).toBe(true);
      expect(itens.slice(0, -1).map((f) => f.numero)).toEqual([...itens.slice(0, -1).map((f) => f.numero)].sort((a, b) => a - b));
    });

    it('reativar a Nº 1: volta ao app na 1ª posição e ao seu lugar no portal', async () => {
      const r = await editar(n1.id, { ativa: true });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual(n1);
      expect((await doApp(app.vendedorA))[0]).toEqual({ id: n1.id, texto: n1.texto, ordem: 1 });
      expect((await listaDoPortal())[0]).toEqual(n1);
    });

    it('frase apagada no banco (deleted_at) some do app e do portal e não se edita (404)', async () => {
      const n2 = FRASES_CARGA_INICIAIS[1]!;
      await api.admin.query('update plataforma.frase_carga set deleted_at = now() where id = $1', [n2.id]);
      try {
        expect((await doApp(app.vendedorA)).map((f) => f.id)).not.toContain(n2.id);
        expect((await listaDoPortal()).map((f) => f.id)).not.toContain(n2.id);
        const r = await editar(n2.id, { ativa: true });
        expect(r.statusCode, r.body).toBe(404);
      } finally {
        await api.admin.query('update plataforma.frase_carga set deleted_at = null where id = $1', [n2.id]);
      }
    });
  });

  describe('FC-07 sem exclusão', () => {
    it('DELETE na rota = 404 e a frase continua lá', async () => {
      const id = FRASES_CARGA_INICIAIS[2]!.id;
      expect((await portal(tokenSA, { method: 'DELETE', url: `${ROTA_PORTAL_FRASES_CARGA}/${id}` })).statusCode).toBe(404);
      expect((await portal(tokenSA, { method: 'DELETE' })).statusCode).toBe(404);
      expect((await noBanco()).find((l) => l.id === id)).toMatchObject({ viva: true, ativa: true });
    });

  });

  describe('FC-08 /v1/sync/frases-carga (app, qualquer perfil, sem licença de módulo)', () => {
    it('sem sessão = 401; token do portal = 401', async () => {
      expect((await api.chamar(null, { method: 'GET', url: ROTA_SYNC_FRASES_CARGA })).statusCode).toBe(401);
      expect((await api.chamar(tokenSA, { method: 'GET', url: ROTA_SYNC_FRASES_CARGA })).statusCode).toBe(401);
    });

    it('vendedor, promotor e admin de A e de B recebem a mesma lista: as ativas e vivas do banco, pela ordem', async () => {
      await editar(FRASES_CARGA_INICIAIS[4]!.id, { ativa: false });
      try {
        const esperado = (await noBanco())
          .filter((l) => l.ativa && l.viva)
          .sort((a, b) => a.ordem - b.ordem || a.numero - b.numero)
          .map(({ id, texto, ordem }) => ({ id, texto, ordem }));
        expect(esperado.map((f) => f.id)).not.toContain(FRASES_CARGA_INICIAIS[4]!.id);
        for (const [quem, token] of Object.entries(app)) {
          expect(await doApp(token), quem).toEqual(esperado);
        }
      } finally {
        await editar(FRASES_CARGA_INICIAIS[4]!.id, { ativa: true });
      }
    });

    it('módulo do perfil desligado no tenant (vendedor em A): a rota continua 200 (é da plataforma, não do módulo)', async () => {
      const desl = await licenca(api, app.adminA, 'tenant', 'vendedor', false);
      expect(desl.statusCode, desl.body).toBeLessThan(300);
      try {
        expect((await doApp(app.vendedorA)).length).toBeGreaterThanOrEqual(30);
      } finally {
        const liga = await licenca(api, app.adminA, 'tenant', 'vendedor', true);
        expect(liga.statusCode, liga.body).toBeLessThan(300);
      }
    });
  });
});
