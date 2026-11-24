/**
 * Item 19 do teste de campo do Campo v1.0.16 (desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2): `GET /v1/app/versao`
 * pública, lida da configuração do servidor (`APP_<CAMPO|GESTAO>_VERSAO` e `_PUBLICADA_EM`). T-0190 (RN-CORE-67, ADR 0065):
 * `contrato=2` responde `AppVersaoPublicadaV2Schema` sem `apk_url`; sem `contrato` (apps v1.0.17 e v1.0.18) responde o
 * `AppVersaoPublicadaSchema` antigo com `apk_url` na página de orientação, nunca no APK. Dados fictícios.
 */
import {
  AppVersaoPublicadaSchema,
  AppVersaoPublicadaV2Schema,
  CABECALHO_APP,
  criarServicoPacotesMemoria,
  definirModuloApi,
  ErroAppDesatualizadoSchema,
  erroArmazenamentoIndisponivel,
  haVersaoNova,
  rotaAppVersao,
  ROTA_CORE_APP_APK,
  valorCabecalhoApp,
  type PacotePublicado,
  type RotaModulo,
  type ServicoPacotes,
} from '@macuxi/platform-sdk';
import type { HTTPMethods } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  CACHE_APP_VERSAO,
  CACHE_FONTE_VERSOES_MS,
  criarFonteVersoesApp,
  ROTAS_LIBERADAS_APP_DESATUALIZADO,
  rotaLiberadaAoAppDesatualizado,
  URL_API_PUBLICA_PADRAO,
  urlApiPublicaDoAmbiente,
  versoesAppDoAmbiente,
} from '../src/app-versao';
import { MODULOS_API } from '../src/modulos';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, vendedorApi } from './apoio';

const ENV = {
  APP_CAMPO_VERSAO: '1.0.17',
  APP_CAMPO_APK_URL: 'https://exemplo.com/apk/Campo-Oficial-v1.0.17.apk',
  APP_CAMPO_PUBLICADA_EM: '2026-11-20T10:00:00.000Z',
};
const montar = (env: NodeJS.ProcessEnv = ENV) => createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente(env) }));

describe('versoesAppDoAmbiente', () => {
  it('lê as duas variantes; publicada_em opcional (ausente = null); APP_*_APK_URL é ignorada (RN-CORE-67)', () => {
    const v = versoesAppDoAmbiente({ ...ENV, APP_GESTAO_VERSAO: ' 1.0.9 ', APP_GESTAO_APK_URL: 'https://exemplo.com/g.apk' });
    expect(v.campo).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: ENV.APP_CAMPO_PUBLICADA_EM });
    expect(v.gestao).toEqual({ variante: 'gestao', versao: '1.0.9', publicada_em: null });
    expect(versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.17' }).campo).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: null });
  });

  it('sem versão ou fora do contrato (versão fora de X.Y.Z, data inválida) = variante ausente', () => {
    expect(versoesAppDoAmbiente({})).toEqual({});
    expect(versoesAppDoAmbiente({ APP_CAMPO_APK_URL: ENV.APP_CAMPO_APK_URL })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_VERSAO: 'v1.0.17' })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_PUBLICADA_EM: 'ontem' })).toEqual({});
  });
});

describe('urlApiPublicaDoAmbiente', () => {
  it('https sem barra no fim; ausente ou fora de https = padrão', () => {
    expect(urlApiPublicaDoAmbiente({})).toBe(URL_API_PUBLICA_PADRAO);
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'https://api.exemplo.com/' })).toBe('https://api.exemplo.com');
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'http://api.exemplo.com' })).toBe(URL_API_PUBLICA_PADRAO);
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'https://api.exemplo.com/x?y' })).toBe(URL_API_PUBLICA_PADRAO);
  });
});

describe('GET /v1/app/versao', () => {
  it('app novo (rotaAppVersao, contrato=2): 200 V2, cache curto, sem dado de tenant e sem link do APK (RN-CORE-67)', async () => {
    const r = await montar().inject({ method: 'GET', url: rotaAppVersao('campo') });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_APP_VERSAO);
    expect(r.json()).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: ENV.APP_CAMPO_PUBLICADA_EM });
    expect(AppVersaoPublicadaV2Schema.safeParse(r.json()).success).toBe(true);
    expect(r.body).not.toContain('apk');
  });

  it('app v1.0.17/v1.0.18 (sem contrato): contrato antigo válido, versão nova e apk_url na página de orientação, nunca no APK (RN-CORE-67)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.19' }) }));
    const r = await app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_APP_VERSAO);
    // o app antigo valida com o AppVersaoPublicadaSchema (estrito, apk_url https obrigatório) e compara com haVersaoNova
    const v = AppVersaoPublicadaSchema.parse(r.json());
    expect(v).toEqual({
      variante: 'campo',
      versao: '1.0.19',
      publicada_em: null,
      apk_url: `${URL_API_PUBLICA_PADRAO}/v1/app/atualizar?variante=campo`,
    });
    expect(haVersaoNova('1.0.18', v.versao)).toBe(true);
    expect(v.apk_url).not.toMatch(/\.apk\b/);

    // o "Atualizar para 1.0.19" abre esta página: orienta a pedir o link, sem link nem arquivo
    const p = await app.inject({ method: 'GET', url: new URL(v.apk_url).pathname + new URL(v.apk_url).search });
    expect(p.statusCode).toBe(200);
    expect(p.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(p.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(p.body).toContain('<h1>Macuxi Campo 1.0.19</h1>');
    expect(p.body).toContain('Peça o link de download ao gestor ou ao administrador da empresa.');
    expect(p.body).not.toMatch(/href|\.apk|pacotes\//);
  });

  it('a base do apk_url antigo vem da opção (MACUXI_API_URL_PUBLICA)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente(ENV), urlApiPublica: 'https://api.exemplo.com' }));
    const r = await app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect(r.json().apk_url).toBe('https://api.exemplo.com/v1/app/atualizar?variante=campo');
  });

  it('página de orientação: Gestão sem versão publicada mostra só o nome; variante inválida = 400', async () => {
    const p = await montar().inject({ method: 'GET', url: '/v1/app/atualizar?variante=gestao' });
    expect(p.statusCode).toBe(200);
    expect(p.body).toContain('<h1>Macuxi Gestão</h1>');
    expect((await montar().inject({ method: 'GET', url: '/v1/app/atualizar?variante=web' })).statusCode).toBe(400);
  });

  it('variante sem versão configurada = 404 SEM_VERSAO; sem configuração nenhuma também', async () => {
    const r = await montar().inject({ method: 'GET', url: '/v1/app/versao?variante=gestao' });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('SEM_VERSAO');
    expect((await montar({}).inject({ method: 'GET', url: '/v1/app/versao?variante=campo' })).json().codigo).toBe('SEM_VERSAO');
  });

  it.each(['/v1/app/versao', '/v1/app/versao?variante=web', '/v1/app/versao?variante=campo&tenant=x', '/v1/app/versao?variante=campo&contrato=3'])('%s = 400 VALIDACAO', async (url) => {
    const r = await montar().inject({ method: 'GET', url });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
  });
});

// ---------- T-0195 (ADR 0070, RN-CORE-80): atualização obrigatória do APK ----------
const PUBLICADO = '2026-11-24T12:00:00.000Z';
const H = 3_600_000;
const instante = (ms: number) => new Date(Date.parse(PUBLICADO) + ms);
const APK_CAMPO = { versao: '1.0.33', arquivo: 'macuxi-campo-1.0.33.apk', publicado_em: PUBLICADO };

describe('criarFonteVersoesApp (ADR 0070 §D1)', () => {
  const contando = (manifesto: (p: string) => Promise<PacotePublicado | null>) => {
    let chamadas = 0;
    const pacotes: ServicoPacotes = {
      disponivel: () => true,
      linkDoUltimo: () => Promise.reject(new Error('a fonte nunca assina link')),
      manifestoDoUltimo: (p) => {
        chamadas++;
        return manifesto(p);
      },
    };
    return { pacotes, chamadas: () => chamadas };
  };

  it('manifesto do APK (versão e publicado_em) vale sobre o ambiente; cache de 5 min por variante', async () => {
    let agora = instante(0);
    const c = contando(async (p) => (p === 'campo' ? APK_CAMPO : null));
    const fonte = criarFonteVersoesApp({ pacotes: c.pacotes, doAmbiente: versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.20', APP_GESTAO_VERSAO: '1.0.21' }), relogio: () => agora });
    expect(await fonte.publicada('campo')).toEqual({ versao: '1.0.33', publicada_em: PUBLICADO });
    // sem manifesto da variante: o ambiente
    expect(await fonte.publicada('gestao')).toEqual({ versao: '1.0.21', publicada_em: null });
    expect(c.chamadas()).toBe(2);
    agora = new Date(agora.getTime() + CACHE_FONTE_VERSOES_MS - 1);
    await fonte.publicada('campo');
    expect(c.chamadas()).toBe(2);
    agora = new Date(agora.getTime() + 1);
    await fonte.publicada('campo');
    expect(c.chamadas()).toBe(3);
  });

  it('sem S3 (porta desligada): só o ambiente; versão do manifesto fora de X.Y.Z: o ambiente', async () => {
    const amb = versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.30', APP_CAMPO_PUBLICADA_EM: PUBLICADO });
    const desligada = createApp(opcoesDeTeste(undefined, { versoesApp: amb }));
    expect((await desligada.inject({ method: 'GET', url: rotaAppVersao('campo') })).json().versao).toBe('1.0.30');
    const rc = criarServicoPacotesMemoria({ campo: { ...APK_CAMPO, versao: '1.0.34-rc.1' } });
    expect(await criarFonteVersoesApp({ pacotes: rc, doAmbiente: amb, relogio: () => instante(0) }).publicada('campo')).toEqual({ versao: '1.0.30', publicada_em: PUBLICADO });
  });

  it('armazenamento fora: o último valor bom; sem ele, o ambiente; log só com variante e código; nunca lança', async () => {
    let agora = instante(0);
    let falhar = false;
    const avisos: Record<string, unknown>[] = [];
    const c = contando(async () => {
      if (falhar) throw erroArmazenamentoIndisponivel();
      return APK_CAMPO;
    });
    const fonte = criarFonteVersoesApp({ pacotes: c.pacotes, doAmbiente: {}, relogio: () => agora, log: { warn: (o) => void avisos.push(o) } });
    expect((await fonte.publicada('campo'))?.versao).toBe('1.0.33');
    falhar = true;
    agora = new Date(agora.getTime() + CACHE_FONTE_VERSOES_MS);
    expect((await fonte.publicada('campo'))?.versao).toBe('1.0.33');
    expect(await fonte.publicada('gestao')).toBeNull();
    expect(avisos).toEqual([
      { variante: 'campo', codigo: 'ARMAZENAMENTO_INDISPONIVEL', operacao: 'versao_app' },
      { variante: 'gestao', codigo: 'ARMAZENAMENTO_INDISPONIVEL', operacao: 'versao_app' },
    ]);
  });
});

describe('rotaLiberadaAoAppDesatualizado (ADR 0070 §D4)', () => {
  it.each([
    ['POST', '/v1/auth/login'],
    ['POST', '/v1/auth/refresh'],
    ['POST', '/v1/auth/logout'],
    ['POST', '/v1/auth/senha/trocar'],
    ['POST', '/v1/sync/push'],
    ['PUT', '/v1/arquivos/:id'],
    ['PUT', '/v1/arquivos/:id/partes/:n'],
    ['GET', '/v1/arquivos/:id/partes/:n/url-envio'],
    ['POST', '/v1/arquivos/:id/concluir'],
    ['PUT', '/v1/vendedor/orcamentos/:id'],
    ['GET', '/v1/sync/pull'],
    ['GET', '/v1/sync/novidades'],
    ['GET', '/v1/me/modulos'],
    ['GET', '/v1/app/versao'],
    ['HEAD', '/v1/saude'],
    ['POST', ROTA_CORE_APP_APK],
  ])('%s %s liberada', (metodo, url) => {
    expect(rotaLiberadaAoAppDesatualizado(metodo, url)).toBe(true);
  });

  it.each([
    ['POST', '/v1/sync/pull'],
    ['GET', '/v1/sync/pacotes'],
    ['POST', '/v1/vendedor/orcamentos'],
    ['POST', '/v1/vendedor/orcamentos/:id/cancelar'],
    ['GET', '/v1/arquivos/:id'],
    ['POST', '/v1/vendedor/pedidos'],
    ['GET', '/v1/me/empresa/logo/:sha256'],
    ['GET', '/v1/authx'],
    ['GET', ROTA_CORE_APP_APK],
  ])('%s %s recusada', (metodo, url) => {
    expect(rotaLiberadaAoAppDesatualizado(metodo, url)).toBe(false);
  });

  // ADR 0070 §D6: pendente do modulo-core; fica fora da conferência e sai desta exceção quando o Core registrar (limpeza no próximo lote)
  const PENDENTES_DO_CORE = new Set([`POST ${ROTA_CORE_APP_APK}`]);

  it('toda entrada da lista existe na API montada com os módulos reais (padrão do Fastify; prefixo = alguma rota abaixo dele)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { modulos: MODULOS_API }));
    await app.ready();
    const arvore = app.printRoutes({ commonPrefix: false });
    for (const { metodo, url } of ROTAS_LIBERADAS_APP_DESATUALIZADO) {
      const chave = `${metodo} ${url}`;
      if (PENDENTES_DO_CORE.has(chave)) continue;
      const existe = url.endsWith('/*') ? arvore.includes(url.slice(0, -1)) : app.hasRoute({ method: metodo as HTTPMethods, url });
      expect(existe, chave).toBe(true);
    }
  });
});

describe('426 APP_DESATUALIZADO no app antigo (RN-CORE-80, ADR 0070 §D4)', () => {
  const rotaEco: RotaModulo = {
    metodo: 'GET',
    caminho: 'eco-versao',
    acao: 'pedido.ver',
    carteira: 'nao_se_aplica',
    executar: async (ctx) => ({ cliente: ctx.versaoApp?.doCliente ?? null, publicada: (await ctx.versaoApp?.publicada('campo')) ?? null }),
  };
  const montarApp = (agora: Date, pacotes: ServicoPacotes = criarServicoPacotesMemoria({ campo: APK_CAMPO })) =>
    createApp(
      opcoesDeTeste(LICENCAS_PADRAO, {
        pacotes,
        versoesApp: {},
        relogio: () => agora,
        modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rotaEco] }) }),
      }),
    );
  const antigo = { ...cab('vendedor'), [CABECALHO_APP]: valorCabecalhoApp('campo', '1.0.32') };
  const PUSH = { method: 'POST' as const, url: '/v1/sync/push', payload: { itens: [] } };
  const PULL = { method: 'GET' as const, url: '/v1/sync/pull?entidade=cliente' };
  const ECO = { method: 'GET' as const, url: '/v1/vendedor/eco-versao' };

  it('depois de 24 h: rota de módulo fora da lista = 426 com a versão publicada; push, pull, novidades, PUT do orçamento, login e versão seguem', async () => {
    const app = montarApp(instante(24 * H));
    for (const pedido of [ECO, { method: 'GET' as const, url: '/v1/sync/pacotes' }]) {
      const r = await app.inject({ ...pedido, headers: antigo });
      expect(r.statusCode, `${pedido.url} ${r.body}`).toBe(426);
      expect(ErroAppDesatualizadoSchema.parse(r.json())).toEqual({
        codigo: 'APP_DESATUALIZADO',
        mensagem: 'Versão desatualizada, reinstale para continuar.',
        detalhes: { variante: 'campo', versao_publicada: '1.0.33', publicada_em: PUBLICADO, prazo_ate: '2026-11-25T12:00:00.000Z' },
      });
    }
    const ORCAMENTO = { method: 'PUT' as const, url: '/v1/vendedor/orcamentos/0b0f5a52-8c1e-4f43-9d55-2c1f8e0a7b10', payload: {} };
    const NOVIDADES = { method: 'GET' as const, url: '/v1/sync/novidades' };
    const MODULOS = { method: 'GET' as const, url: '/v1/me/modulos' };
    for (const pedido of [PUSH, PULL, NOVIDADES, MODULOS, ORCAMENTO]) {
      const r = await app.inject({ ...pedido, headers: antigo });
      expect(r.statusCode, `${pedido.url} ${r.body}`).not.toBe(426);
      const semCabecalho = await app.inject({ ...pedido, headers: cab('vendedor') });
      expect(r.statusCode, pedido.url).toBe(semCabecalho.statusCode);
    }
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { [CABECALHO_APP]: 'campo/1.0.32' }, payload: {} });
    expect(login.statusCode, login.body).not.toBe(426);
    const versao = await app.inject({ method: 'GET', url: rotaAppVersao('campo'), headers: { [CABECALHO_APP]: 'campo/1.0.32' } });
    expect(versao.statusCode).toBe(200);
    expect(versao.json()).toEqual({ variante: 'campo', versao: '1.0.33', publicada_em: PUBLICADO });
  });

  it('nas primeiras 24 h (23h59) nada é recusado, e a rota do módulo recebe ctx.versaoApp', async () => {
    const r = await montarApp(instante(24 * H - 60_000)).inject({ method: 'GET', url: '/v1/vendedor/eco-versao', headers: antigo });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ cliente: { variante: 'campo', versao: '1.0.32' }, publicada: { versao: '1.0.33', publicada_em: PUBLICADO } });
  });

  it('sem cabeçalho (BKO, apps até a v1.0.32), versão em dia ou maior, outra variante sem publicação: nada muda', async () => {
    const app = montarApp(instante(48 * H));
    const semCabecalho = await app.inject({ method: 'GET', url: '/v1/vendedor/eco-versao', headers: cab('vendedor') });
    expect(semCabecalho.statusCode).toBe(200);
    expect(semCabecalho.json().cliente).toBeNull();
    for (const valor of ['campo/1.0.33', 'campo/1.0.34', 'gestao/1.0.1', 'campo/1.0', 'lixo']) {
      const r = await app.inject({ method: 'GET', url: '/v1/vendedor/eco-versao', headers: { ...cab('vendedor'), [CABECALHO_APP]: valor } });
      expect(r.statusCode, valor).toBe(200);
    }
  });

  it('manifesto sem publicado_em (hora desconhecida) ou armazenamento fora: não bloqueia', async () => {
    const semHora = criarServicoPacotesMemoria({ campo: { versao: '1.0.33', arquivo: 'macuxi-campo-1.0.33.apk' } });
    expect((await montarApp(instante(48 * H), semHora).inject({ ...ECO, headers: antigo })).statusCode).not.toBe(426);
    const fora: ServicoPacotes = { disponivel: () => true, linkDoUltimo: () => Promise.reject(erroArmazenamentoIndisponivel()), manifestoDoUltimo: () => Promise.reject(erroArmazenamentoIndisponivel()) };
    expect((await montarApp(instante(48 * H), fora).inject({ ...ECO, headers: antigo })).statusCode).not.toBe(426);
  });

  it('escritas fora da lista (POST, PUT, DELETE dos módulos reais) = 426; PUT /v1/arquivos/:id segue como sem cabeçalho', async () => {
    const app = createApp(
      opcoesDeTeste(LICENCAS_PADRAO, { modulos: MODULOS_API, pacotes: criarServicoPacotesMemoria({ campo: APK_CAMPO }), versoesApp: {}, relogio: () => instante(24 * H) }),
    );
    const ID = '0b0f5a52-8c1e-4f43-9d55-2c1f8e0a7b10';
    for (const pedido of [
      { method: 'POST' as const, url: `/v1/vendedor/orcamentos/${ID}/cancelar`, payload: {} },
      { method: 'PUT' as const, url: `/v1/vendedor/transportadoras/${ID}`, payload: {} },
      { method: 'DELETE' as const, url: `/v1/core/filiais/${ID}` },
    ]) {
      const r = await app.inject({ ...pedido, headers: antigo });
      expect(r.statusCode, `${pedido.method} ${pedido.url} ${r.body}`).toBe(426);
      expect(r.json().codigo).toBe('APP_DESATUALIZADO');
    }
    const ARQUIVO = { method: 'PUT' as const, url: `/v1/arquivos/${ID}`, payload: Buffer.from([0xff, 0xd8, 0xff]) };
    const comApp = await app.inject({ ...ARQUIVO, headers: { ...antigo, 'content-type': 'image/jpeg' } });
    const semApp = await app.inject({ ...ARQUIVO, headers: { ...cab('vendedor'), 'content-type': 'image/jpeg' } });
    expect(comApp.statusCode, comApp.body).not.toBe(426);
    expect(comApp.statusCode).toBe(semApp.statusCode);
  });

  it('cada variante tem o próprio prazo: Gestão vencida = 426; Campo vencido não afeta a Gestão em dia', async () => {
    const GESTAO_HOJE = { versao: '1.0.5', arquivo: 'macuxi-gestao-1.0.5.apk', publicado_em: instante(23 * H).toISOString() };
    const gestaoAntigo = { ...cab('supervisor'), [CABECALHO_APP]: valorCabecalhoApp('gestao', '1.0.4') };
    const vencida = montarApp(instante(24 * H), criarServicoPacotesMemoria({ campo: APK_CAMPO, gestao: { ...GESTAO_HOJE, publicado_em: PUBLICADO } }));
    const r = await vencida.inject({ ...ECO, headers: gestaoAntigo });
    expect(r.statusCode, r.body).toBe(426);
    expect(r.json().detalhes).toMatchObject({ variante: 'gestao', versao_publicada: '1.0.5' });

    const emDia = montarApp(instante(24 * H), criarServicoPacotesMemoria({ campo: APK_CAMPO, gestao: GESTAO_HOJE }));
    expect((await emDia.inject({ ...ECO, headers: antigo })).statusCode).toBe(426);
    expect((await emDia.inject({ ...ECO, headers: gestaoAntigo })).statusCode).not.toBe(426);
  });
});
