/**
 * Rodapé legal (docs/design/telas/rodape-legal.md §3.4) sem banco real: rota pública (cache, limite por IP, 503 com o banco fora,
 * sem ETag) e rotas do portal (só super-admin, contrato do SDK na entrada e na saída, auditoria da requisição). As funções do
 * banco de verdade são testadas no CI pelo banco-dados. Dados fictícios.
 */
import { SITE_PADRAO, type AcessoPortalAutenticado, type DadosLegais, type GravarDadosLegais } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { LIMITE_DADOS_LEGAIS_POR_MIN, type FonteDadosLegais } from '../src/dados-legais';
import { fontePlataformaNoBanco, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: '0a000000-0000-4000-8000-000000000001', usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const URL_PUBLICA = '/v1/publico/dados-legais';
const URL_PORTAL = '/v1/plataforma/dados-legais';
const sa = { 'x-quem': 'sa' };
const DADOS: DadosLegais = { razao_social: 'Empresa Exemplo Ltda', cnpj: '11222333000181', site: 'exemplo.com.br' };

function montar(op: { semBanco?: boolean; erroPublico?: string; erroPortal?: string; formatoErrado?: boolean } = {}) {
  let instante = Date.parse('2026-11-15T12:00:00.000Z');
  let atual: DadosLegais = { razao_social: null, cnpj: null, site: SITE_PADRAO };
  const chamadas = { publicos: 0, ler: 0, gravados: [] as GravarDadosLegais[] };
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const fonte: FonteDadosLegais = {
    publicos: async () => {
      chamadas.publicos++;
      if (op.erroPublico) throw Object.assign(new Error('pg'), { code: op.erroPublico });
      return op.formatoErrado ? { razao_social: '', cnpj: 'x' } : atual;
    },
    ler: async (sid) => {
      expect(sid).toBe(SA.sessao_id);
      chamadas.ler++;
      if (op.erroPortal) throw Object.assign(new Error('pg'), { code: op.erroPortal });
      return atual;
    },
    gravar: async (sid, dados) => {
      expect(sid).toBe(SA.sessao_id);
      if (op.erroPortal) throw Object.assign(new Error('pg'), { code: op.erroPortal });
      chamadas.gravados.push(dados);
      atual = dados;
      return atual;
    },
  };
  const app = createApp(
    opcoesDeTeste(undefined, {
      ...(op.semBanco ? {} : { banco: bancoFalso().banco }),
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma: { ...fontePlataformaNoBanco, auditar: async (l) => void auditoria.push(l) },
      fonteDadosLegais: fonte,
      relogio: () => new Date(instante),
    }),
  );
  return { app, chamadas, auditoria, avancar: (ms: number) => void (instante += ms), definir: (d: DadosLegais) => void (atual = d) };
}

describe('GET /v1/publico/dados-legais (rodapé legal, sem login)', () => {
  it('200 com o contrato, Cache-Control público exato e sem ETag', async () => {
    const { app, definir } = montar();
    definir(DADOS);
    const r = await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(DADOS);
    expect(r.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=86400');
    expect(r.headers.etag).toBeUndefined();
  });

  it('cache de 60 s: a 2ª chamada não vai ao banco; depois de 60 s, vai', async () => {
    const { app, chamadas, avancar } = montar();
    await app.inject({ method: 'GET', url: URL_PUBLICA });
    avancar(59_999);
    await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect(chamadas.publicos).toBe(1);
    avancar(1);
    await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect(chamadas.publicos).toBe(2);
  });

  it('chamadas simultâneas usam a mesma consulta', async () => {
    const { app, chamadas } = montar();
    const rs = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: URL_PUBLICA })));
    expect(rs.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(chamadas.publicos).toBe(1);
  });

  it('sem banco = 503 DADOS_LEGAIS_INDISPONIVEIS com no-store', async () => {
    const { app, chamadas } = montar({ semBanco: true });
    const r = await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect([r.statusCode, r.json().codigo, r.headers['cache-control']]).toEqual([503, 'DADOS_LEGAIS_INDISPONIVEIS', 'no-store']);
    expect(chamadas.publicos).toBe(0);
  });

  it('erro do banco (inclusive a função ainda não existir) = 503 e a falha não fica no cache', async () => {
    for (const code of ['42883', '08006']) {
      const { app, chamadas } = montar({ erroPublico: code });
      const r = await app.inject({ method: 'GET', url: URL_PUBLICA });
      expect([r.statusCode, r.json().codigo, r.headers['cache-control']]).toEqual([503, 'DADOS_LEGAIS_INDISPONIVEIS', 'no-store']);
      await app.inject({ method: 'GET', url: URL_PUBLICA });
      expect(chamadas.publicos).toBe(2);
    }
  });

  it('formato diferente do contrato = 500', async () => {
    const { app } = montar({ formatoErrado: true });
    const r = await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect(r.statusCode).toBe(500);
  });

  it(`limite por IP: passou de ${LIMITE_DADOS_LEGAIS_POR_MIN}/min = 429 com Retry-After`, async () => {
    const { app } = montar();
    for (let i = 0; i < LIMITE_DADOS_LEGAIS_POR_MIN; i++) expect((await app.inject({ method: 'GET', url: URL_PUBLICA })).statusCode).toBe(200);
    const r = await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect([r.statusCode, r.json().codigo]).toEqual([429, 'MUITAS_TENTATIVAS']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.json().detalhes).toEqual({ retry_after_s: Number(r.headers['retry-after']) });
  });
});

describe('GET e PUT /v1/plataforma/dados-legais (portal, só super-admin)', () => {
  it('sem sessão = 401; admin do cliente = 403 (auditado), também no PUT', async () => {
    const { app, auditoria, chamadas } = montar();
    expect((await app.inject({ method: 'GET', url: URL_PORTAL })).statusCode).toBe(401);
    const cli = await app.inject({ method: 'GET', url: URL_PORTAL, headers: { 'x-quem': 'cli' } });
    expect([cli.statusCode, cli.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'admin_cliente', status: 403 });
    const put = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: { 'x-quem': 'cli' }, payload: { razao_social: null, cnpj: null, site: null } });
    expect(put.statusCode).toBe(403);
    // a autenticação vem antes da validação do corpo
    expect((await app.inject({ method: 'PUT', url: URL_PORTAL, payload: { lixo: 1 } })).statusCode).toBe(401);
    expect(chamadas.gravados).toEqual([]);
  });

  it('GET: contrato do SDK e auditoria da requisição', async () => {
    const { app, auditoria, definir } = montar();
    definir(DADOS);
    const r = await app.inject({ method: 'GET', url: URL_PORTAL, headers: sa });
    expect([r.statusCode, r.json()]).toEqual([200, DADOS]);
    expect(auditoria).toMatchObject([{ ator_tipo: 'super_admin', acao: 'sa.requisicao', rota: URL_PORTAL, status: 200 }]);
  });

  it('PUT: 400 com o caminho do campo (CNPJ com dígito errado, site inválido)', async () => {
    const { app, chamadas } = montar();
    const cnpj = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: 'Empresa Exemplo Ltda', cnpj: '11.222.333/0001-82', site: null } });
    expect([cnpj.statusCode, cnpj.json().codigo]).toEqual([400, 'VALIDACAO']);
    expect(cnpj.json().detalhes.problemas).toEqual([{ caminho: 'corpo.cnpj', mensagem: 'CNPJ inválido. Confira os 14 dígitos.' }]);
    const site = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: null, cnpj: null, site: 'exemplo.com.br/contato' } });
    expect(site.statusCode).toBe(400);
    expect(site.json().detalhes.problemas).toEqual([{ caminho: 'corpo.site', mensagem: 'Use só o endereço, ex.: macuxifdv.com.br.' }]);
    expect(chamadas.gravados).toEqual([]);
  });

  it('PUT normaliza o site e o CNPJ; vazio vira o padrão; auditoria da requisição', async () => {
    const { app, chamadas, auditoria } = montar();
    const r = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: ' Empresa Exemplo Ltda ', cnpj: '11.222.333/0001-81', site: 'https://www.Exemplo.com.br/' } });
    expect([r.statusCode, r.json()]).toEqual([200, DADOS]);
    const vazio = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: '', cnpj: '', site: '' } });
    expect(vazio.json()).toEqual({ razao_social: null, cnpj: null, site: SITE_PADRAO });
    expect(chamadas.gravados).toEqual([DADOS, { razao_social: null, cnpj: null, site: SITE_PADRAO }]);
    expect(auditoria.map((a) => [a.ator_tipo, a.rota, a.status])).toEqual([
      ['super_admin', URL_PORTAL, 200],
      ['super_admin', URL_PORTAL, 200],
    ]);
  });

  it('PUT limpa o cache da rota pública', async () => {
    const { app, chamadas } = montar();
    expect((await app.inject({ method: 'GET', url: URL_PUBLICA })).json().cnpj).toBeNull();
    await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: 'Empresa Exemplo Ltda', cnpj: '11222333000181', site: 'exemplo.com.br' } });
    const depois = await app.inject({ method: 'GET', url: URL_PUBLICA });
    expect(depois.json()).toEqual(DADOS);
    expect(chamadas.publicos).toBe(2);
  });

  it('SQLSTATE vira HTTP: 28000 = 401, 42501 = 403, 22023/23514 = 400, 42883 = 503', async () => {
    const casos = [
      ['28000', 401, 'NAO_AUTENTICADO'],
      ['42501', 403, 'PERFIL_SEM_ACESSO'],
      ['22023', 400, 'VALIDACAO'],
      ['23514', 400, 'VALIDACAO'],
      ['42883', 503, 'DADOS_LEGAIS_INDISPONIVEIS'],
    ] as const;
    for (const [code, status, codigo] of casos) {
      const { app } = montar({ erroPortal: code });
      const g = await app.inject({ method: 'GET', url: URL_PORTAL, headers: sa });
      const p = await app.inject({ method: 'PUT', url: URL_PORTAL, headers: sa, payload: { razao_social: null, cnpj: null, site: null } });
      expect([g.statusCode, g.json().codigo, p.statusCode, p.json().codigo]).toEqual([status, codigo, status, codigo]);
    }
  });

  it('sem o banco do portal = 503 PORTAL_INDISPONIVEL', async () => {
    const app = createApp(opcoesDeTeste(undefined, { banco: bancoFalso().banco, autenticarPortal: async () => SA }));
    const r = await app.inject({ method: 'GET', url: URL_PORTAL, headers: sa });
    expect([r.statusCode, r.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
  });
});
