/**
 * ADR 0073, etapas E4 e E6 (troca de leitura dos perfis na API), sem banco: o motor da permissão sai da marca do tenant
 * (`plataforma.catalogo_aplicado`, `motorDoTenant`) e, no motor 'cargo' (tenant em 'concessao'), `montarRota` decide só por
 * `autorizarRotaPeloCargo` com `ctx.usuario.cargo` e `ctx.usuario.perfil_acesso` (`camposPeloCargo`). Confere:
 *  - RN-CORE-35: tenant em 'legado', sem marca ou atrás da versão do código segue o motor antigo; no 'cargo', vale a concessão
 *    do perfil (também para o módulo que consulta `ctx.usuario.perfis`), `ctx.usuario.perfil` é a base congelada e o cargo
 *    que diverge da base vai ao log uma vez, sem dado pessoal;
 *  - RN-PRO-01 pelo CARGO promotor (rota, push e pull do sync), mesmo com o token de vendedor; RN-CORE-33 (rota do BKO);
 *  - a rota sem `acao` com lista `perfis` própria vale pela licença no 'cargo' (E6) e pela lista no 'legado';
 *  - RN-CORE-04: o escopo de carteira sai da base congelada do perfil, não do token;
 *  - usuário sem perfil vivo no motor 'cargo' = nada permitido (falha fechada), e a licença do módulo vem antes.
 */
import { Writable } from 'node:stream';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { definirModuloApi, modelosDePerfil, pode } from '@macuxi/platform-sdk';
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

/** Rotas extras do Vendedor: uma do BKO (sem `acao`), uma de leitura sem `acao` com lista `perfis` própria e a do "quem sou". */
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
      executar: async (ctx) => ({
        cargo: ctx.usuario.cargo ?? null,
        perfil_acesso: ctx.usuario.perfil_acesso?.codigo ?? null,
        perfil: ctx.usuario.perfil,
        // o módulo que ainda consulta o motor antigo (`pode(ctx.usuario.perfis, ...)`)
        pode_aprovar: pode(ctx.usuario.perfis, 'pedido.aprovar'),
      }),
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

const pushPedido = (app: ReturnType<typeof createApp>, quem: keyof typeof usuarios) =>
  app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: cab(quem),
    payload: { itens: [{ entidade: 'pedido', id: '0e000000-0000-4000-8000-000000000002', operacao: 'upsert', payload: {} }] },
  });

describe('motor da permissão pela marca do tenant (ADR 0073 E4 e E6)', () => {
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

  it("no 'cargo', ctx.usuario recebe cargo, perfil_acesso, a base congelada e os perfis pelas concessões; no 'base', nada muda", async () => {
    const perfis = { vendedor: { ...modelo('vendedor', 'vendedor_externo'), base: 'vendedor' as const } };
    const novo = await montar(V2, perfis).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    expect(novo.json()).toEqual({ cargo: 'vendedor', perfil_acesso: 'vendedor_externo', perfil: 'vendedor', pode_aprovar: false });
    const antigo = await montar(LEGADO, perfis).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    expect(antigo.json()).toEqual({ cargo: null, perfil_acesso: null, perfil: 'vendedor', pode_aprovar: false });
    // o token diz analista, o perfil é o de vendedor: no 'cargo' vale o perfil (base congelada e concessões), no 'legado' o token
    const doAnalista = { analista: { ...modelo('vendedor', 'vendedor_bko'), base: 'vendedor' as const } };
    const r = await montar(V2, doAnalista).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('analista') });
    expect(r.json()).toEqual({ cargo: 'vendedor', perfil_acesso: 'vendedor_bko', perfil: 'vendedor', pode_aprovar: false });
    const l = await montar(LEGADO, doAnalista).app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('analista') });
    expect(l.json()).toMatchObject({ perfil: 'analista', pode_aprovar: true });
  });

  it('o cargo que diverge da base congelada vai ao log uma vez, com o código do perfil e sem o id do usuário', async () => {
    const { app, linhas } = montar(V2, { vendedor: { ...modelo('promotor', 'promotor_ex_vendedor'), base: 'vendedor' } });
    await app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    await app.inject({ method: 'GET', url: '/v1/vendedor/quem', headers: cab('vendedor') });
    const avisos = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.evento === 'perfis.motores_divergem');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tenant_id: usuarios.vendedor!.tenant_id, modulo: 'vendedor', perfil: 'promotor_ex_vendedor', cargo: 'promotor', base: 'vendedor' });
    expect(linhas.join('')).not.toContain(usuarios.vendedor!.id);
    // concessão desmarcada sem mudar o cargo não é divergência (o motor antigo não decide mais no 'cargo')
    const semCriar = montar(V2, { vendedor: { ...sem(modelo('vendedor'), 'pedido.criar'), base: 'vendedor' } });
    await semCriar.app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    expect(semCriar.linhas.join('')).not.toContain('perfis.motores_divergem');
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

  it("E6: rota sem `acao` com `perfis` própria vale pela licença no 'cargo' e pela lista no 'legado'", async () => {
    const perfis = { vendedor: modelo('admin'), analista: modelo('analista') };
    const novo = montar(V2, perfis).app;
    expect((await novo.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await novo.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('analista') })).statusCode).toBe(200);
    const antigo = montar(LEGADO, perfis).app;
    expect((await antigo.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('vendedor') })).statusCode).toBe(403);
    expect((await antigo.inject({ method: 'GET', url: '/v1/vendedor/so-analista', headers: cab('analista') })).statusCode).toBe(200);
  });

  it('RN-PRO-01 no sync: o CARGO promotor não envia pedido no push; o token de promotor com cargo vendedor envia', async () => {
    const comoPromotor = { vendedor: { ...modelo('promotor', 'promotor_x'), base: 'promotor' as const } };
    const r = await pushPedido(montar(V2, comoPromotor).app, 'vendedor');
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
    expect((await pushPedido(montar(LEGADO, comoPromotor).app, 'vendedor')).json().resultados[0].codigo).not.toBe('RN-PRO-01');
    const comoVendedor = { promotor: { ...modelo('vendedor', 'vendedor_x'), base: 'vendedor' as const } };
    expect((await pushPedido(montar(V2, comoVendedor).app, 'promotor')).json().resultados[0].codigo).not.toBe('RN-PRO-01');
    expect((await pushPedido(montar(LEGADO, comoVendedor).app, 'promotor')).json().resultados[0].codigo).toBe('RN-PRO-01');
  });

  it('RN-PRO-01 no pull: o cargo promotor puxa pedido só com a concessão pedido.ver', async () => {
    const pull = (app: ReturnType<typeof createApp>) => app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('vendedor') });
    const semVer = { vendedor: { ...sem(modelo('promotor', 'promotor_x'), 'pedido.ver'), base: 'promotor' as const } };
    const r = await pull(montar(V2, semVer).app);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    // no 'legado', o token de vendedor não é barrado
    expect((await pull(montar(LEGADO, semVer).app)).json().codigo).not.toBe('PERFIL_SEM_ACESSO');
  });

  it('RN-CORE-04: no cargo, o escopo de carteira sai da base congelada do perfil, não do token', async () => {
    const FORA = '0c000000-0000-4000-8000-0000000000ff';
    const criar = (app: ReturnType<typeof createApp>, cliente: string) =>
      app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('analista'), payload: { id: '0e000000-0000-4000-8000-000000000003', cliente_id: cliente, total_centavos: 100 } });
    // token de analista (carteira 'tenant' no fake), perfil de vendedor com base congelada vendedor (só a carteira)
    const app = montar(V2, { analista: { ...modelo('vendedor', 'vendedor_bko'), base: 'vendedor' } }).app;
    expect((await criar(app, CLIENTE_DA_CARTEIRA)).statusCode).toBe(201);
    const r = await criar(app, FORA);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('FORA_DA_CARTEIRA');
    // no 'legado', o token de analista (carteira 'tenant') cria para qualquer cliente
    expect((await criar(montar(LEGADO, {}).app, FORA)).statusCode).toBe(201);
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
