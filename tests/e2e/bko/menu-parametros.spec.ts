/**
 * Menu Parâmetros do BKO (ADR 0060; spec docs/design/menu-parametros/spec.md §2–§3) no navegador, com a API SIMULADA por
 * `page.route` (sem banco nem demo). Matriz: docs/testes/v1018-parametros.md. A árvore do menu, os destinos dos endereços
 * antigos e a vitrine calculados pelo shell estão nos unitários de apps/web (menu-bko, parametros, parametros-page).
 *
 * Pré-requisito: o BKO no ar (`pnpm --filter web dev`). Rodar: `pnpm test:e2e tests/e2e/bko/menu-parametros.spec.ts`
 * (`MACUXI_BKO_URL` muda o endereço; `MACUXI_PW_CANAL=` usa o Chromium do Playwright). Viewport 1366×768 (tela da spec).
 * Cenário padrão: Administrador; empresa sem Pesquisa e Treinamento, com Trade (Promotor).
 */
import { expect, test, type Page } from '@playwright/test';

type Perfil = 'admin' | 'analista' | 'gerente';

interface Cenario {
  perfil?: Perfil;
  /** Módulos efetivos do usuário (`modulos` de `/v1/me/modulos`). */
  ativos?: string[];
  /** Licença da empresa (`modulos_contratados`). */
  contratados?: string[];
}

const PADRAO = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'];
const TODOS = [...PADRAO, 'pesquisa', 'treinamento'];
const TEXTO_SEM_LICENCA = 'Contrate o módulo para usar';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Respostas das telas abertas aqui; o resto responde 404 (a tela mostra o erro dela, sem afetar o menu). */
const DADOS: Readonly<Record<string, unknown>> = {
  '/core/parametros/farol': { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 },
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
    modulos: TODOS,
    dependencias: { vendedor: ['catalogo'] },
    tenant: Object.fromEntries(TODOS.map((m) => [m, PADRAO.includes(m)])),
    perfis: { admin: PADRAO, promotor: ['core', 'catalogo', 'promotor'], vendedor: ['core', 'catalogo', 'vendedor'] },
    usuarios: [],
  },
  '/core/medidas': {
    itens: (
      [
        ['UN', 'Unidade', 12, true],
        ['CX', 'Caixa', 0, false],
      ] as const
    ).map(([sigla, descricao, em_uso, ativo], i) => ({ id: id(200 + i), sigla, descricao, ativo, em_uso })),
  },
  '/core/parametros/promotor-ve-pedidos': { ligado: true },
  '/core/parametros/inicio': { dias_uteis_semana: [1, 2, 3, 4, 5], parado_min: 60 },
  '/core/parametros/checkout-pendencia': { checkout_pendencia_alerta_h: 24 },
  '/core/parametros/calendario': { feriados: [] },
  '/core/parametros/jornada': { almoco_padrao: { inicio_min: 720, fim_min: 780 } },
  '/core/frases': {
    itens: (
      [
        ['Bom dia de vendas!', true, 'P01'],
        ['Cada visita conta.', false, 'P02'],
        ['Meta batida é time feliz.', true, null],
      ] as const
    ).map(([texto, ativa, padrao_codigo], i) => ({
      id: id(900 + i),
      updated_at: '2026-11-15T12:00:00.000Z',
      deleted_at: null,
      external_id: null,
      texto,
      ativa,
      ordem: i + 1,
      padrao_codigo,
    })),
  },
  '/core/produtos': { padrao_desconto_pct: 10, itens: [] },
  '/core/motivos': { itens: [] },
  '/core/fotos-tipos': {
    itens: (
      [
        ['Fachada', true, false, true],
        ['CNH do sócio', false, true, false],
      ] as const
    ).map(([nome, obrigatorio, sensivel, fachada], i) => ({ id: id(700 + i), nome, obrigatorio, sensivel, fachada, ordem: i + 1, ativo: true })),
  },
  '/vendedor/alcadas': { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'block', exceptions: [] },
  // atenção e peso do parcial fora do padrão (30 dias e 0): o "Padrão: X" aparece só neles
  '/promotor/cadastros/parametros': {
    validade_critica_dias: 7,
    validade_proxima_dias: 45,
    peso_parcial_conformidade: 0.5,
    permanencia_min_min: 10,
    variacao_preco_max_pct: 50,
  },
};

async function entrar(page: Page, c: Cenario = {}) {
  const perfil = c.perfil ?? 'admin';
  const ativos = c.ativos ?? PADRAO;
  const contratados = c.contratados ?? PADRAO;
  await page.setViewportSize({ width: 1366, height: 768 });
  const usuario = { id: id(1), name: 'Teste', email: `${perfil}@exemplo.invalid`, perfil, empresa: 'Empresa Fictícia', fuso: 'America/Manaus' };
  await page.addInitScript((u) => {
    const j = JSON.stringify(u);
    localStorage.setItem('macuxi.web.user', j);
    sessionStorage.setItem('macuxi.web.token', 'token-ficticio');
    sessionStorage.setItem('macuxi.web.token.usuario', j);
  }, usuario);
  await page.route('**/api-proxy/**', async (r) => {
    const caminho = new URL(r.request().url()).pathname.replace(/^\/api-proxy(\/v1)?/, '');
    const json = (status: number, corpo: unknown) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (caminho === '/auth/refresh') return json(200, { access_token: 'token-ficticio', token_type: 'Bearer', expires_in: 900 });
    if (caminho === '/me/modulos')
      return json(200, {
        modulos: ativos.map((m) => ({ id: m, versao: '1.0.0', parametros: {} })),
        versao_licencas: 'e2e',
        calculado_em: '2026-11-15T16:00:00.000Z',
        modulos_contratados: contratados,
      });
    if (r.request().method() === 'GET' && caminho in DADOS) return json(200, DADOS[caminho]);
    return json(404, { codigo: 'NAO_SIMULADO', mensagem: 'Não simulado no e2e.' });
  });
}

const menu = (page: Page) => page.getByTestId('menu-bko');

/** Rótulos do 1º nível do menu lateral (grupo, item direto ou entrada com cadeado), na ordem da tela. */
async function primeiroNivel(page: Page): Promise<string[]> {
  await expect(menu(page).getByTestId('nav-plataforma-parametros')).toBeVisible({ timeout: 60_000 });
  return menu(page)
    .locator('[data-testid^="nav-grupo-"], [data-testid="nav-plataforma-parametros"], [data-testid^="nav-pesquisa-"], [data-testid^="nav-treinamento-"]')
    .evaluateAll((els) => els.filter((e) => !e.getAttribute('data-testid')?.endsWith('-dica')).map((e) => (e.textContent ?? '').trim()));
}

test.describe('ADR 0060 — menu Parâmetros do BKO (API simulada)', () => {
  test('menu na ordem da spec (D1); o item Parâmetros abre a 1ª seção e fica aceso, com a seção escolhida na lista', async ({ page }) => {
    await entrar(page);
    await page.goto('/');
    expect(await primeiroNivel(page)).toEqual(['Acesso', 'Análise', 'Cadastros', 'Comunicação', 'Operação', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Parâmetros', 'Sistema']);
    await menu(page).getByTestId('nav-plataforma-parametros').click();
    await expect(page).toHaveURL(/\/parametros\/acesso$/, { timeout: 30_000 });
    await expect(menu(page).getByTestId('nav-plataforma-parametros')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('parametros-secao-clientes').click();
    await expect(page.getByTestId('parametros-core-farol')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('parametros-core-curvas-abc')).toBeVisible();
    await expect(page.getByTestId('parametros-secao-clientes')).toHaveAttribute('aria-current', 'page');
    await expect(menu(page).getByTestId('nav-plataforma-parametros')).toHaveAttribute('aria-current', 'page');
  });

  test('sem licença da empresa: Pesquisa e Treinamento com cadeado não navegam e mostram o balão; a seção mostra só o aviso', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    for (const nav of ['nav-pesquisa-pesquisas', 'nav-treinamento-trilhas']) {
      const entrada = menu(page).getByTestId(nav);
      const dica = page.getByTestId(`${nav}-dica`);
      await entrada.hover();
      await expect(dica).toBeVisible();
      await expect(dica).toHaveText(TEXTO_SEM_LICENCA);
      // o Playwright não clica em `aria-disabled` sem `force`; o usuário clica, e o clique não pode navegar
      await entrada.click({ force: true });
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/parametros\/clientes$/);
      await page.mouse.move(900, 450);
      await expect(dica).toBeHidden();
    }
    await expect(page.getByTestId('parametros-secao-treinamento')).toHaveAttribute('data-bloqueado', '');
    await expect(page.getByTestId('parametros-secao-trade')).not.toHaveAttribute('data-bloqueado', '');
    await page.getByTestId('parametros-secao-pesquisa').click();
    await expect(page).toHaveURL(/\/parametros\/pesquisa$/);
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveText(TEXTO_SEM_LICENCA);
    await expect(page.getByTestId('parametros-conteudo-pesquisa').locator('[data-testid^="parametros-pesquisa-"]')).toHaveCount(0);
  });

  test('Trade sem licença da empresa: o grupo inteiro vira entrada com cadeado e a seção mostra só o aviso', async ({ page }) => {
    const semTrade = PADRAO.filter((m) => m !== 'promotor');
    await entrar(page, { ativos: semTrade, contratados: semTrade });
    await page.goto('/parametros/clientes');
    await primeiroNivel(page);
    const trade = menu(page).getByTestId('nav-grupo-trade');
    await expect(trade).toHaveAttribute('data-bloqueado', '');
    await trade.click({ force: true });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/parametros\/clientes$/);
    for (const n of ['nav-promotor-cadastros', 'nav-promotor-trade']) await expect(page.getByTestId(n), n).toHaveCount(0);
    await page.getByTestId('parametros-secao-trade').click();
    await expect(page.getByTestId('parametros-sem-licenca')).toHaveText(TEXTO_SEM_LICENCA);
    await expect(page.getByTestId('parametros-promotor-validade')).toHaveCount(0);
  });

  test('endereço digitado sem licença não abre a página (a vitrine é só exibição)', async ({ page }) => {
    await entrar(page);
    for (const [url, pagina] of [
      ['/pesquisas', 'pagina-pesquisa-pesquisas'],
      ['/trilhas', 'pagina-treinamento-trilhas'],
    ] as const) {
      await page.goto(url);
      await expect(menu(page)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId(pagina), url).toHaveCount(0);
    }
  });

  test('com licença: Pesquisa e Treinamento navegam; as seções mostram os painéis só leitura (P4), com o padrão do tenant', async ({ page }) => {
    await entrar(page, { ativos: TODOS, contratados: TODOS });
    await page.goto('/');
    await primeiroNivel(page);
    await menu(page).getByTestId('nav-pesquisa-pesquisas').click();
    await expect(page.getByTestId('pagina-pesquisa-pesquisas')).toBeVisible({ timeout: 30_000 });
    await menu(page).getByTestId('nav-treinamento-trilhas').click();
    await expect(page.getByTestId('pagina-treinamento-trilhas')).toBeVisible({ timeout: 30_000 });
    for (const [secao, paineis] of [
      ['pesquisa', ['vigencia', 'construtor', 'fotos']],
      ['treinamento', ['quiz-licao', 'xp', 'niveis-ranking']],
    ] as const) {
      await page.goto(`/parametros/${secao}`);
      for (const p of paineis) await expect(page.getByTestId(`parametros-${secao}-${p}`), p).toBeVisible({ timeout: 30_000 });
      const conteudo = page.getByTestId(`parametros-conteudo-${secao}`);
      await expect(conteudo.locator('input, select, textarea')).toHaveCount(0);
      await expect(conteudo.getByRole('button', { name: /Salvar/ })).toHaveCount(0);
      await expect(conteudo).not.toContainText('Padrão:');
    }
    await page.goto('/parametros/pesquisa');
    const construtor = page.getByTestId('parametros-pesquisa-construtor-valores');
    await expect(construtor).toContainText('Perguntas por questionário50');
    await expect(construtor).toContainText('Texto2.000 caracteres');
    await page.goto('/parametros/treinamento');
    const quiz = page.getByTestId('treinamento-quiz-licao');
    await expect(quiz).toContainText('Nota mínima70%');
    await expect(quiz).toContainText('Tentativas por dia3');
  });

  test('links antigos vão para a seção de Parâmetros com a âncora do painel; /formas-pagamento fica (D11)', async ({ page }) => {
    await entrar(page);
    for (const [antigo, destino, painel] of [
      ['/perfis', '/parametros/acesso#core-perfis', 'parametros-core-perfis'],
      ['/usuarios-e-modulos', '/parametros/acesso#core-usuarios-e-modulos', 'parametros-core-usuarios-e-modulos'],
      ['/motivos', '/parametros/visitas#core-motivos', 'parametros-core-motivos'],
      ['/fotos-pdv', '/parametros/visitas#core-fotos-pdv', 'parametros-core-fotos-pdv'],
      ['/plano-rv', '/parametros/metas-e-rv#core-plano-rv', 'parametros-core-plano-rv'],
      ['/alcadas', '/parametros/pedidos#vendedor-alcadas', 'parametros-vendedor-alcadas'],
    ] as const) {
      await page.goto(antigo);
      await expect(page, antigo).toHaveURL(new RegExp(`${destino.replace(/[/#]/g, '\\$&')}$`), { timeout: 60_000 });
      await expect(page.getByTestId(painel), antigo).toBeVisible({ timeout: 30_000 });
    }
    await page.goto('/formas-pagamento');
    await expect(page.getByTestId('pagina-vendedor-formas-pagamento')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/formas-pagamento$/);
  });

  test('link antigo com query: /usuarios-e-modulos?nivel=perfil&perfil=promotor chega a Módulos filtrado, sem abrir a edição em Perfis', async ({ page }) => {
    await entrar(page);
    await page.goto('/usuarios-e-modulos?nivel=perfil&perfil=promotor');
    await expect(page).toHaveURL(/\/parametros\/acesso\?nivel=perfil&perfil=promotor#core-usuarios-e-modulos$/, { timeout: 60_000 });
    const modulos = page.getByTestId('parametros-core-usuarios-e-modulos');
    await expect(modulos.getByTestId('licencas.nivel.perfil')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(modulos.getByTestId('licencas.seletor-perfil')).toHaveValue('promotor');
    await expect(page.getByTestId('perfis.lista')).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Voltar' })).toHaveCount(0);
  });

  test('Acesso: filtrar o perfil em Módulos (?modulos_perfil=) não abre a edição em Perfis; ?editar_perfil= abre só a edição', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/acesso?nivel=perfil');
    const seletor = page.getByTestId('licencas.seletor-perfil');
    await expect(seletor).toBeVisible({ timeout: 60_000 });
    await seletor.selectOption('promotor');
    await expect(page).toHaveURL(/[?&]modulos_perfil=promotor/);
    await expect(page.getByTestId('perfis.lista')).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Voltar' })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('editar_perfil')).toBeNull();

    await page.goto('/parametros/acesso?editar_perfil=promotor');
    await expect(page.getByRole('button', { name: '‹ Voltar' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('perfis.lista')).toHaveCount(0);
    await expect(page.getByTestId('licencas.nivel.tenant')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('licencas.seletor-perfil')).toHaveCount(0);
  });

  test('Pedidos › Alçadas (RN-VEN-10): faixa × quem aprova pela política 5/10/15% e acima bloqueia; o título uma vez; sem as decisões (D5)', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/pedidos');
    const painel = page.getByTestId('parametros-vendedor-alcadas');
    const linhas = painel.getByTestId('alcadas.tabela').locator('tbody tr');
    await expect(linhas).toHaveCount(4, { timeout: 30_000 });
    for (const [i, faixa, quem] of [
      [0, 'Até 5,0%', 'Vendedor (aprovado na hora)'],
      [1, 'Até 10,0%', 'Supervisor'],
      [2, 'Até 15,0%', 'Gerente'],
      [3, 'Acima de 15,0%', 'Bloqueado: o vendedor não consegue enviar'],
    ] as const) {
      await expect(linhas.nth(i).locator('td').nth(0), faixa).toHaveText(faixa);
      await expect(linhas.nth(i).locator('td').nth(1), quem).toHaveText(quem);
    }
    await expect(painel.getByRole('heading', { name: 'Alçadas', exact: true })).toHaveCount(1);
    await expect(page.getByTestId('alcadas.decisoes')).toHaveCount(0);
  });

  test('Trade (RN-PRO-04/07/08/11): três painéis só leitura com o valor do tenant e "Padrão: X" só no que mudou', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/trade');
    for (const p of ['parametros-promotor-validade', 'parametros-promotor-visita-coleta', 'parametros-promotor-gondola'])
      await expect(page.getByTestId(p), p).toBeVisible({ timeout: 30_000 });
    for (const [chave, texto] of [
      ['validade_critica_dias', '7 dias'],
      ['validade_proxima_dias', '45 diasPadrão: 30 dias'],
      ['permanencia_min_min', '10 min'],
      ['variacao_preco_max_pct', '50%'],
      ['peso_parcial_conformidade', '50%Padrão: 0%'],
    ] as const)
      await expect(page.getByTestId(`promotor.parametro.${chave}`), chave).toHaveText(texto);
    const conteudo = page.getByTestId('parametros-conteudo-trade');
    await expect(conteudo.locator('input, select, textarea')).toHaveCount(0);
    await expect(conteudo.getByRole('button', { name: /Salvar/ })).toHaveCount(0);
  });

  test('Salvar só com alteração e com o nome do que salva (farol, curvas, dias úteis, desconto, prazo, almoço)', async ({ page }) => {
    await entrar(page);
    for (const [secao, botao, rotulo] of [
      ['clientes', 'farol-params.salvar', 'Salvar farol'],
      ['clientes', 'curvas-abc-params.salvar', 'Salvar curvas'],
      ['inicio', 'inicio-params.salvar', 'Salvar dias úteis'],
      ['produtos', 'produtos.parametro-salvar', 'Salvar desconto'],
      ['visitas', 'checkout-pendencia.salvar', 'Salvar prazo'],
      ['calendario', 'calendario.almoco-padrao.salvar', 'Salvar almoço'],
    ] as const) {
      await page.goto(`/parametros/${secao}`);
      const b = page.getByTestId(botao);
      await expect(b, botao).toBeVisible({ timeout: 30_000 });
      await expect.soft(b, `${botao} sem alteração`).toBeDisabled();
      await expect.soft(b, botao).toHaveText(rotulo);
    }
  });

  test('Início: Dias úteis sem o parado (Parâmetros › Alertas, RN-CORE-26) e sem almoço; Frases do dia com um título só, sem contador', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/inicio');
    const inicio = page.getByTestId('parametros-core-inicio');
    await expect(inicio.getByTestId('inicio-params.salvar')).toBeVisible({ timeout: 60_000 });
    await expect(inicio).not.toContainText(/parado/i);
    await expect(inicio).not.toContainText(/almo[cç]o/i);
    const frases = page.getByTestId('parametros-core-frases-do-dia');
    await expect(frases.getByTestId('frases.painel')).toBeVisible({ timeout: 30_000 });
    await expect(frases.getByText('Frases do dia', { exact: true })).toHaveCount(1);
    await expect(frases).not.toContainText(/Frases do dia ·/);
  });

  test('Produtos › Medidas: gerente (só consulta, P4) vê a lista sem cadastrar', async ({ page }) => {
    await entrar(page, { perfil: 'gerente' });
    await page.goto('/parametros/produtos');
    const medidas = page.getByTestId('parametros-core-medidas');
    await expect(medidas.getByTestId('medidas.linha.UN')).toBeVisible({ timeout: 60_000 });
    await expect(medidas).toContainText('Você pode consultar');
    await expect(medidas.getByTestId('medidas.nova')).toBeDisabled();
  });

  test('Medidas: selo só em Inativa, sem coluna Situação; Fotos do PDV: "Remover" só fora da fachada', async ({ page }) => {
    await entrar(page);
    await page.goto('/parametros/produtos');
    const medidas = page.getByTestId('medidas.tela');
    await expect(medidas.getByTestId('medidas.linha.UN')).toBeVisible({ timeout: 60_000 });
    await expect(medidas.locator('th')).toHaveText(['Sigla', 'Descrição', 'Produtos', 'Ações']);
    await expect(medidas.getByTestId('medidas.linha.UN')).not.toContainText('Ativa');
    await expect(medidas.getByTestId('medidas.linha.CX')).toContainText('Inativa');
    await page.goto('/parametros/visitas');
    await expect(page.getByTestId(`fotos-pdv.editar.${id(700)}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`fotos-pdv.apagar.${id(700)}`)).toHaveCount(0);
    await expect(page.getByTestId(`fotos-pdv.apagar.${id(701)}`)).toHaveText('Remover');
  });
});
