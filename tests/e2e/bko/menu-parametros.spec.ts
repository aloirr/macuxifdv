/**
 * ADR 0060 — menu do BKO com Parâmetros, item direto e vitrine sem licença (spec docs/design/menu-parametros/spec.md §2–§3).
 * v1.0.14: SDK (#421), Alçadas como painel (#412), Trade/Pesquisa/Treinamento só leitura (#414, #415, #416); matriz em
 * docs/testes/v1014-parametros.md. Valor × regra dos painéis só leitura: tests/modulos/parametros-valor-regra-v1014.test.ts.
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
  /** Parâmetros do tenant por módulo (`modulos[].parametros` de `/v1/me/modulos`). */
  parametros?: Readonly<Record<string, Record<string, unknown>>>;
}

const PADRAO = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'];
const TODOS = [...PADRAO, 'pesquisa', 'treinamento'];
const TEXTO_SEM_LICENCA = 'Contrate o módulo para usar';
const TODOS_INSTALADOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'];

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
  '/core/perfis': {
    itens: (
      [
        ['admin', 'Administrador', 'administrativo', 1],
        ['promotor', 'Promotor', 'promotor', 3],
        ['vendedor', 'Vendedor', 'vendedor', 8],
      ] as const
    ).map(([codigo, nome, cargo, usuarios]) => ({
      codigo,
      nome,
      descricao: null,
      base: codigo,
      fabrica: true,
      ativo: true,
      usuarios,
      onde_entra: codigo === 'admin' ? ['bko'] : ['campo'],
      cargo,
    })),
  },
  '/core/usuarios': { itens: [] },
  '/core/licencas': {
    modulos: TODOS_INSTALADOS,
    dependencias: { vendedor: ['catalogo'] },
    tenant: Object.fromEntries(TODOS_INSTALADOS.map((m) => [m, !['pesquisa', 'treinamento'].includes(m)])),
    perfis: {
      admin: ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'],
      promotor: ['core', 'catalogo', 'promotor'],
      vendedor: ['core', 'catalogo', 'vendedor'],
    },
    usuarios: [],
  },
  '/core/medidas': {
    itens: (
      [
        ['UN', 'Unidade', 12, true],
        ['CX', 'Caixa', 0, false],
      ] as const
    ).map(([sigla, descricao, em_uso, ativo], i) => ({
      id: `00000000-0000-4000-8000-00000000020${i}`,
      sigla,
      descricao,
      ativo,
      em_uso,
    })),
  },
  '/core/parametros/promotor-ve-pedidos': { ligado: true },
  '/core/parametros/inicio': { dias_uteis_semana: [1, 2, 3, 4, 5], parado_min: 60 },
  '/core/parametros/checkout-pendencia': { checkout_pendencia_alerta_h: 24 },
  '/core/parametros/calendario': { feriados: [], almoco_corte: 720, almoco_janela: [660, 900] },
  '/core/produtos': { padrao_desconto_pct: 10, itens: [] },
  '/core/motivos': { itens: [] },
  '/core/fotos-tipos': {
    itens: (
      [
        ['Fachada', true, false, true],
        ['CNH do sócio', false, true, false],
      ] as const
    ).map(([nome, obrigatorio, sensivel, fachada], i) => ({
      id: `00000000-0000-4000-8000-00000000070${i}`,
      nome,
      obrigatorio,
      sensivel,
      fachada,
      ordem: i + 1,
      ativo: true,
    })),
  },
  '/vendedor/alcadas': {
    seller_pct: 5,
    supervisor_pct: 10,
    manager_pct: 15,
    above_manager: 'block',
    exceptions: [],
  },
  // valor × regra (RN-PRO-08/11): atenção e peso do parcial diferentes do padrão (30 dias e 0) para o "Padrão: X" aparecer
  '/promotor/cadastros/parametros': {
    validade_critica_dias: 7,
    validade_proxima_dias: 45,
    peso_parcial_conformidade: 0.5,
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
        modulos: ativos.map((id) => ({ id, versao: '1.0.0', parametros: c.parametros?.[id] ?? {} })),
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

test.describe('ADR 0060 — menu do BKO (API simulada)', () => {
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
    // Alçadas (#412) saiu do menu: do Vendedor ficam só Cadastros (Formas de pagamento, Transportadoras) e Operação › Pedidos
    const doVendedor: string[] = [];
    for (const g of ['acesso', 'analise', 'cadastros', 'comunicacao', 'operacao', 'produtos', 'trade', 'sistema'])
      doVendedor.push(...(await itensDoGrupo(page, g)).filter((n) => n.startsWith('nav-vendedor-')));
    doVendedor.sort();
    expect(doVendedor).toEqual(['nav-vendedor-formas-pagamento', 'nav-vendedor-pedidos', 'nav-vendedor-transportadoras']);
    // Perfis, Motivos, Fotos do PDV, Plano de RV e Regras de alerta saíram do menu (painéis de Parâmetros)
    for (const n of [
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

  test('com licença: Pesquisa e Treinamento navegam e as seções mostram os painéis (só leitura, P4)', async ({ page }) => {
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
    for (const p of ['parametros-pesquisa-vigencia', 'parametros-pesquisa-construtor', 'parametros-pesquisa-fotos'])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    // padrão do tenant: valor do contrato, milhar pt-BR, sem "Padrão: X" (P4)
    const construtor = page.getByTestId('parametros-pesquisa-construtor-valores');
    await expect(construtor).toContainText('Perguntas por questionário50');
    await expect(construtor).toContainText('Texto2.000 caracteres');
    await expect(construtor).not.toContainText('Padrão:');
    const conteudoPes = page.getByTestId('parametros-conteudo-pesquisa');
    await expect(conteudoPes.locator('input, select, textarea')).toHaveCount(0);
    await expect(conteudoPes.getByRole('button', { name: /Salvar/ })).toHaveCount(0);
    await page.goto('/parametros/treinamento');
    for (const p of ['parametros-treinamento-quiz-licao', 'parametros-treinamento-xp', 'parametros-treinamento-niveis-ranking'])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    const quiz = page.getByTestId('treinamento-quiz-licao');
    await expect(quiz).toContainText('Nota mínima70%');
    await expect(quiz).toContainText('Tentativas por dia3');
    await expect(quiz).not.toContainText('Padrão:');
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveCount(0);
  });

  // D-PAR-04 (alta, valor × regra; engenheiro-apps, apps/web/lib/ambiente.ts): o ambiente do BKO não tem `parametros`, e o
  // `useParametros` dos painéis de Pesquisa e Treinamento devolve `{}`: a tela mostra sempre o padrão (50 perguntas, 70%),
  // mesmo com o tenant em 30 e 80% (os valores que a API aplica). Corrige quando o shell passar ao `ShellProvider` os
  // `modulos[].parametros` de `/v1/me/modulos`; aí este caso fica vermelho e vira `test` normal.
  test.fail('D-PAR-04: painéis de Pesquisa e Treinamento mostram o valor do tenant e "Padrão: X" só no que mudou (RN-PES-07)', async ({ page }) => {
    await entrarSimulado(page, {
      ativos: TODOS,
      contratados: TODOS,
      parametros: { pesquisa: { max_perguntas: 30 }, treinamento: { nota_minima_pct: 80 } },
    });
    await page.goto('/parametros/pesquisa');
    const construtor = page.getByTestId('parametros-pesquisa-construtor-valores');
    await expect(construtor).toBeVisible({ timeout: 30_000 });
    await expect(construtor).toContainText('Perguntas por questionário30Padrão: 50', { timeout: 10_000 });
    await expect(construtor).not.toContainText('Padrão: 2.000');
    await page.goto('/parametros/treinamento');
    const quiz = page.getByTestId('treinamento-quiz-licao');
    await expect(quiz).toContainText('Nota mínima80%Padrão: 70%', { timeout: 30_000 });
    await expect(quiz).not.toContainText('Padrão: 3');
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
    // valor × regra (RN-VEN-10, política simulada 5/10/15% e acima bloqueia): uma linha por nível, faixa × quem aprova
    const linhas = page.getByTestId('alcadas.tabela').locator('tbody tr');
    await expect(linhas).toHaveCount(4);
    for (const [i, faixa, quem] of [
      [0, 'Até 5,0%', 'Vendedor (aprovado na hora)'],
      [1, 'Até 10,0%', 'Supervisor'],
      [2, 'Até 15,0%', 'Gerente'],
      [3, 'Acima de 15,0%', 'Bloqueado: o vendedor não consegue enviar'],
    ] as const) {
      await expect(linhas.nth(i).locator('td').nth(0), faixa).toHaveText(faixa);
      await expect(linhas.nth(i).locator('td').nth(1), quem).toHaveText(quem);
    }
    // D5: o painel mostra só os limites (o título "Alçadas" é do painel; as decisões recentes ficam em Operação › Pedidos)
    const painel = page.getByTestId('parametros-vendedor-alcadas');
    // (só um título: o do painel; a página de antes tinha "Alçadas de desconto" e "Limites por nível")
    await expect(painel.getByRole('heading')).toHaveText(['Alçadas']);
    await expect(page.getByTestId('alcadas.decisoes')).toHaveCount(0);
  });

  test('Parâmetros › Trade: três painéis só leitura com o valor do tenant e "Padrão: X" só no que mudou (RN-PRO-04/07/08/11)', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/parametros/trade');
    for (const p of ['parametros-promotor-validade', 'parametros-promotor-visita-coleta', 'parametros-promotor-gondola'])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    const valor = (chave: string) => page.getByTestId(`promotor.parametro.${chave}`);
    await expect(valor('validade_critica_dias')).toHaveText('7 dias');
    await expect(valor('validade_proxima_dias')).toHaveText('45 diasPadrão: 30 dias');
    await expect(valor('permanencia_min_min')).toHaveText('10 min');
    await expect(valor('variacao_preco_max_pct')).toHaveText('50%');
    await expect(valor('peso_parcial_conformidade')).toHaveText('50%Padrão: 0%');
    // só leitura (P4): nada editável nem Salvar na seção
    const conteudo = page.getByTestId('parametros-conteudo-trade');
    await expect(conteudo.locator('input, select, textarea')).toHaveCount(0);
    await expect(conteudo.getByRole('button', { name: /Salvar/ })).toHaveCount(0);
  });

  test('Trade sem licença da empresa: o grupo inteiro vira entrada com cadeado e a seção de Parâmetros mostra só o aviso', async ({
    page,
  }) => {
    const semTrade = PADRAO.filter((m) => m !== 'promotor');
    await entrarSimulado(page, { ativos: semTrade, contratados: semTrade });
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    const trade = page.getByTestId('nav-grupo-trade');
    await expect(trade).toHaveAttribute('aria-disabled', 'true');
    await expect(trade).toHaveAttribute('data-bloqueado', '');
    await trade.click({ force: true });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/parametros\/clientes$/);
    for (const n of ['nav-promotor-cadastros', 'nav-promotor-trade']) await expect(page.getByTestId(n), n).toHaveCount(0);
    await page.getByTestId('parametros-secao-trade').click();
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveText(TEXTO_SEM_LICENCA);
    await expect(page.getByTestId('parametros-promotor-validade')).toHaveCount(0);
  });

  test('endereço digitado sem licença não abre a página (a vitrine é só exibição; a API responde 403 MODULO_INATIVO)', async ({
    page,
  }) => {
    await entrarSimulado(page);
    for (const [url, pagina] of [
      ['/pesquisas', 'pagina-pesquisa-pesquisas'],
      ['/trilhas', 'pagina-treinamento-trilhas'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId('menu-bko')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId(pagina), url).toHaveCount(0);
    }
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

  test('transição sem duplicar: Perfis, Módulos, Motivos e Fotos do PDV aparecem uma vez, como painel do core', async ({
    page,
  }) => {
    await entrarSimulado(page);
    for (const [secao, paineis] of [
      ['acesso', ['core-perfis', 'core-usuarios-e-modulos']],
      ['visitas', ['core-motivos', 'core-fotos-pdv']],
    ] as const) {
      await page.goto(`/parametros/${secao}`);
      for (const p of paineis) {
        await expect(page.getByTestId(`parametros-${p}`), p).toHaveCount(1, { timeout: 30_000 });
        await expect(page.locator(`[id="${p}"]`), `âncora ${p}`).toHaveCount(1);
      }
    }
    await page.goto('/parametros/acesso');
    await expect(
      page
        .getByTestId('parametros-core-usuarios-e-modulos')
        .getByRole('heading', { name: 'Módulos', exact: true }),
    ).toHaveCount(1);
  });

  test('Salvar só com alteração e com o nome do que salva (farol, curvas, dias úteis, desconto, etapa pendente, almoço)', async ({
    page,
  }) => {
    await entrarSimulado(page);
    for (const [secao, botao, rotulo] of [
      ['clientes', 'farol-params.salvar', 'Salvar farol'],
      ['clientes', 'curvas-abc-params.salvar', 'Salvar curvas'],
      ['inicio', 'inicio-params.salvar', 'Salvar dias úteis'],
      ['produtos', 'produtos.parametro-salvar', 'Salvar desconto'],
      ['visitas', 'checkout-pendencia.salvar', 'Salvar prazo'],
      ['calendario', 'calendario.almoco.salvar', 'Salvar almoço'],
    ] as const) {
      await page.goto(`/parametros/${secao}`);
      const b = page.getByTestId(botao);
      await expect(b, botao).toBeVisible({ timeout: 30_000 });
      await expect.soft(b, `${botao} sem alteração`).toBeDisabled();
      await expect.soft(b, botao).toHaveText(rotulo);
    }
    // etapa pendente: o rótulo do campo diz o que o número é (horas até avisar)
    await page.goto('/parametros/visitas');
    await expect(page.getByTestId('parametros-core-etapa-pendente')).toContainText('Prazo para avisar', {
      timeout: 30_000,
    });
  });

  test('link antigo /usuarios-e-modulos?nivel=perfil&perfil=promotor: a query vai junto ao destino e não abre a edição em Perfis', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/usuarios-e-modulos?nivel=perfil&perfil=promotor');
    await expect(page).toHaveURL(/\/parametros\/acesso\?nivel=perfil&perfil=promotor#core-usuarios-e-modulos$/, {
      timeout: 60_000,
    });
    const modulos = page.getByTestId('parametros-core-usuarios-e-modulos');
    await expect(modulos.getByTestId('licencas.nivel.perfil')).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });
    // `nivel` é do painel Módulos: o `perfil` do link antigo não vira edição de perfil
    await expect(page.getByTestId('perfis.lista')).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Perfis de acesso' })).toHaveCount(0);
  });

  // D-PAR-01 (modulo-core, corrigido em f879873): o `perfil` do link antigo chega ao filtro do painel Módulos.
  test('D-PAR-01: link antigo /usuarios-e-modulos?nivel=perfil&perfil=promotor abre Módulos filtrado em Promotor', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/usuarios-e-modulos?nivel=perfil&perfil=promotor');
    const seletor = page.getByTestId('parametros-core-usuarios-e-modulos').getByTestId('licencas.seletor-perfil');
    await expect(seletor).toBeVisible({ timeout: 60_000 });
    await expect(seletor).toHaveValue('promotor', { timeout: 10_000 });
  });

  test('filtrar o perfil em Módulos (?modulos_perfil=) não abre a edição em Perfis; ?editar_perfil= abre só a edição', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/parametros/acesso?nivel=perfil');
    const seletor = page.getByTestId('licencas.seletor-perfil');
    await expect(seletor).toBeVisible({ timeout: 60_000 });
    await seletor.selectOption('promotor');
    await expect(page).toHaveURL(/[?&]modulos_perfil=promotor/);
    await expect(seletor).toHaveValue('promotor');
    await expect(page.getByTestId('perfis.lista')).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Perfis de acesso' })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('editar_perfil')).toBeNull();

    // a edição (detalhe do perfil não simulado: basta o painel sair da lista para a edição)
    await page.goto('/parametros/acesso?editar_perfil=promotor');
    await expect(page.getByRole('button', { name: '‹ Perfis de acesso' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('perfis.lista')).toHaveCount(0);
    // o painel Módulos segue no nível da empresa (não herda o perfil em edição)
    await expect(page.getByTestId('licencas.nivel.tenant')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('licencas.seletor-perfil')).toHaveCount(0);
  });

  test('Medidas sem coluna Situação (selo só para Inativa); Fotos do PDV: "Remover" só em tipo que não é a fachada', async ({
    page,
  }) => {
    await entrarSimulado(page);
    await page.goto('/parametros/produtos');
    const medidas = page.getByTestId('medidas.tela');
    await expect(medidas.getByTestId('medidas.linha.UN')).toBeVisible({ timeout: 60_000 });
    await expect(medidas.locator('th')).toHaveText(['Sigla', 'Descrição', 'Produtos', 'Ações']);
    await expect(medidas.getByTestId('medidas.linha.UN')).not.toContainText('Ativa');
    await expect(medidas.getByTestId('medidas.linha.CX')).toContainText('Inativa');

    await page.goto('/parametros/visitas');
    const fachada = '00000000-0000-4000-8000-000000000700';
    const cnh = '00000000-0000-4000-8000-000000000701';
    await expect(page.getByTestId(`fotos-pdv.editar.${fachada}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`fotos-pdv.apagar.${fachada}`)).toHaveCount(0);
    await expect(page.getByTestId(`fotos-pdv.apagar.${cnh}`)).toHaveText('Remover');
  });
});
