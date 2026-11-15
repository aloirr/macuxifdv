/**
 * ADR 0058 — menu do BKO com Parâmetros, item direto e vitrine sem licença (spec docs/design/menu-parametros/spec.md §2–§3).
 *
 * Roda só com o BKO no ar (`pnpm --filter web dev`), SEM a API: as respostas de `/api-proxy/*` são simuladas aqui
 * (`page.route`), para fixar a licença da empresa (`modulos_contratados` de `GET /v1/me/modulos`) e o perfil. A sessão é a do
 * `localStorage` (`macuxi.web.user`) com a renovação pelo cookie simulada (`POST /auth/refresh`). Rodar na raiz:
 * `MACUXI_BKO_URL=http://localhost:3000 pnpm test:e2e tests/e2e/bko/menu-parametros.spec.ts`.
 * Cenário padrão: empresa sem Pesquisa e Treinamento, com Trade (Promotor); perfil Administrador (como as simulações da spec).
 * A API revalida perfil, ação e licença em toda rota (RN-CORE-01): isso é coberto pelos testes de integração da API, não aqui.
 */
import { expect, test, type Page } from '@playwright/test';

type Perfil = 'admin' | 'analista' | 'gerente';

interface Cenario {
  perfil?: Perfil;
  /** Módulos efetivos do usuário (`modulos` de `/v1/me/modulos`). */
  ativos?: string[];
  /** `modulos_contratados` (licença da empresa); `null` = a API não manda o campo. */
  contratados?: string[] | null;
}

const PADRAO = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'];
const TODOS = [...PADRAO, 'pesquisa', 'treinamento'];
const TEXTO_SEM_LICENCA = 'Contrate o módulo para usar';

/** Dados mínimos das telas abertas aqui (o resto responde 404 e a tela mostra o erro dela, sem afetar o menu). */
const DADOS: Readonly<Record<string, unknown>> = {
  '/core/parametros/farol': {
    verde_ate_dias: 30,
    amarelo_ate_dias: 45,
    positivacao_verde_pct: 70,
    positivacao_amarelo_pct: 50,
  },
  '/core/parametros/curvas-abc': {
    faturamento: { a_min_pct: 20, b_min_pct: 0 },
    volume: { a_min_pct: 20, b_min_pct: 0 },
    frequencia: { a_min_pct: 20, b_min_pct: 0 },
  },
  '/core/perfis': { itens: [] },
  '/core/usuarios': { itens: [] },
  '/core/parametros/promotor-ve-pedidos': { ligado: true },
  '/vendedor/alcadas': {
    seller_pct: 5,
    supervisor_pct: 10,
    manager_pct: 15,
    above_manager: 'block',
    exceptions: [],
  },
  '/promotor/cadastros/parametros': {
    validade_critica_dias: 7,
    validade_proxima_dias: 30,
    peso_parcial_conformidade: 0,
    permanencia_min_min: 10,
    variacao_preco_max_pct: 50,
  },
};

async function entrarSimulado(page: Page, c: Cenario = {}) {
  const perfil = c.perfil ?? 'admin';
  const ativos = c.ativos ?? PADRAO;
  const contratados = c.contratados === undefined ? PADRAO : c.contratados;
  const usuario = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Teste',
    email: `${perfil}@exemplo.com.br`,
    perfil,
    empresa: 'Empresa Teste',
    fuso: 'America/Manaus',
  };
  await page.addInitScript((u) => window.localStorage.setItem('macuxi.web.user', JSON.stringify(u)), usuario);
  await page.route('**/api-proxy/**', async (r) => {
    const caminho = new URL(r.request().url()).pathname.replace(/^\/api-proxy/, '');
    const json = (status: number, corpo: unknown) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (caminho === '/auth/refresh')
      return json(200, { access_token: 'simulado', token_type: 'Bearer', expires_in: 900 });
    if (caminho === '/me/modulos') {
      return json(200, {
        modulos: ativos.map((id) => ({ id, versao: '1.0.0', parametros: {} })),
        versao_licencas: 'e2e',
        calculado_em: '2026-11-15T16:00:00.000Z',
        ...(contratados ? { modulos_contratados: contratados } : {}),
      });
    }
    if (r.request().method() === 'GET' && caminho in DADOS) return json(200, DADOS[caminho]);
    return json(404, { codigo: 'NAO_SIMULADO', mensagem: 'Não simulado no e2e.' });
  });
}

/** Linhas de 1º nível do menu lateral (grupo, item direto ou entrada com cadeado), na ordem da tela. */
async function primeiroNivel(page: Page): Promise<string[]> {
  const menu = page.getByTestId('menu-bko');
  await expect(menu.getByTestId('nav-plataforma-parametros')).toBeVisible({ timeout: 60_000 });
  return menu
    .locator(
      '[data-testid^="nav-grupo-"], [data-testid="nav-plataforma-parametros"], [data-testid="nav-pesquisa-pesquisas"], [data-testid="nav-treinamento-trilhas"]',
    )
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
}

/** Itens do grupo (abre o grupo na sanfona; com tudo aberto o clique no título não faz nada). */
async function itensDoGrupo(page: Page, grupo: string): Promise<string[]> {
  const menu = page.getByTestId('menu-bko');
  const lista = menu.locator(`#menu-grupo-${grupo}`);
  if (!(await lista.isVisible())) await menu.getByTestId(`nav-grupo-${grupo}`).click();
  await expect(lista).toBeVisible();
  return lista
    .locator('[data-testid^="nav-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

test.describe('ADR 0058 — menu do BKO (API simulada)', () => {
  test('ordem e forma (D1, D9): alfabética, Parâmetros e Sistema no fim; Pesquisa, Treinamento e Parâmetros são itens diretos', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/');
    const linhas = await primeiroNivel(page);
    expect(linhas).toEqual([
      'Acesso',
      'Análise',
      'Cadastros',
      'Comunicação',
      'Operação',
      'Pesquisa',
      'Produtos',
      'Trade',
      'Treinamento',
      'Parâmetros',
      'Sistema',
    ]);
    const alfabeticas = linhas.slice(0, -2);
    expect(alfabeticas).toEqual(
      [...alfabeticas].sort((a, b) => semAcento(a).localeCompare(semAcento(b), 'pt-BR')),
    );
    // saíram os grupos Comercial (D4) e Conteúdo de campo
    for (const g of ['comercial', 'conteudo_campo', 'pesquisa', 'treinamento', 'parametros'])
      await expect(page.getByTestId(`nav-grupo-${g}`), g).toHaveCount(0);
    // D9: nenhum grupo com um item só
    for (const g of [
      'acesso',
      'analise',
      'cadastros',
      'comunicacao',
      'operacao',
      'produtos',
      'trade',
      'sistema',
    ]) {
      expect((await itensDoGrupo(page, g)).length, g).toBeGreaterThanOrEqual(2);
    }
  });

  test('Cadastros tem Formas de pagamento e prazos e Transportadoras (D4, D11); Trade tem Cadastros e Indicadores (D7, D8)', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/');
    await primeiroNivel(page);
    const cadastros = await itensDoGrupo(page, 'cadastros');
    expect(cadastros).toEqual(
      expect.arrayContaining(['nav-vendedor-formas-pagamento', 'nav-vendedor-transportadoras']),
    );
    const trade = await itensDoGrupo(page, 'trade');
    expect(trade).toEqual(['nav-promotor-cadastros', 'nav-promotor-trade']);
    await expect(page.getByTestId('nav-promotor-cadastros')).toHaveText('Cadastros');
    await expect(page.getByTestId('nav-promotor-trade')).toHaveText('Indicadores');
    // Alçadas, Perfis, Motivos, Fotos do PDV e Plano de RV saíram do menu (painéis de Parâmetros)
    for (const n of [
      'nav-vendedor-alcadas',
      'nav-core-perfis',
      'nav-core-motivos',
      'nav-core-fotos-pdv',
      'nav-core-plano-rv',
      'nav-gestor-regras-alerta',
    ])
      await expect(page.getByTestId(n), n).toHaveCount(0);
  });

  test('sem licença da empresa: Pesquisa e Treinamento com cadeado, aria-disabled, não navegam e mostram "Contrate o módulo para usar"', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    for (const id of ['nav-pesquisa-pesquisas', 'nav-treinamento-trilhas']) {
      const entrada = page.getByTestId(id);
      await expect(entrada, id).toHaveAttribute('aria-disabled', 'true');
      await expect(entrada, id).toHaveAttribute('tabindex', '0');
      await expect(entrada, id).not.toHaveAttribute('href', /.*/);
      await entrada.hover();
      const dica = page.locator(`#${await entrada.getAttribute('aria-describedby')}`);
      await expect(dica).toBeVisible();
      await expect(dica).toHaveText(TEXTO_SEM_LICENCA);
      // o Playwright não clica em `aria-disabled` sem `force`; o usuário clica, e o clique não pode navegar
      await entrada.click({ force: true });
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/parametros\/clientes$/);
      await page.mouse.move(900, 450);
      await expect(dica).toBeHidden();
    }
    // a seção de Parâmetros do módulo sem licença aparece com cadeado; escolhida, mostra só o aviso
    await page.getByTestId('parametros-secao-pesquisa').click();
    await expect(page).toHaveURL(/\/parametros\/pesquisa$/);
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveText(TEXTO_SEM_LICENCA);
    await expect(page.getByTestId('parametros-secao-treinamento')).toHaveAttribute('data-bloqueado', '');
    await expect(page.getByTestId('parametros-secao-trade')).not.toHaveAttribute('data-bloqueado', '');
  });

  test('com licença: Pesquisa e Treinamento navegam e as seções mostram os painéis (só leitura, P4)', async ({
    page,
  }) => {
    await entrarSimulado(page, { ativos: TODOS, contratados: TODOS });
    await page.goto('/');
    await primeiroNivel(page);
    await expect(page.getByTestId('nav-pesquisa-pesquisas')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('menu-bko').getByTestId('nav-pesquisa-pesquisas').click();
    await expect(page).toHaveURL(/\/pesquisas$/);
    await expect(page.getByTestId('pagina-pesquisa-pesquisas')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('menu-bko').getByTestId('nav-treinamento-trilhas').click();
    await expect(page.getByTestId('pagina-treinamento-trilhas')).toBeVisible({ timeout: 30_000 });
    await page.goto('/parametros/pesquisa');
    for (const p of [
      'parametros-pesquisa-vigencia',
      'parametros-pesquisa-construtor',
      'parametros-pesquisa-fotos',
    ])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    await page.goto('/parametros/treinamento');
    for (const p of [
      'parametros-treinamento-quiz-licao',
      'parametros-treinamento-xp',
      'parametros-treinamento-niveis-ranking',
    ])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveCount(0);
  });

  test('P3: empresa com a licença e perfil sem o módulo — a entrada e a seção somem (permissão, não contratação)', async ({
    page,
  }) => {
    await entrarSimulado(page, { ativos: PADRAO, contratados: TODOS });
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    for (const id of [
      'nav-pesquisa-pesquisas',
      'nav-treinamento-trilhas',
      'parametros-secao-pesquisa',
      'parametros-secao-treinamento',
    ])
      await expect(page.getByTestId(id), id).toHaveCount(0);
  });

  test('API sem `modulos_contratados`: nada aparece desativado (campo aditivo; a vitrine depende da API)', async ({
    page,
  }) => {
    await entrarSimulado(page, { contratados: null });
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    await expect(page.locator('[data-bloqueado]')).toHaveCount(0);
    await expect(page.getByTestId('nav-pesquisa-pesquisas')).toHaveCount(0);
  });

  test('links antigos redirecionam para a seção de Parâmetros com a âncora do painel', async ({ page }) => {
    await entrarSimulado(page);
    for (const [antigo, destino, painel] of [
      ['/perfis', '/parametros/acesso#core-perfis', 'parametros-core-perfis'],
      [
        '/usuarios-e-modulos',
        '/parametros/acesso#core-usuarios-e-modulos',
        'parametros-core-usuarios-e-modulos',
      ],
      ['/motivos', '/parametros/visitas#core-motivos', 'parametros-core-motivos'],
      ['/fotos-pdv', '/parametros/visitas#core-fotos-pdv', 'parametros-core-fotos-pdv'],
      ['/plano-rv', '/parametros/metas-e-rv#core-plano-rv', 'parametros-core-plano-rv'],
      ['/alcadas', '/parametros/pedidos#vendedor-alcadas', 'parametros-vendedor-alcadas'],
      ['/regras-alerta', '/parametros/alertas#gestor-regras-alerta', 'parametros-gestor-regras-alerta'],
    ] as const) {
      await page.goto(antigo);
      await expect(page, antigo).toHaveURL(new RegExp(`${destino.replace(/[/#]/g, '\\$&')}$`), {
        timeout: 60_000,
      });
      await expect(page.getByTestId(painel), antigo).toBeVisible({ timeout: 30_000 });
    }
    // `/formas-pagamento` fica como está (D11)
    await page.goto('/formas-pagamento');
    await expect(page.getByTestId('pagina-vendedor-formas-pagamento')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/formas-pagamento$/);
  });

  test('item Parâmetros: /parametros abre a primeira seção disponível; Alçadas em Pedidos, Farol e Curvas ABC em Clientes', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/');
    await page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros').click();
    await expect(page).toHaveURL(/\/parametros\/acesso$/, { timeout: 30_000 });
    await expect(page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByTestId('parametros-secao-clientes').click();
    await expect(page.getByTestId('parametros-core-farol')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('parametros-core-curvas-abc')).toBeVisible();
    await expect(page.getByTestId('parametros-secao-clientes')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('parametros-secao-pedidos').click();
    await expect(page.getByTestId('parametros-vendedor-alcadas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('alcadas.tabela')).toContainText('Até 5,0%');
    await expect(page.getByTestId('alcadas.tabela')).toContainText('Acima de 15,0%');
  });

  test('permissão: perfil sem a ação não vê o painel (analista sem foto_tipo.editar, parametro.checkout_pendencia e modulo.gerir_licencas)', async ({
    page,
  }) => {
    await entrarSimulado(page, { perfil: 'analista' });
    await page.goto('/parametros/visitas');
    await expect(page.getByTestId('parametros-core-motivos')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('parametros-core-fotos-pdv')).toHaveCount(0);
    await expect(page.getByTestId('parametros-core-etapa-pendente')).toHaveCount(0);
    await page.goto('/parametros/acesso');
    await expect(page.getByTestId('parametros-core-usuarios-e-modulos')).toHaveCount(0);
    await expect(page.getByTestId('parametros-core-promotor-pedidos')).toHaveCount(0);
  });

  test('permissão: gerente não vê a seção Clientes (sem parametro.farol nem parametro.curva_abc); a seção sem painel some', async ({
    page,
  }) => {
    await entrarSimulado(page, { perfil: 'gerente' });
    await page.goto('/');
    await primeiroNivel(page);
    await page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros').click();
    await expect(page.getByTestId('pagina-parametros')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('parametros-secao-clientes')).toHaveCount(0);
  });
});
