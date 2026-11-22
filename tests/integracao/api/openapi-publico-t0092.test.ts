/**
 * T-0092 — `GET /integracao/v1/openapi.json` público, na API REAL (`createApp`) montada com os 8 módulos REAIS de
 * `MODULOS_API` (o módulo Integração com a rota pública que ele mesmo declara, não uma rota de fixture). SEM BANCO (roda
 * local): `banco: null` prova de passagem que o documento não depende de dado nenhum, nem de tenant. Matriz: docs/testes/T-0092.md.
 *
 * Cobre o que os testes do dono não cobrem (apps/api/test/rota-publica-documento.test.ts usa um documento de fixture; o
 * modules/integracao/api/openapi/publico.test.ts chama o `executar` direto, sem a API):
 * - critério 1: sem token e sem licença, o corpo servido é byte a byte o documento que o módulo exporta
 *   (`documentoOpenApiPublico()`) e o gerado na hora dos contratos (`gerarOpenApiHub()`, sem memo). O arquivo versionado não
 *   é lido aqui (R4 do scripts/ci/grafo-turbo.mjs: tests/ não lê caminho sob a pasta de docs); que ele é idêntico ao gerado
 *   prova o modules/integracao/api/openapi/openapi.test.ts, do dono. Cache-Control de 1 h, ETag e 304; o limite REAL declarado (60/min por IP) → 429 MUITAS_TENTATIVAS;
 *   só as 7 rotas do Hub (`ROTAS_HUB`), nenhuma rota do BKO, nenhum tenant e nenhuma chave de API real;
 * - a rota autenticada `/v1/integracao/openapi` (T-0087) saiu: 404 mesmo para o admin com a Integração licenciada (controle:
 *   `/v1/integracao/monitor`, da mesma ação `monitor.ver`, continua montada);
 * - a rota pública não abre nem afrouxa as rotas do Conector no mesmo prefixo.
 */
import { documentoOpenApiPublico, gerarOpenApiHub } from '@macuxi/integracao/api';
import { ROTAS_HUB } from '@macuxi/integracao/contracts';
import type { ModuloId, Perfil, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { etagDoCorpo } from '../../../apps/api/src/cache-publico';
import { MODULOS_API } from '../../../apps/api/src/modulos';

const URL_DOC = '/integracao/v1/openapi.json';
/** O documento como o módulo o exporta; o gerado na hora (sem memo) é conferido igual no primeiro caso. */
const ARQUIVO = documentoOpenApiPublico();
const GERADO_NA_HORA = `${JSON.stringify(gerarOpenApiHub(), null, 2)}\n`;
const TENANT = '0a000000-0000-4000-8000-0000000000a1';
const USUARIOS: Record<string, UsuarioAutenticado> = {
  admin: { id: '0b000000-0000-4000-8000-0000000000a1', tenant_id: TENANT, perfil: 'admin' },
  analista: { id: '0b000000-0000-4000-8000-0000000000a2', tenant_id: TENANT, perfil: 'analista' },
};
let ipSeq = 0;
/** Cada caso usa IP próprio: o limitador é por IP e por app; assim um caso não consome a janela do outro. */
const novoIp = () => `10.92.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

/** A API real com os módulos reais; o tenant tem (ou não) a Integração; sem banco. */
function subir(o: { integracaoNoTenant: boolean }) {
  const doTenant: ModuloId[] = o.integracaoNoTenant ? ['core', 'integracao'] : ['core'];
  return createApp({
    modulos: MODULOS_API,
    banco: null,
    bancoPortal: null,
    logger: false,
    autenticar: async (h) => USUARIOS[String(h['x-teste-usuario'] ?? '')] ?? null,
    licencas: async (u) => ({ ativosNoTenant: doTenant, doPerfil: (['admin', 'analista'] as Perfil[]).includes(u.perfil) ? doTenant : ['core'], removidosDoUsuario: [], parametros: {} }),
  });
}

describe('T-0092 critério 1 — GET /integracao/v1/openapi.json público na API montada com o módulo real', () => {
  it('a Integração declara a rota pública e o createApp a monta no prefixo do Hub (não no /v1 autenticado)', async () => {
    const integracao = MODULOS_API.find((m) => m.manifesto.id === 'integracao');
    // v1.0.21: o guia em PDF (`GET guia.pdf`) também é público; nenhuma outra rota pública
    const publicas = integracao?.rotasPublicas?.map((r) => `${r.metodo} ${r.caminho}`) ?? [];
    expect(publicas).toContain('GET openapi.json');
    expect(publicas.every((p) => ['GET openapi.json', 'GET guia.pdf'].includes(p)), publicas.join(', ')).toBe(true);
    const app = subir({ integracaoNoTenant: false });
    expect((await app.inject({ method: 'GET', url: '/v1/integracao/openapi.json', remoteAddress: novoIp() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/openapi.json', remoteAddress: novoIp() })).statusCode).toBe(404);
    await app.close();
  });

  it('sem token, sem licença da Integração e sem banco: 200 com o documento do módulo, byte a byte igual ao gerado dos contratos', async () => {
    const app = subir({ integracaoNoTenant: false });
    const r = await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: novoIp() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toBe(ARQUIVO);
    expect(r.body).toBe(GERADO_NA_HORA);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const doc = r.json() as { openapi: string; info: { version: string } };
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.info.version).toBeTruthy();
    await app.close();
  });

  it('token inválido, cookie ou cabeçalho de tenant não mudam nada: a rota não autentica nem lê o tenant', async () => {
    const app = subir({ integracaoNoTenant: true });
    const ip = novoIp();
    const limpo = await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: ip });
    for (const headers of [{ authorization: 'Bearer invalido' }, { 'x-teste-usuario': 'admin' }, { cookie: 'sessao=x', 'x-macuxi-tenant': TENANT }]) {
      const r = await app.inject({ method: 'GET', url: URL_DOC, headers, remoteAddress: ip });
      expect([r.statusCode, r.body, r.headers.etag], JSON.stringify(headers)).toEqual([200, limpo.body, limpo.headers.etag]);
    }
    await app.close();
  });

  it('cache: public, max-age=3600 e ETag do corpo, estável entre chamadas e entre instâncias da API; If-None-Match → 304 sem corpo', async () => {
    const app = subir({ integracaoNoTenant: false });
    const ip = novoIp();
    const r = await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: ip });
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    expect(r.headers.etag).toBe(etagDoCorpo(ARQUIVO));
    const outraInstancia = subir({ integracaoNoTenant: true });
    expect((await outraInstancia.inject({ method: 'GET', url: URL_DOC, remoteAddress: novoIp() })).headers.etag).toBe(r.headers.etag);
    await outraInstancia.close();
    const r304 = await app.inject({ method: 'GET', url: URL_DOC, headers: { 'if-none-match': r.headers.etag as string }, remoteAddress: ip });
    expect([r304.statusCode, r304.body, r304.headers.etag, r304.headers['cache-control']]).toEqual([304, '', r.headers.etag, 'public, max-age=3600']);
    // ETag velho (documento de outra versão) baixa de novo
    const velho = await app.inject({ method: 'GET', url: URL_DOC, headers: { 'if-none-match': '"0000000000000000000000000000dead"' }, remoteAddress: ip });
    expect([velho.statusCode, velho.body]).toEqual([200, ARQUIVO]);
    await app.close();
  });

  it('limite real da rota: 60 por minuto por IP (304 conta); a 61ª = 429 MUITAS_TENTATIVAS com Retry-After; outro IP segue', async () => {
    const app = subir({ integracaoNoTenant: false });
    const ip = novoIp();
    const etag = etagDoCorpo(ARQUIVO);
    const status: number[] = [];
    for (let i = 0; i < 60; i++) status.push((await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: ip, ...(i % 2 ? { headers: { 'if-none-match': etag } } : {}) })).statusCode);
    expect(new Set(status)).toEqual(new Set([200, 304]));
    const r = await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: ip });
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS', mensagem: expect.any(String) });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    // o 429 não traz o documento nem o cache público
    expect(r.body).not.toContain('"openapi"');
    expect(r.headers['cache-control']).not.toBe('public, max-age=3600');
    expect((await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: novoIp() })).statusCode).toBe(200);
    await app.close();
  });

  it('só a especificação: as 7 rotas de ROTAS_HUB em /integracao/v1, nenhuma rota do BKO/portal, nenhum tenant, nenhuma chave real', async () => {
    const app = subir({ integracaoNoTenant: false });
    const r = await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: novoIp() });
    const doc = r.json() as { paths: Record<string, Record<string, unknown>>; servers: { url: string }[] };
    expect(Object.keys(doc.paths).sort()).toEqual([...new Set(ROTAS_HUB.map((h) => h.caminho))].sort());
    for (const h of ROTAS_HUB) expect(doc.paths[h.caminho]?.[h.metodo.toLowerCase()], `${h.metodo} ${h.caminho}`).toBeDefined();
    expect(doc.servers.map((s) => s.url)).toEqual(['https://{servidor}/integracao/v1']);
    expect(r.body).not.toMatch(/\/v1\/integracao\//);
    expect(r.body).not.toMatch(/\/v1\/plataforma\//);
    expect(r.body).not.toMatch(/tenant_id/i);
    expect(r.body).not.toContain(TENANT);
    // chave do Conector real = `mxc_` + 43 caracteres base64url (modules/integracao/api/chave.ts); nenhuma no documento
    expect(r.body).not.toMatch(/mx[ck]_[A-Za-z0-9_-]{20,}/);
    // nenhum e-mail fora dos domínios reservados para exemplo (RFC 2606) nem CNPJ formatado: exemplos sem dado real
    const emails = r.body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(emails.filter((e) => !/@example\.(com|org|net)$/i.test(e))).toEqual([]);
    expect(r.body).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    await app.close();
  });

  it('só GET: POST/PUT/DELETE no documento não existem (nada é gravado por esta rota)', async () => {
    const app = subir({ integracaoNoTenant: false });
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const r = await app.inject({ method, url: URL_DOC, remoteAddress: novoIp(), payload: {} });
      expect(r.statusCode, method).toBe(404);
    }
    await app.close();
  });
});

describe('T-0092 — a rota autenticada do T-0087 saiu; as rotas do Conector no mesmo prefixo seguem fechadas', () => {
  it('GET /v1/integracao/openapi = 404 até para admin e analista com a Integração; o /monitor (mesma ação) segue montado', async () => {
    const app = subir({ integracaoNoTenant: true });
    for (const quem of ['admin', 'analista']) {
      const r = await app.inject({ method: 'GET', url: '/v1/integracao/openapi', headers: { 'x-teste-usuario': quem }, remoteAddress: novoIp() });
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(404);
      // controle: a rota irmã existe e passa perfil e licença (sem banco = 503, nunca 404/401/403)
      const monitor = await app.inject({ method: 'GET', url: '/v1/integracao/monitor', headers: { 'x-teste-usuario': quem }, remoteAddress: novoIp() });
      expect(monitor.statusCode, `${quem} /monitor: ${monitor.body}`).toBe(503);
    }
    await app.close();
  });

  it('rotas do Conector em /integracao/v1 continuam exigindo a chave: sem chave nunca 2xx, e nunca devolvem o documento', async () => {
    const app = subir({ integracaoNoTenant: true });
    for (const h of ROTAS_HUB) {
      const url = `/integracao/v1${h.caminho.replace('{id}', '0e000000-0000-4000-8000-000000000001').replace('{entidade}', 'cliente').replace('{pedido_uuid}', '0e000000-0000-4000-8000-000000000002')}`;
      const r = await app.inject({ method: h.metodo, url, remoteAddress: novoIp(), ...(h.metodo === 'POST' ? { payload: {} } : {}) });
      expect(r.statusCode, `${h.metodo} ${url}: ${r.body}`).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, `${h.metodo} ${url}`).not.toBe(404);
      expect(r.body).not.toContain('"openapi"');
    }
    await app.close();
  });
});
