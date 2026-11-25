/**
 * ADR 0073, etapa E4 (troca de leitura dos perfis na API), sem banco: o motor da permissão sai da marca do tenant
 * (`plataforma.catalogo_aplicado`, `motorDoTenant`) e, no motor 'cargo', `montarRota` decide por `autorizarRotaPeloCargo`
 * com `ctx.usuario.cargo` e `ctx.usuario.perfil_acesso` (`camposPeloCargo`). Confere:
 *  - RN-CORE-35: tenant em 'legado', sem marca ou atrás da versão do código segue o motor antigo; no 'cargo', vale a concessão
 *    do perfil sem base, e a divergência entre os dois motores vai ao log sem dado pessoal;
 *  - RN-PRO-01 pelo CARGO promotor (mesmo com o token de vendedor) e RN-CORE-33 (rota do BKO sem `acesso.bko`);
 *  - leitura dupla segura: rota sem `acao` com lista `perfis` própria não abre pelo cargo antes da E6;
 *  - usuário sem perfil vivo no motor 'cargo' = nada permitido (falha fechada).
 */
import { Writable } from 'node:stream';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { definirModuloApi, modelosDePerfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { opcoesLogger } from '../src/config';
import { motorDoTenant, type CatalogoAplicado, type LicencasUsuario, type PerfilDoUsuarioPorCargo } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';
import { cab, CLIENTE_DA_CARTEIRA, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, usuarios, vendedorApi } from './apoio';

const MODELOS = modelosDePerfil(MODULOS_API.map((m) => m.manifesto));
const V2: CatalogoAplicado = { versao: 2, leitura: 'concessao' };
const LEGADO: CatalogoAplicado = { versao: 2, leitura: 'legado' };
const V1: CatalogoAplicado = { versao: 1, leitura: 'concessao' };

const modelo = (m: keyof typeof MODELOS, codigo: string = m): PerfilDoUsuarioPorCargo => ({ codigo, ...MODELOS[m] });
/** O modelo sem uma chave (o admin do tenant desmarcou). */
const sem = (p: PerfilDoUsuarioPorCargo, chave: string): PerfilDoUsuarioPorCargo => {
  const { [chave]: _fora, ...resto } = p.permissoes;
  return { ...p, permissoes: resto };
};

/** Rotas extras do Vendedor: uma do BKO (sem `acao`) e uma de leitura sem `acao` com lista `perfis` própria (pendente da E6). */
const vendedorComExtras = definirModuloApi({
  manifesto: vendedor,
  rotas: [
    ...(vendedorApi.rotas ?? []),
    { metodo: 'GET', caminho: 'bko/painel', superficie: 'bko', carteira: 'nao_se_aplica', executar: async () => ({ ok: true }) },
    { metodo: 'GET', caminho: 'so-analista', perfis: ['analista'], carteira: 'nao_se_aplica', executar: async () => ({ ok: true }) },
    {
      metodo: 'GET',
      caminho: 'quem',
      acao: 'pedido.ver',
      carteira: 'nao_se_aplica',
      executar: async (ctx) => ({ cargo: ctx.usuario.cargo ?? null, perfil_acesso: ctx.usuario.perfil_acesso?.codigo ?? null }),
    },
  ],
});

/** App com o catálogo do tenant e o perfil sem base do usuário dados (o que `licencasDoBanco` lê); `linhas` recebe o log. */
function montar(catalogo: CatalogoAplicado | null, perfil: Partial<Record<keyof typeof usuarios, PerfilDoUsuarioPorCargo | null>>) {
  const linhas: string[] = [];
  const stream = new Writable({
    write(c: Buffer, _e, cb) {
      linhas.push(c.toString());
      cb();
    },
  });
  const base = opcoesDeTeste(LICENCAS_PADRAO);
  const app = createApp({
    ...base,
    modulos: modulosDeTeste({ vendedor: vendedorComExtras }),
    logger: { ...opcoesLogger('info'), stream },
    licencas: async (u, b): Promise<LicencasUsuario> => {
      const l = await base.licencas!(u, b);
      const nome = (Object.keys(usuarios) as (keyof typeof usuarios)[]).find((k) => usuarios[k]!.id === u.id)!;
      // como a fonte real: o perfil sem base só é lido no motor 'cargo'
      return { ...l, catalogo, ...(motorDoTenant(catalogo) === 'cargo' ? { perfilPorCargo: perfil[nome] ?? null } : {}) };
    },
  });
  return { app, linhas };
}

const criarPedido = (app: ReturnType<typeof createApp>, quem: keyof typeof usuarios) =>
  app.inject({
    method: 'POST',
    url: '/v1/vendedor/pedidos',
    headers: cab(quem),
    payload: { id: '0e000000-0000-4000-8000-000000000001', cliente_id: CLIENTE_DA_CARTEIRA, total_centavos: 100 },
  });

describe('motor da permissão pela marca do tenant (ADR 0073 E4)', () => {
  it("RN-CORE-35: 'cargo' só com leitura 'concessao' e o catálogo na versão do código", () => {
    expect(motorDoTenant(null)).toBe('base');
    expect(motorDoTenant(undefined)).toBe('base');
    expect(motorDoTenant(LEGADO)).toBe('base');
    expect(motorDoTenant(V1)).toBe('base');
    expect(motorDoTenant(V2)).toBe('cargo');
    expect(motorDoTenant({ versao: 3, leitura: 'concessao' })).toBe('cargo');
  });

  it("RN-CORE-35: a concessão desmarcada vale no 'cargo'; 'legado' e catálogo atrás seguem o motor antigo", async () => {
    const vendedorSemCriar = { vendedor: sem(modelo('vendedor'), 'pedido.criar') };
    expect((await criarPedido(montar(LEGADO, vendedorSemCriar).app, 'vendedor')).statusCode).toBe(201);
    const r = await criarPedido(montar(V2, vendedorSemCriar).app, 'vendedor');
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
  });

  it("no 'cargo', ctx.usuario recebe cargo e perfil_acesso; no 'base', nenhum dos dois", async () => {
    const perfis = { vendedor: modelo('vendedor', 'vendedor_externo') };
    const novo = await montar(V2, perfis).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    expect(novo.json()).toEqual({ cargo: 'vendedor', perfil_acesso: 'vendedor_externo' });
    const antigo = await montar(LEGADO, perfis).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    expect(antigo.json()).toEqual({ cargo: null, perfil_acesso: null });
  });

  it('a divergência entre os motores vai ao log com as chaves e o código do perfil, sem o id do usuário', async () => {
    const { app, linhas } = montar(V2, { vendedor: sem(modelo('vendedor', 'vendedor_externo'), 'pedido.criar') });
    await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    const linha = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === 'perfis.motores_divergem');
    expect(linha).toMatchObject({ tenant_id: usuarios.vendedor!.tenant_id, modulo: 'vendedor', perfil: 'vendedor_externo', chaves: ['pedido.criar'] });
    expect(linhas.join('')).not.toContain(usuarios.vendedor!.id);
  });

  it('RN-PRO-01: o CARGO promotor não escreve pedido, mesmo com o token de vendedor e a concessão no perfil', async () => {
    const promotorComCriar: PerfilDoUsuarioPorCargo = {
      codigo: 'promotor_x',
      cargo: 'promotor',
      permissoes: { ...MODELOS.promotor.permissoes, 'pedido.criar': {} },
    };
    expect((await criarPedido(montar(LEGADO, { vendedor: promotorComCriar }).app, 'vendedor')).statusCode).toBe(201);
    const r = await criarPedido(montar(V2, { vendedor: promotorComCriar }).app, 'vendedor');
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
  });

  it('RN-CORE-33: rota do BKO recusa o cargo sem acesso.bko, qualquer que seja o perfil do token', async () => {
    const app = montar(V2, { analista: modelo('vendedor', 'vendedor_bko'), supervisor: modelo('admin') }).app;
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/bko/painel', headers: cab('analista') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_BKO');
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/bko/painel', headers: cab('supervisor') })).statusCode).toBe(200);
  });

  it('leitura dupla segura: rota sem `acao` com `perfis` própria não abre pelo cargo antes da E6', async () => {
    const app = montar(V2, { vendedor: modelo('admin'), analista: modelo('analista') }).app;
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('vendedor') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('analista') })).statusCode).toBe(200);
  });

  it("falha fechada: no 'cargo', usuário sem perfil vivo e ativo não passa; a licença do módulo vem antes (RN-CORE-02)", async () => {
    const app = montar(V2, { vendedor: null, analista: modelo('promotor', 'promotor_sem_licenca') }).app;
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    // o analista tem o Promotor no perfil (licença); sem ele, MODULO_INATIVO antes de olhar a concessão
    const semLicenca = montar(V2, { vendedor: modelo('promotor', 'promotor_sem_licenca') }).app;
    const g = await semLicenca.inject({ method: 'POST', url: '/v1/promotor/gondolas', headers: cab('vendedor'), payload: { cliente_id: CLIENTE_DA_CARTEIRA } });
    expect(g.statusCode).toBe(403);
    expect(g.json().codigo).toBe('MODULO_INATIVO');
    const ok = await app.inject({ method: 'POST', url: '/v1/promotor/gondolas', headers: cab('analista'), payload: { cliente_id: CLIENTE_DA_CARTEIRA } });
    expect(ok.statusCode).toBe(201);
  });
});
