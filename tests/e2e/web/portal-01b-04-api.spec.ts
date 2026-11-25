/**
 * Itens 01b e 04 da v1.0.34 (R-20261124-191902 e R-20261124-090942; ADR 0074 e 0075), cobertura do agente `testes` além dos specs
 * do engenheiro-apps (`apps/web/e2e/portal-menu-usuario.spec.ts` e `portal-empresa-cadastro.spec.ts`), com a API do portal
 * respondida pelo `page.route` (o modo falso roda no navegador e não deixa forçar os códigos abaixo):
 * - 01b (v1.0.35, ADR 0075), time Macuxi e admin do cliente com a empresa escolhida pela mesma gaveta e a mesma rota,
 *   `POST /plataforma/auth/senha` com o token do portal, só `{ senha_atual, senha_nova }` (sem e-mail nem código da empresa); 401
 *   na gaveta (a sessão fica, inclusive depois de recarregar), 423 com os minutos, 409 `SENHA_MUDOU` e 422 RN-CORE-34; 204 →
 *   entrada com "Senha trocada. Entre de novo.", sem token de renovação no navegador; a rota pública `/auth/senha/trocar` não é
 *   chamada;
 * - 01b, admin do cliente: 403 `EMPRESA_NAO_PERMITIDA` na troca (1 empresa) → entrada com "Esta empresa não está mais disponível
 *   para você."; sem empresa escolhida (2+), a "Escolha a empresa" não tem o menu nem chama a troca;
 * - 04, valor × regra no cartão do plano: valor por ciclo pela RN-PLA-06 (anual = (12 − meses grátis) × mensal), "N de M" de cada
 *   item e o selo: igual = "no limite", acima = "acima do contratado", abaixo e sem limite = nenhum;
 * - 04, Apps: "O link vale até DD/MM às HH:MM." no fuso da EMPRESA (Manaus e Boa Vista, UTC−4, e São Paulo, UTC−3; virada de
 *   dia em UTC);
 * - 04, Dados da empresa: 422 da API por campo (`corpo.<campo>`), Receita fora (503) avisada sem mexer nos campos, razão social
 *   vazia sem chamar a API, as 11 chaves do PUT, "5 campos preenchidos", o nome já gravado que a Receita não troca e nenhuma
 *   chamada à rota da marca.
 *
 * Roda contra o `next dev` SEM o modo falso (o portal chama `/api-proxy`):
 *   PORTAL_MODO=api PORTAL_PORTA=3348 pnpm exec playwright test tests/e2e/web/portal-01b-04-api.spec.ts --trace off
 * (servidor: `pnpm --filter web exec next dev -p 3348`). Sem `PORTAL_MODO=api`, o arquivo é pulado.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  abrirMenu,
  entrarNoPortal as entrar,
  hostsDoPortal,
  json,
  semDevOverlay,
  semTokenDeRenovacao,
  UMA,
} from './_portal-comum';

test.skip(process.env.PORTAL_MODO !== 'api', 'precisa do next dev sem o modo falso (PORTAL_MODO=api)');

const PORTA = process.env.PORTAL_PORTA ?? '3348';
const HOSTS = hostsDoPortal(PORTA);
const CNPJ = '11222333000181';
/** Segunda empresa do admin do cliente (só no caso sem empresa escolhida). */
const DUAS = '0b6f1a52-5c1e-4c4e-9a43-000000000002';

const emMinutos = (min: number) => new Date(Date.now() + min * 60_000).toISOString(); // hora-fixa-ok: a sessão do portal no navegador vence pelo relógio real

type Quem = 'time' | 'admin';

function sessao(quem: Quem, n: number, semEscolha = false) {
  const base = {
    token: `token-portal-e2e-${quem}-${n}-xxxxxxxxxxxx`,
    expira_em: emMinutos(15),
    sessao_expira_em: emMinutos(480),
  };
  if (quem === 'time')
    return {
      ...base,
      tipo: 'super_admin',
      empresa: null,
      empresas: [],
      usuario: { nome: 'Carla Menezes', perfil: null, cargo: null },
    };
  const empresa = { id: UMA, codigo: 'AM4821', nome: 'Distribuidora Uma Ltda' };
  const outra = { id: DUAS, codigo: 'RR1907', nome: 'Distribuidora Duas Ltda' };
  return {
    ...base,
    tipo: 'admin_cliente',
    empresa: semEscolha ? null : empresa,
    empresas: semEscolha ? [empresa, outra] : [empresa],
    usuario: { nome: 'Paulo Ribeiro', perfil: 'Administrador', cargo: 'administrativo' },
  };
}

const PLANO_PME = {
  id: '7c1a5f00-0000-4000-8000-000000000002',
  codigo: 'pme',
  nome: 'PME',
  ordem: 2,
  preco_mensal_centavos: 119_700,
  licencas: { vendedor: 20, gestor: 2, bko: 3, promotor: 0 },
  modulos: ['core', 'catalogo', 'vendedor', 'gestor', 'integracao'],
  adicionais: [
    { adicional: 'promotor', preco_unitario_centavos: 8_000, incluidos: 0 },
    { adicional: 'pesquisa', preco_unitario_centavos: 1_000, incluidos: 0 },
    { adicional: 'treinamento', preco_unitario_centavos: 1_000, incluidos: 0 },
  ],
  meses_gratis_anual: 2,
  dias_teste: 14,
  ativo: true,
};

/** RN-PLA-06, calculado aqui, sem o código da tela: mensal = plano + Σ adicional × preço; anual = (12 − meses grátis) × mensal. */
function valorPelaRegra(ciclo: 'mensal' | 'anual', adicionais: { adicional: string; quantidade: number }[]) {
  const mensal =
    PLANO_PME.preco_mensal_centavos +
    adicionais.reduce(
      (s, a) =>
        s +
        a.quantidade *
          (PLANO_PME.adicionais.find((x) => x.adicional === a.adicional)?.preco_unitario_centavos ?? 0),
      0,
    );
  return {
    mensal_centavos: mensal,
    por_ciclo_centavos: ciclo === 'anual' ? mensal * (12 - PLANO_PME.meses_gratis_anual) : mensal,
    ciclo,
  };
}

const brl = (c: number) =>
  `R$ ${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;

/** Vendedor acima (22 de 20), gestor igual (2 de 2), BKO abaixo (1 de 3), promotor igual (3 de 3), pesquisa sem limite, treinamento 0. */
const ADICIONAIS = [
  { adicional: 'promotor', quantidade: 3 },
  { adicional: 'pesquisa', quantidade: 10 },
];
const LICENCAS = [
  { item: 'vendedor', contratadas: 20, em_uso: 22 },
  { item: 'gestor', contratadas: 2, em_uso: 2 },
  { item: 'bko', contratadas: 3, em_uso: 1 },
  { item: 'promotor', contratadas: 3, em_uso: 3 },
  { item: 'pesquisa', contratadas: null, em_uso: 6 },
  { item: 'treinamento', contratadas: 0, em_uso: 0 },
];

interface Opcoes {
  quem: Quem;
  fuso?: string;
  /** Admin do cliente com 2 empresas e nenhuma escolhida (vai à "Escolha a empresa"). */
  semEscolha?: boolean;
  /** Resposta da troca pela rota do portal, em ordem (a última se repete). */
  trocaPortal?: { status: number; corpo?: unknown }[];
  cnpj?: { status: number; corpo?: unknown };
  /** 422 da API no PUT do cadastro (o formato que a tela não pega). */
  cadastro422?: boolean;
  /** Expiração do link do app (ISO UTC). */
  expiraApp?: string;
}

interface Registro {
  trocaPortal: { corpo: unknown; cabecalhos: Record<string, string> }[];
  trocaPublica: { corpo: Record<string, unknown>; cabecalhos: Record<string, string> }[];
  renovar: number;
  putCadastro: unknown[];
  putMarca: unknown[];
  cnpj: unknown[];
}

async function apiDoPortal(ctx: BrowserContext, o: Opcoes): Promise<Registro> {
  const r: Registro = {
    trocaPortal: [],
    trocaPublica: [],
    renovar: 0,
    putCadastro: [],
    putMarca: [],
    cnpj: [],
  };
  let n = 0;
  let revogada = false;
  let trocas = 0;
  let cadastro = {
    tenant_id: UMA,
    cnpj: CNPJ,
    razao_social: 'Distribuidora Uma Ltda',
    nome_fantasia: 'Uma' as string | null,
    logradouro: null as string | null,
    numero: null as string | null,
    complemento: null as string | null,
    bairro: 'Centro',
    municipio: null as string | null,
    uf: null as string | null,
    cep: null as string | null,
    telefone: '9236330000',
    email: null as string | null,
    inscricao_estadual: null as string | null,
    atualizado_em: '2026-11-01T12:00:00.000Z',
  };
  await ctx.route('**/api-proxy/**', async (route) => {
    const req = route.request();
    const caminho = new URL(req.url()).pathname.replace(/^\/api-proxy/, '');
    const m = req.method();
    if (caminho === '/plataforma/auth/login') return json(route, 200, sessao(o.quem, ++n, o.semEscolha));
    if (caminho === '/plataforma/auth/renovar') {
      r.renovar += 1;
      return revogada
        ? json(route, 401, { codigo: 'SESSAO_EXPIRADA', mensagem: 'Sessão encerrada.' })
        : json(route, 200, sessao(o.quem, ++n, o.semEscolha));
    }
    if (caminho === '/plataforma/auth/sair') return json(route, 204);
    if (caminho === '/plataforma/auth/senha') {
      r.trocaPortal.push({ corpo: req.postDataJSON(), cabecalhos: req.headers() });
      const lista = o.trocaPortal ?? [{ status: 204 }];
      const resp = lista[Math.min(trocas, lista.length - 1)] ?? { status: 204 };
      trocas += 1;
      if (resp.status === 204) revogada = true;
      return json(route, resp.status, resp.corpo);
    }
    if (caminho === '/auth/senha/trocar') {
      r.trocaPublica.push({
        corpo: req.postDataJSON() as Record<string, unknown>,
        cabecalhos: req.headers(),
      });
      revogada = true;
      return json(route, 200, { access_token: 'acesso-tenant', token_type: 'Bearer', expires_in: 900 });
    }
    if (caminho === '/plataforma/empresas' && m === 'GET') {
      return json(route, 200, {
        itens: [
          {
            id: UMA,
            codigo: 'AM4821',
            razao_social: cadastro.razao_social,
            cnpj: CNPJ,
            fuso: o.fuso ?? 'America/Manaus',
            status: 'ativo',
            criada_em: '2026-11-01T12:00:00.000Z',
            modulos: [
              { modulo: 'core', licencas: null },
              { modulo: 'vendedor', licencas: 20 },
            ],
            plano: 'PME',
            em_teste: false,
          },
        ],
      });
    }
    if (caminho === `/plataforma/empresas/${UMA}/assinatura`) {
      return json(route, 200, {
        tenant_id: UMA,
        plano: PLANO_PME,
        ciclo: 'anual',
        adicionais: ADICIONAIS,
        teste_ate: null,
        paga: true,
        licencas: LICENCAS,
        valor: valorPelaRegra('anual', ADICIONAIS),
        desde: '2026-11-14T12:00:00.000Z',
        atualizada_em: '2026-11-14T12:00:00.000Z',
      });
    }
    if (caminho === `/plataforma/empresas/${UMA}/cadastro`) {
      if (m === 'PUT') {
        const corpo = req.postDataJSON();
        r.putCadastro.push(corpo);
        if (o.cadastro422) {
          return json(route, 422, {
            codigo: 'CADASTRO_EMPRESA_INVALIDO',
            mensagem: 'Confira os dados cadastrais.',
            detalhes: {
              problemas: [{ caminho: 'corpo.municipio', mensagem: 'Município não confere com a UF.' }],
            },
          });
        }
        cadastro = { ...cadastro, ...corpo, atualizado_em: new Date().toISOString() }; // hora-fixa-ok: só a data da gravação no falso
      }
      return json(route, 200, cadastro);
    }
    if (caminho === `/plataforma/empresas/${UMA}/marca`) {
      if (m === 'PUT') {
        r.putMarca.push(req.postDataJSON());
        return json(route, 403, { codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Só o time da Macuxi grava.' });
      }
      return json(route, 200, {
        tenant_id: UMA,
        razao_social: cadastro.razao_social,
        nome_fantasia: 'Uma',
        logo: null,
        ocultar_marca_macuxi: false,
      });
    }
    if (caminho === `/plataforma/empresas/${UMA}/admins`) return json(route, 200, { itens: [] });
    if (caminho === '/plataforma/cnpj') {
      r.cnpj.push(req.postDataJSON());
      const c = o.cnpj ?? { status: 200 };
      return json(
        route,
        c.status,
        c.corpo ?? {
          cnpj: CNPJ,
          razao_social: 'RAZAO DA RECEITA LTDA',
          nome_fantasia: 'FANTASIA RECEITA',
          endereco: {
            logradouro: 'Rua da Receita',
            numero: '100',
            complemento: null,
            bairro: 'Bairro da Receita',
          },
          municipio: 'Manaus',
          uf: 'AM',
          cep: '69050010',
          situacao_cadastral: 'ativa',
          cnae_principal: null,
          telefone: '9299990000',
          email: 'receita@uma.com.br',
          fonte: 'brasilapi',
        },
      );
    }
    if (caminho === '/core/apps/download') {
      const { variante } = req.postDataJSON() as { variante: string };
      const nome = variante === 'campo' ? 'Campo' : 'Gestao';
      return json(route, 200, {
        variante,
        url: `http://localhost:${PORTA}/apk/${nome}.apk?assinatura=x`,
        expira_em: o.expiraApp ?? emMinutos(24 * 60),
        versao: '1.0.34',
        arquivo: `${nome}-Oficial-v1.0.34.apk`,
        tamanho_bytes: 52_428_800,
        sha256: 'a'.repeat(64),
      });
    }
    return json(route, 404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  });
  return r;
}

async function abrirTrocaDeSenha(page: Page) {
  await abrirMenu(page);
  await page.getByTestId('menu-usuario.trocar-senha').click();
  await expect(page.getByRole('dialog', { name: 'Trocar a senha' })).toBeVisible();
}

async function pedirTroca(page: Page, atual: string, nova = 'Nova-senha-123') {
  await page.getByTestId('trocar-senha.atual').fill(atual);
  await page.getByTestId('trocar-senha.nova').fill(nova);
  await page.getByTestId('trocar-senha.repita').fill(nova);
  await page.getByTestId('trocar-senha.salvar').click();
}

async function abrirAbaEmpresa(page: Page, base: string) {
  // o admin do cliente já cai na página da empresa ao entrar: o `#empresa` no mesmo endereço não recarrega, então clica na aba
  await page.goto(`${base}/empresas/${UMA}`);
  await semDevOverlay(page);
  await expect(async () => {
    await page.getByTestId('empresa-pagina.aba-empresa').click();
    await expect(page.getByTestId('empresa-plano.cartao')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 90000 });
  await expect(page.getByTestId('empresa-cadastro.editar')).toBeVisible({ timeout: 60000 });
}

for (const host of HOSTS) {
  test.describe(`portal ${host.nome} com a API pelo page.route`, () => {
    for (const quem of ['time', 'admin'] as const) {
      const rotulo = quem === 'time' ? 'time Macuxi' : 'admin do cliente';
      test(`01b ${rotulo}: troca pela sessão (só as senhas, com o token do portal): 401 não derruba (nem ao recarregar); 423; 409; 422; 204 → Entrar com o aviso`, async ({
        browser,
      }) => {
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
        const api = await apiDoPortal(ctx, {
          quem,
          trocaPortal: [
            { status: 401, corpo: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Senha atual incorreta.' } },
            {
              status: 423,
              corpo: { codigo: 'BLOQUEADO', mensagem: 'Bloqueado.', detalhes: { minutos_restantes: 7 } },
            },
            { status: 409, corpo: { codigo: 'SENHA_MUDOU', mensagem: 'A senha mudou.' } },
            {
              status: 422,
              corpo: { codigo: 'RN-CORE-34', mensagem: 'A senha nova precisa ser diferente da atual.' },
            },
            { status: 204 },
          ],
        });
        const page = await ctx.newPage();
        await entrar(page, host.base, quem === 'time' ? 'time@macuxi.com.br' : 'admin@uma.com.br');
        const nome = quem === 'time' ? 'Carla Menezes' : 'Paulo Ribeiro';

        await abrirTrocaDeSenha(page);
        // a sessão diz quem é: nem e-mail nem código da empresa na gaveta
        await expect(page.getByTestId('trocar-senha.email')).toHaveCount(0);
        await expect(page.getByTestId('trocar-senha.codigo')).toHaveCount(0);
        // 401: aviso na gaveta, a sessão do portal fica
        await pedirTroca(page, 'Errada-123');
        await expect(page.getByTestId('trocar-senha.aviso')).toHaveText(
          'A senha atual está errada. Digite de novo.',
        );
        expect(api.trocaPortal[0]?.corpo).toEqual({
          senha_atual: 'Errada-123',
          senha_nova: 'Nova-senha-123',
        });
        expect(api.trocaPortal[0]?.cabecalhos.authorization).toMatch(
          new RegExp(`^Bearer token-portal-e2e-${quem}-\\d+-`),
        );
        await page.reload();
        await expect(page.getByTestId('menu-usuario.titulo')).toHaveText(nome, { timeout: 60000 });
        await expect(page.getByTestId('entrar.email')).toHaveCount(0);
        await semDevOverlay(page);

        await abrirTrocaDeSenha(page);
        // 423: bloqueio com os minutos
        await pedirTroca(page, 'Senha-atual-1');
        await expect(page.getByTestId('trocar-senha.aviso')).toContainText('7');
        // 409: a senha mudou durante a troca
        await pedirTroca(page, 'Senha-atual-1');
        await expect(page.getByTestId('trocar-senha.aviso')).toHaveText(
          'A senha mudou enquanto você a trocava. Saia, entre de novo e repita a troca.',
        );
        // 422 RN-CORE-34: a sessão fica
        await pedirTroca(page, 'Senha-atual-1');
        await expect(page.getByTestId('trocar-senha.aviso')).toContainText(/diferente/i);
        await expect(page.getByTestId('menu-usuario.botao')).toBeVisible();
        // 204: a sessão cai e a entrada mostra o aviso (sem o "Sua sessão terminou")
        await pedirTroca(page, 'Senha-atual-1');
        await expect(page.getByTestId('entrar.aviso')).toHaveText('Senha trocada. Entre de novo.', {
          timeout: 30000,
        });
        expect(api.trocaPortal).toHaveLength(5);
        for (const t of api.trocaPortal)
          expect(Object.keys(t.corpo as object).sort()).toEqual(['senha_atual', 'senha_nova']);
        // a rota pública do Core (v1.0.34) saiu do portal
        expect(api.trocaPublica).toHaveLength(0);
        await semTokenDeRenovacao(page);
        // voltar a uma página interna não reabre o portal
        await page.goto(`${host.base}/empresas`);
        await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 30000 });
        await ctx.close();
      });
    }

    test('01b admin do cliente: 403 EMPRESA_NAO_PERMITIDA na troca (1 empresa) → entrada com o aviso da empresa', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const api = await apiDoPortal(ctx, {
        quem: 'admin',
        trocaPortal: [
          {
            status: 403,
            corpo: { codigo: 'EMPRESA_NAO_PERMITIDA', mensagem: 'Empresa não permitida.' },
          },
        ],
      });
      const page = await ctx.newPage();
      await entrar(page, host.base, 'admin@uma.com.br');
      await abrirTrocaDeSenha(page);
      await pedirTroca(page, 'Senha-atual-1');
      await expect(page.getByTestId('entrar.aviso')).toHaveText(
        'Esta empresa não está mais disponível para você.',
        { timeout: 30000 },
      );
      expect(api.trocaPortal).toHaveLength(1);
      expect(api.trocaPublica).toHaveLength(0);
      await ctx.close();
    });

    test('01b admin do cliente sem empresa escolhida (2 empresas): a Escolha não tem o menu e não chama a troca', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const api = await apiDoPortal(ctx, { quem: 'admin', semEscolha: true });
      const page = await ctx.newPage();
      await page.goto(`${host.base}/entrar`);
      await page.getByTestId('entrar.email').fill('admin@uma.com.br');
      await page.getByTestId('entrar.senha').fill('Senha#Forte2026');
      await page.getByTestId('entrar.entrar').click();
      await expect(page.getByTestId('escolher.tela')).toBeVisible({ timeout: 90000 });
      await expect(page.getByTestId('escolher.empresa-AM4821')).toBeVisible();
      await expect(page.getByTestId('menu-usuario.botao')).toHaveCount(0);
      await expect(page.getByTestId('menu-usuario.trocar-senha')).toHaveCount(0);
      expect(api.trocaPortal).toHaveLength(0);
      expect(api.trocaPublica).toHaveLength(0);
      await ctx.close();
    });

    test('04 valor × regra no cartão do plano: valor anual pela RN-PLA-06, "N de M" e o selo (acima, no limite, nenhum)', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await apiDoPortal(ctx, { quem: 'admin' });
      const page = await ctx.newPage();
      await entrar(page, host.base, 'admin@uma.com.br');
      await abrirAbaEmpresa(page, host.base);
      const esperado = valorPelaRegra('anual', ADICIONAIS);
      // 1.197,00 + 3 × 80,00 + 10 × 10,00 = 1.537,00 por mês; × (12 − 2) = 15.370,00 por ano
      expect(esperado.por_ciclo_centavos).toBe(1_537_000);
      await expect(page.getByTestId('empresa-plano.valor')).toHaveText(
        `${brl(esperado.por_ciclo_centavos)}/ano`,
      );
      for (const l of LICENCAS) {
        const bloco = page.getByTestId(`empresa-plano.uso-${l.item}`);
        if (l.contratadas === 0) {
          await expect(bloco).toHaveCount(0);
          continue;
        }
        await expect(bloco).toContainText(String(l.em_uso));
        await expect(bloco).toContainText(l.contratadas === null ? 'sem limite' : `de ${l.contratadas}`);
        const selo = page.getByTestId(`empresa-plano.limite-${l.item}`);
        if (l.contratadas === null || l.em_uso < l.contratadas) await expect(selo).toHaveCount(0);
        else await expect(selo).toHaveText(l.em_uso === l.contratadas ? 'no limite' : 'acima do contratado');
      }
      await ctx.close();
    });
  });
}

for (const caso of [
  // 23:30 de 25/11 em UTC = 19:30 de 25/11 em Manaus (UTC−4); 02:10 UTC de 26/11 = 22:10 de 25/11 em Boa Vista (UTC−4) e 23:10
  // de 25/11 em São Paulo (UTC−3): virada de dia em UTC
  { fuso: 'America/Manaus', expira: '2026-11-25T23:30:00.000Z', texto: '25/11 às 19:30' },
  { fuso: 'America/Boa_Vista', expira: '2026-11-26T02:10:00.000Z', texto: '25/11 às 22:10' },
  { fuso: 'America/Sao_Paulo', expira: '2026-11-26T02:10:00.000Z', texto: '25/11 às 23:10' },
]) {
  test(`04 Apps (${caso.fuso}): validade "até DD/MM às HH:MM" no fuso da empresa, no Campo e no Gestão`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'UTC' });
    await apiDoPortal(ctx, { quem: 'time', fuso: caso.fuso, expiraApp: caso.expira });
    const page = await ctx.newPage();
    await entrar(page, HOSTS[1].base, 'time@macuxi.com.br');
    await abrirAbaEmpresa(page, HOSTS[1].base);
    for (const v of ['campo', 'gestao']) {
      await page.getByTestId(`empresa-pagina.baixar-${v}-gerar`).click();
      const link = page.getByTestId(`empresa-pagina.baixar-${v}-link`);
      await expect(link).toBeVisible({ timeout: 30000 });
      await expect(link).toContainText(`O link vale até ${caso.texto}.`);
    }
    await ctx.close();
  });
}

test('04 Dados da empresa (admin): Receita fora (503) avisa sem mexer; razão social vazia sem chamar a API; 422 da API no campo; PUT com as 11 chaves; sem a rota da marca', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const api = await apiDoPortal(ctx, {
    quem: 'admin',
    cnpj: {
      status: 503,
      corpo: { codigo: 'CNPJ_FONTE_FORA', mensagem: 'A consulta à Receita está fora do ar.' },
    },
    cadastro422: true,
  });
  const page = await ctx.newPage();
  await entrar(page, HOSTS[1].base, 'admin@uma.com.br');
  await abrirAbaEmpresa(page, HOSTS[1].base);
  await page.getByTestId('empresa-cadastro.editar').click();
  await page.getByTestId('empresa-cadastro.campo-logradouro').fill('Rua Digitada');
  await page.getByTestId('empresa-cadastro.receita').click();
  await expect(page.getByTestId('empresa-cadastro.aviso')).toHaveText('A Receita não respondeu.', {
    timeout: 30000,
  });
  expect(api.cnpj).toEqual([{ cnpj: CNPJ }]);
  await expect(page.getByTestId('empresa-cadastro.campo-logradouro')).toHaveValue('Rua Digitada');
  await expect(page.getByTestId('empresa-cadastro.campo-municipio')).toHaveValue('');

  // razão social vazia: o aviso de obrigatório no campo, sem chamar a API
  await page.getByTestId('empresa-cadastro.campo-razao_social').fill('');
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(page.getByRole('dialog', { name: 'Dados da empresa' })).toContainText(
    'Informe a razão social.',
  );
  expect(api.putCadastro).toHaveLength(0);
  await page.getByTestId('empresa-cadastro.campo-razao_social').fill('Distribuidora Uma Ltda');

  // 422 da API: a frase embaixo do campo, a gaveta fica aberta
  await page.getByTestId('empresa-cadastro.campo-municipio').fill('Recife');
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(page.getByRole('dialog', { name: 'Dados da empresa' })).toContainText(
    'Município não confere com a UF.',
    { timeout: 30000 },
  );
  await expect(page.getByTestId('empresa-cadastro.campo-municipio')).toHaveAttribute('aria-invalid', 'true');
  expect(api.putCadastro).toHaveLength(1);
  // as 11 chaves, sem CNPJ nem nome fantasia
  expect(Object.keys(api.putCadastro[0] as object).sort()).toEqual([
    'bairro',
    'cep',
    'complemento',
    'email',
    'inscricao_estadual',
    'logradouro',
    'municipio',
    'numero',
    'razao_social',
    'telefone',
    'uf',
  ]);
  // o admin do cliente nunca chama a rota da marca
  expect(api.putMarca).toHaveLength(0);
  await ctx.close();
});

test('04 Dados da empresa (time Macuxi): "5 campos preenchidos"; a Receita não troca o nome já gravado; nada grava sem o Salvar; sem a rota da marca', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const api = await apiDoPortal(ctx, { quem: 'time' });
  const page = await ctx.newPage();
  await entrar(page, HOSTS[0].base, 'time@macuxi.com.br');
  await abrirAbaEmpresa(page, HOSTS[0].base);
  await page.getByTestId('empresa-cadastro.editar').click();
  await page.getByTestId('empresa-cadastro.campo-logradouro').fill('Rua Digitada');
  await page.getByTestId('empresa-cadastro.receita').click();
  await expect(page.getByTestId('empresa-cadastro.aviso')).toHaveText(
    '5 campos preenchidos com os dados da Receita. Confira e salve.',
    { timeout: 30000 },
  );
  // digitado e já gravado ficam; vazios recebem a Receita; a razão social (preenchida) e o nome fantasia não mudam
  await expect(page.getByTestId('empresa-cadastro.campo-logradouro')).toHaveValue('Rua Digitada');
  await expect(page.getByTestId('empresa-cadastro.campo-bairro')).toHaveValue('Centro');
  await expect(page.getByTestId('empresa-cadastro.campo-telefone')).toHaveValue('(92) 3633-0000');
  await expect(page.getByTestId('empresa-cadastro.campo-razao_social')).toHaveValue('Distribuidora Uma Ltda');
  await expect(page.getByTestId('empresa-cadastro.campo-nome_fantasia')).toHaveValue('Uma');
  await expect(page.getByTestId('empresa-cadastro.campo-numero')).toHaveValue('100');
  await expect(page.getByTestId('empresa-cadastro.campo-municipio')).toHaveValue('Manaus');
  await expect(page.getByTestId('empresa-cadastro.campo-uf')).toHaveValue('AM');
  await expect(page.getByTestId('empresa-cadastro.campo-cep')).toHaveValue('69050-010');
  await expect(page.getByTestId('empresa-cadastro.campo-email')).toHaveValue('receita@uma.com.br');
  await expect(page.getByTestId('empresa-cadastro.campo-complemento')).toHaveValue('');
  // nada gravou sem o Salvar
  expect(api.putCadastro).toHaveLength(0);
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(page.getByRole('dialog', { name: 'Dados da empresa' })).toHaveCount(0, { timeout: 30000 });
  expect(api.putCadastro).toHaveLength(1);
  expect(api.putMarca).toHaveLength(0);
  await ctx.close();
});
