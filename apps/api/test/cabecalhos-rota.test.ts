/**
 * v1.0.16: `semCache` e `cabecalhos` da rota de módulo. A API põe os cabeçalhos na resposta de sucesso e nas de erro da rota
 * (401, 403, 400, 422, 404 do módulo, 413 e 500), antes de qualquer conferência. Aditivo: rota sem os campos não ganha cabeçalho.
 * Primeiro uso: `GET /v1/core/clientes/:id/carteira` com `Cache-Control: no-store` (S3, modulo-core).
 */
import { CACHE_CONTROL_SEM_CACHE, definirModuloApi, ErroRegraNegocio, type ModuloApi, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cab, CLIENTE_DA_CARTEIRA, CLIENTE_FORA, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, vendedorApi } from './apoio';

const Id = z.object({ id: z.string().uuid() });

const rotasComCabecalho: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'clientes/:id/resumo',
    perfis: ['vendedor'],
    params: Id,
    carteira: (e) => (e.params as z.output<typeof Id>).id,
    semCache: true,
    executar: async () => ({ ok: true }),
  },
  { metodo: 'GET', caminho: 'regra', acao: 'pedido.ver', carteira: 'nao_se_aplica', semCache: true, executar: async () => { throw new ErroRegraNegocio('RN-VEN-01', 'Pedido sem itens.'); } },
  { metodo: 'GET', caminho: 'quebra', acao: 'pedido.ver', carteira: 'nao_se_aplica', semCache: true, executar: async () => { throw new Error('bug'); } },
  {
    metodo: 'POST',
    caminho: 'envio',
    acao: 'pedido.criar',
    carteira: 'nao_se_aplica',
    corpo: z.object({ n: z.number() }),
    limiteCorpoBytes: 64,
    semCache: true,
    executar: async () => ({ ok: true }),
  },
  { metodo: 'GET', caminho: 'fixos', acao: 'pedido.ver', carteira: 'nao_se_aplica', cabecalhos: { 'cache-control': 'private, max-age=60', vary: 'authorization' }, executar: async () => ({ ok: true }) },
  {
    metodo: 'GET',
    caminho: 'texto.csv',
    acao: 'pedido.ver',
    carteira: 'nao_se_aplica',
    tipoConteudo: 'text/csv; charset=utf-8',
    nomeArquivo: 'x.csv',
    semCache: true,
    cabecalhos: { 'x-macuxi-versao': '2' },
    executar: async () => 'a;b\n',
  },
];

const app = () =>
  createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), ...rotasComCabecalho] }) }) }));

const montar = (r: Partial<RotaModulo>) => {
  const bruto: ModuloApi = { ...vendedorApi, rotas: [{ metodo: 'GET', caminho: 'x', carteira: 'nao_se_aplica', executar: async () => ({}), ...r } as RotaModulo] };
  return () => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: bruto }) }));
};

describe('semCache e cabecalhos da rota de módulo (v1.0.16)', () => {
  it('semCache: 200 com Cache-Control no-store', async () => {
    const r = await app().inject({ method: 'GET', url: `/v1/vendedor/clientes/${CLIENTE_DA_CARTEIRA}/resumo`, headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_CONTROL_SEM_CACHE);
    expect(r.json()).toEqual({ ok: true });
  });

  it('semCache vale nas respostas de erro da rota (401, 403 perfil, 403 carteira, 400, 422, 500)', async () => {
    const a = app();
    const casos: Array<[number, { method: 'GET'; url: string; headers?: Record<string, string> }]> = [
      [401, { method: 'GET', url: `/v1/vendedor/clientes/${CLIENTE_DA_CARTEIRA}/resumo` }],
      [403, { method: 'GET', url: `/v1/vendedor/clientes/${CLIENTE_DA_CARTEIRA}/resumo`, headers: cab('promotor') }],
      [403, { method: 'GET', url: `/v1/vendedor/clientes/${CLIENTE_FORA}/resumo`, headers: cab('vendedor') }],
      [400, { method: 'GET', url: '/v1/vendedor/clientes/nao-e-uuid/resumo', headers: cab('vendedor') }],
      [422, { method: 'GET', url: '/v1/vendedor/regra', headers: cab('vendedor') }],
      [500, { method: 'GET', url: '/v1/vendedor/quebra', headers: cab('vendedor') }],
    ];
    for (const [status, req] of casos) {
      const r = await a.inject(req);
      expect(r.statusCode, req.url).toBe(status);
      expect(r.headers['cache-control'], req.url).toBe(CACHE_CONTROL_SEM_CACHE);
    }
  });

  it('semCache vale no 413 do corpo acima do limite e no 400 do JSON malformado (antes do handler)', async () => {
    const a = app();
    const grande = await a.inject({ method: 'POST', url: '/v1/vendedor/envio', headers: { ...cab('vendedor'), 'content-type': 'application/json' }, payload: JSON.stringify({ n: 1, x: 'y'.repeat(200) }) });
    expect(grande.statusCode).toBe(413);
    expect(grande.headers['cache-control']).toBe(CACHE_CONTROL_SEM_CACHE);
    const ruim = await a.inject({ method: 'POST', url: '/v1/vendedor/envio', headers: { ...cab('vendedor'), 'content-type': 'application/json' }, payload: '{"n":' });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.headers['cache-control']).toBe(CACHE_CONTROL_SEM_CACHE);
  });

  it('cabecalhos fixos saem como declarados; combinam com semCache e com download', async () => {
    const f = await app().inject({ method: 'GET', url: '/v1/vendedor/fixos', headers: cab('vendedor') });
    expect(f.headers['cache-control']).toBe('private, max-age=60');
    expect(f.headers.vary).toBe('authorization');
    const t = await app().inject({ method: 'GET', url: '/v1/vendedor/texto.csv', headers: cab('vendedor') });
    expect(t.statusCode).toBe(200);
    expect(t.headers['cache-control']).toBe(CACHE_CONTROL_SEM_CACHE);
    expect(t.headers['x-macuxi-versao']).toBe('2');
    expect(t.headers['content-type']).toBe('text/csv; charset=utf-8');
  });

  it('rota sem os campos não ganha Cache-Control (aditivo)', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBeUndefined();
  });

  it('fixture sem definirModuloApi com cabeçalho reservado, nome inválido, quebra de linha ou conflito não monta', () => {
    expect(montar({ cabecalhos: { 'content-type': 'text/html' } })).toThrow(/content-type é da API/);
    expect(montar({ cabecalhos: { 'Cache-Control': 'no-store' } })).toThrow(/Cache-Control inválido/);
    expect(montar({ cabecalhos: { 'x-a': 'b\r\nset-cookie: c=d' } })).toThrow(/valor do cabeçalho x-a/);
    expect(montar({ semCache: true, cabecalhos: { 'cache-control': 'no-cache' } })).toThrow(/semCache ou cabecalhos/);
  });

  it('definirModuloApi recusa os mesmos problemas', () => {
    expect(() => definirModuloApi({ ...vendedorApi, rotas: [{ metodo: 'GET', caminho: 'x', carteira: 'nao_se_aplica', cabecalhos: { 'set-cookie': 'a=b' }, executar: async () => ({}) }] })).toThrow(/set-cookie é da API/);
  });
});
