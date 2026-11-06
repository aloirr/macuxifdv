/**
 * T-0087 (portal de implantação; PRs N1/N2 da nuvem): a API honra `tipoConteudo` e `nomeArquivo` da rota de módulo
 * (Content-Type, Content-Disposition e nosniff) e roteia caminho com ponto (`modelos/:entidade.csv`). Aditivo: rota sem os
 * campos continua JSON.
 */
import { definirModuloApi, type ModuloApi, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, vendedorApi } from './apoio';

const Entidade = z.object({ entidade: z.enum(['produtos', 'clientes']) });
const CSV = '﻿codigo;nome\n';

const rotasDownload: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'modelos/:entidade.csv',
    carteira: 'nao_se_aplica',
    params: Entidade,
    tipoConteudo: 'text/csv; charset=utf-8',
    nomeArquivo: (e) => `${(e.params as z.output<typeof Entidade>).entidade}.csv`,
    executar: async (ctx) => `${CSV}# ${(ctx.params as z.output<typeof Entidade>).entidade}\n`,
  },
  { metodo: 'GET', caminho: 'modelos/:entidade.json', carteira: 'nao_se_aplica', params: Entidade, executar: async (ctx) => ({ entidade: (ctx.params as z.output<typeof Entidade>).entidade }) },
  { metodo: 'GET', caminho: 'openapi.yaml', carteira: 'nao_se_aplica', tipoConteudo: 'application/yaml; charset=utf-8', executar: async () => new TextEncoder().encode('openapi: 3.1.0\n') },
  { metodo: 'GET', caminho: 'baixar.json', carteira: 'nao_se_aplica', nomeArquivo: 'dados.json', executar: async () => ({ ok: true }) },
  { metodo: 'GET', caminho: 'quebrado.csv', carteira: 'nao_se_aplica', tipoConteudo: 'text/csv; charset=utf-8', nomeArquivo: 'x.csv', executar: async () => ({ nao: 'texto' }) },
  { metodo: 'GET', caminho: 'nome-ruim.csv', carteira: 'nao_se_aplica', tipoConteudo: 'text/csv; charset=utf-8', nomeArquivo: () => '../etc"x.csv', executar: async () => 'a' },
];

const app = () =>
  createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), ...rotasDownload] }) }) }));

describe('rota de download (tipoConteudo/nomeArquivo; T-0087)', () => {
  it('modelos/:entidade.csv: CSV como está, com BOM, Content-Type, Content-Disposition e nosniff', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/vendedor/modelos/produtos.csv', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toBe('attachment; filename="produtos.csv"');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).toBe(`${CSV}# produtos\n`);
  });

  it('o parâmetro termina no ponto: `.json` é outra rota, e entidade fora do enum é 400', async () => {
    const j = await app().inject({ method: 'GET', url: '/v1/vendedor/modelos/clientes.json', headers: cab('vendedor') });
    expect(j.statusCode).toBe(200);
    expect(j.json()).toEqual({ entidade: 'clientes' });
    expect(j.headers['content-disposition']).toBeUndefined();
    const ruim = await app().inject({ method: 'GET', url: '/v1/vendedor/modelos/senhas.csv', headers: cab('vendedor') });
    expect(ruim.statusCode).toBe(400);
  });

  it('Uint8Array vai como bytes; JSON com nomeArquivo continua JSON e vira anexo', async () => {
    const y = await app().inject({ method: 'GET', url: '/v1/vendedor/openapi.yaml', headers: cab('vendedor') });
    expect(y.headers['content-type']).toBe('application/yaml; charset=utf-8');
    expect(y.body).toBe('openapi: 3.1.0\n');
    const d = await app().inject({ method: 'GET', url: '/v1/vendedor/baixar.json', headers: cab('vendedor') });
    expect(d.headers['content-type']).toMatch(/^application\/json/);
    expect(d.headers['content-disposition']).toBe('attachment; filename="dados.json"');
    expect(d.json()).toEqual({ ok: true });
  });

  it('download continua exigindo login e licença (RN-CORE-02)', async () => {
    expect((await app().inject({ method: 'GET', url: '/v1/vendedor/modelos/produtos.csv' })).statusCode).toBe(401);
    expect((await app().inject({ method: 'GET', url: '/v1/vendedor/modelos/produtos.csv', headers: cab('promotor') })).statusCode).toBe(403);
  });

  it('erro de programação (corpo que não é texto, nome fora do padrão) = 500 JSON, sem cabeçalho de download', async () => {
    for (const url of ['/v1/vendedor/quebrado.csv', '/v1/vendedor/nome-ruim.csv']) {
      const r = await app().inject({ method: 'GET', url, headers: cab('vendedor') });
      expect(r.statusCode, url).toBe(500);
      expect(r.json().codigo).toBe('ERRO_INTERNO');
      expect(r.headers['content-disposition']).toBeUndefined();
    }
  });

  it('fixture sem definirModuloApi com tipo proibido não monta', () => {
    const bruto: ModuloApi = { ...vendedorApi, rotas: [{ metodo: 'GET', caminho: 'pagina', carteira: 'nao_se_aplica', tipoConteudo: 'text/html' as never, executar: async () => '<b>x</b>' }] };
    expect(() => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: bruto }) }))).toThrow(/tipoConteudo/);
  });
});
