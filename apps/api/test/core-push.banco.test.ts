/**
 * Despachante REAL × consumidor do Core para `core.notificacao.criada@1` (T-0022; T-0019 critério 3; RF-CORE-09;
 * ADR 0007). Usa o `moduloApi` do Core como o worker o monta (`MODULOS_API`), mas só ele no despachante: os outros
 * consumidores instalados reagiriam a eventos que os outros arquivos de teste gravam na mesma outbox.
 *  - `MACUXI_PUSH_ATIVO` ausente: o evento é consumido uma vez (registro em `evento_consumo`, `publicado_em`), nada
 *    sai para a rede e `push_enviado_em` fica nulo; reabrir o evento não roda o handler de novo;
 *  - ligado, com `fetch` falso: um envio só ao token do aparelho; reentrega (evento reaberto) não repete; e mesmo sem
 *    o registro de consumo (reprocessamento manual) `push_enviado_em` segura o reenvio.
 * O aparelho com token é criado aqui (outro usuário que não o vendedor1, cujo aparelho os testes de bloqueio mexem).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { moduloApi as core } from '@macuxi/core/api';
import { EVENTO_NOTIFICACAO_CRIADA } from '@macuxi/core/contracts';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarBancoApp, type BancoApp } from '../src/banco';
import { criarDespachante } from '../src/despachante';
import { MODULOS_API } from '../src/modulos';
import { publicadorTenant } from '../src/outbox';

const A = DOIS_TENANTS.A.tenantId;
const USUARIO = DOIS_TENANTS.A.usuarios.supervisor;
const DISPOSITIVO = randomUUID();
const TOKEN = `ExponentPushToken[t0022-${DISPOSITIVO}]`;
const TITULO = `Aviso T-0022 ${DISPOSITIVO}`;
const NOME = EVENTO_NOTIFICACAO_CRIADA.nome;

describe('worker monta o consumidor do Core', () => {
  it('MODULOS_API leva o moduloApi do Core com o consumidor de core.notificacao.criada@1', () => {
    const doCore = MODULOS_API.find((m) => m.manifesto.id === 'core');
    expect(doCore).toBe(core);
    expect(doCore?.consumidores?.map((c) => c.evento.nome)).toContain(NOME);
  });
});

describe.skipIf(semBanco())('despachante real × push de core.notificacao.criada@1 (T-0022, ADR 0007)', () => {
  let poolWorker: pg.Pool;
  let poolApp: pg.Pool;
  let admin: pg.Client;
  let app: BancoApp;
  const notificacoes: string[] = [];
  const fetchFalso = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"data":[]}', { status: 200 }));

  const despachante = () => criarDespachante({ worker: poolWorker, app, modulos: [core] });
  const ate = async (d: ReturnType<typeof despachante>) => {
    for (let i = 0; i < 10; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };

  /** Notificação + evento na mesma transação, com a validação do barramento (publica do manifesto, schema). */
  const notificar = async () => {
    const id = randomUUID();
    notificacoes.push(id);
    let eventoId = '';
    await app.comTenant(A, async (db) => {
      await db.query(
        `insert into core.notificacao (id, tenant_id, usuario_id, tipo, titulo, corpo, origem_modulo, prioridade)
         values ($1, plataforma.tenant_atual(), $2, 'recado', $3, 'Corpo do aviso', 'core', 'alta')`,
        [id, USUARIO, TITULO],
      );
      const publicar = publicadorTenant(db, { manifestos: [core.manifesto], modulo: 'core', tenantId: A, usuarioId: null, requestId: 'teste-core-push', agora: () => new Date() });
      eventoId = (await publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: id, usuario_id: USUARIO, tipo: 'recado', prioridade: 'alta' }, id)).evento_id;
    });
    return { id, eventoId };
  };

  const evento = async (id: string) => (await admin.query<{ publicado_em: Date | null; tentativas: number }>('select publicado_em, tentativas from plataforma.evento where id = $1', [id])).rows[0]!;
  const consumos = async (id: string) => (await admin.query<{ consumidor: string }>('select consumidor from plataforma.evento_consumo where evento_id = $1', [id])).rows;
  const enviadoEm = async (id: string) => (await admin.query<{ push_enviado_em: Date | null }>('select push_enviado_em from core.notificacao where id = $1', [id])).rows[0]!.push_enviado_em;
  const reabrir = (eventoId: string) => admin.query('update plataforma.evento set publicado_em = null where id = $1', [eventoId]);
  /** Envios ao Expo que levam a notificação deste arquivo (outros arquivos podem ter eventos pendentes do mesmo nome). */
  const envios = () =>
    fetchFalso.mock.calls.filter(([, init]) => {
      const corpo = JSON.parse(String(init?.body ?? '[]')) as { to: string; title: string }[];
      return corpo.some((m) => m.to === TOKEN && m.title === TITULO);
    });

  beforeAll(async () => {
    const urlWorker = banco().urlWorker;
    if (!urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA)');
    poolWorker = new pg.Pool({ connectionString: urlWorker, max: 2 });
    poolApp = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    app = criarBancoApp(poolApp);
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    await app.comTenant(A, (db) =>
      db.query(
        `insert into core.dispositivo (id, tenant_id, usuario_id, nome, plataforma, push_token, push_plataforma)
         values ($1, plataforma.tenant_atual(), $2, 'aparelho T-0022', 'android', $3, 'android')`,
        [DISPOSITIVO, USUARIO, TOKEN],
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchFalso.mockClear();
  });
  afterAll(async () => {
    await admin?.query('delete from core.notificacao where id = any($1::uuid[])', [notificacoes]).catch(() => undefined);
    await admin?.query('delete from core.dispositivo where id = $1', [DISPOSITIVO]).catch(() => undefined);
    await admin?.end();
    await poolWorker?.end();
    await poolApp?.end();
  });

  it('MACUXI_PUSH_ATIVO ausente: consome uma vez, nada sai para a rede e reabrir não repete', async () => {
    vi.stubEnv('MACUXI_PUSH_ATIVO', undefined);
    vi.stubGlobal('fetch', fetchFalso);
    const { id, eventoId } = await notificar();

    await ate(despachante());
    expect(await consumos(eventoId)).toEqual([{ consumidor: 'core' }]);
    expect(await evento(eventoId)).toMatchObject({ publicado_em: expect.any(Date), tentativas: 1 });
    expect(await enviadoEm(id)).toBeNull();

    await reabrir(eventoId);
    await ate(despachante());
    expect(await consumos(eventoId)).toEqual([{ consumidor: 'core' }]);
    expect((await evento(eventoId)).publicado_em).not.toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('MACUXI_PUSH_ATIVO=1 com fetch falso: um envio só, reentrega não repete e push_enviado_em segura o reenvio', async () => {
    vi.stubEnv('MACUXI_PUSH_ATIVO', '1');
    vi.stubGlobal('fetch', fetchFalso);
    const { id, eventoId } = await notificar();

    await ate(despachante());
    expect(envios()).toHaveLength(1);
    const [url, init] = envios()[0]!;
    expect(String(url)).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(String(init?.body))).toEqual([{ to: TOKEN, title: TITULO, body: 'Corpo do aviso', priority: 'high', data: { link: null } }]);
    expect(await enviadoEm(id)).toEqual(expect.any(Date));
    expect(await consumos(eventoId)).toEqual([{ consumidor: 'core' }]);
    expect((await evento(eventoId)).publicado_em).not.toBeNull();

    // reentrega: o registro de consumo impede o handler de rodar de novo
    await reabrir(eventoId);
    await ate(despachante());
    expect(envios()).toHaveLength(1);

    // sem o registro de consumo (apagado pelo administrador para reprocessar): o handler roda e push_enviado_em segura
    await admin.query('delete from plataforma.evento_consumo where evento_id = $1', [eventoId]);
    await reabrir(eventoId);
    await ate(despachante());
    expect(await consumos(eventoId)).toEqual([{ consumidor: 'core' }]);
    expect(envios()).toHaveLength(1);
  });
});
