/**
 * Aviso de obrigatório vazio no rodapé da gaveta do BKO (R-20261124-092046, item 07; docs/design/componentes.md §5.6),
 * com a API SIMULADA por `page.route` (sem banco nem demo). Gavetas: Transportadoras (vendedor), Marcas e Sinônimos (catálogo).
 *
 * Pré-requisito: o BKO no ar (`pnpm --filter web dev`). Rodar: `pnpm test:e2e tests/e2e/bko/aviso-obrigatorio-gaveta.spec.ts`
 * (`MACUXI_BKO_URL` muda o endereço; `MACUXI_PW_CANAL=` usa o Chromium do Playwright). `E2E_PRINT_DIR` grava o print 1366 px.
 */
import { expect, test, type Page } from '@playwright/test';

const TEXTO = 'Campos obrigatórios não preenchido. Preencha e salve novamente';
const MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DADOS: Readonly<Record<string, unknown>> = {
  '/vendedor/transportadoras': { itens: [] },
  '/vendedor/transportadoras/digitadas': { itens: [] },
  '/vendedor/frete/parametros': { modalidade_padrao: 'CIF' },
  '/catalogo/marcas': { marcas: [] },
  '/catalogo/sinonimos': { items: [] },
};

async function entrar(page: Page, largura = 1366, altura = 768) {
  await page.setViewportSize({ width: largura, height: altura });
  const usuario = { id: id(1), name: 'Teste', email: 'admin@exemplo.invalid', perfil: 'admin', empresa: 'Empresa Fictícia', fuso: 'America/Manaus' };
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
      return json(200, { modulos: MODULOS.map((m) => ({ id: m, versao: '1.0.0', parametros: {} })), versao_licencas: 'e2e', calculado_em: '2026-11-24T12:00:00.000Z', modulos_contratados: MODULOS });
    if (r.request().method() === 'GET' && caminho in DADOS) return json(200, DADOS[caminho]);
    return json(404, { codigo: 'NAO_SIMULADO', mensagem: 'Não simulado no e2e.' });
  });
}

const aviso = (page: Page) => page.getByTestId('gaveta.aviso-obrigatorio');

async function abrirTransportadora(page: Page) {
  await page.goto('/transportadoras');
  await page.getByTestId('transportadoras.nova').first().click({ timeout: 60_000 });
  await expect(page.getByTestId('transportadoras.form')).toBeVisible();
}

test.describe('Item 07 — aviso de obrigatório vazio no rodapé da gaveta', () => {
  test.use({ deviceScaleFactor: 2 });

  test('C1: salvar vazia mostra o texto literal, role=alert, vermelho, à esquerda de Cancelar/Salvar; antes de salvar não aparece', async ({ page }) => {
    await entrar(page);
    await abrirTransportadora(page);
    await expect(aviso(page)).toHaveCount(0);
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toHaveText(TEXTO);
    await expect(aviso(page)).toHaveAttribute('role', 'alert');
    const a = (await aviso(page).boundingBox())!;
    const cancelar = (await page.getByTestId('transportadoras.cancelar').boundingBox())!;
    const salvar = (await page.getByTestId('transportadoras.salvar').boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(cancelar.x);
    expect(cancelar.x).toBeLessThan(salvar.x);
    // mesma linha dos botões em 1366 px
    expect(Math.abs(a.y + a.height / 2 - (cancelar.y + cancelar.height / 2))).toBeLessThan(cancelar.height);
    const cor = await aviso(page).evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (cor.match(/\d+/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(g! + 60);
    expect(r).toBeGreaterThan(b! + 60);
    if (process.env.E2E_PRINT_DIR) {
      await page.screenshot({ path: `${process.env.E2E_PRINT_DIR}/item07-aviso.png` });
    }
  });

  test('C2: tudo preenchido não mostra; erro de formato (CNPJ curto, nome de 1 letra) não mostra', async ({ page }) => {
    await entrar(page);
    await abrirTransportadora(page);
    await page.getByTestId('transportadoras.nome').fill('A');
    await page.getByTestId('transportadoras.cnpj').fill('123');
    await page.getByTestId('transportadoras.salvar').click();
    await expect(page.getByTestId('transportadoras.form')).toContainText('Informe o CNPJ com 14 dígitos.');
    await page.waitForTimeout(300);
    await expect(aviso(page)).toHaveCount(0);
    // um obrigatório vazio e o outro com erro de formato: aparece (há obrigatório vazio)
    await page.getByTestId('transportadoras.nome').fill('');
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    // tudo válido: não aparece (o POST cai no 404 simulado e a gaveta mostra o erro da API, sem o aviso)
    await page.getByTestId('transportadoras.nome').fill('Transportadora Teste');
    await page.getByTestId('transportadoras.cnpj').fill('11222333000181');
    await page.getByTestId('transportadoras.salvar').click();
    await page.waitForTimeout(500);
    await expect(aviso(page)).toHaveCount(0);
  });

  test('C3: some ao digitar e ao fechar/reabrir; Cancelar não dispara', async ({ page }) => {
    await entrar(page);
    await abrirTransportadora(page);
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    await page.getByTestId('transportadoras.nome').pressSequentially('X');
    await expect(aviso(page)).toHaveCount(0);
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    await page.getByTestId('transportadoras.cancelar').click();
    await expect(page.getByTestId('transportadoras.form')).toHaveCount(0);
    await page.getByTestId('transportadoras.nova').first().click();
    await expect(page.getByTestId('transportadoras.form')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(aviso(page)).toHaveCount(0);
    // Esc também fecha e o aviso não volta ao reabrir
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('transportadoras.form')).toHaveCount(0);
    await page.getByTestId('transportadoras.nova').first().click();
    await page.waitForTimeout(300);
    await expect(aviso(page)).toHaveCount(0);
  });

  test('C4: gaveta com rodapé que não marca erro no campo (catálogo, Sinônimos) não mostra o aviso e segue funcionando', async ({ page }) => {
    await entrar(page);
    await page.goto('/catalogo?aba=sinonimos');
    await page.getByRole('button', { name: 'Novo grupo' }).first().click({ timeout: 60_000 });
    await page.getByTestId('sinonimos.salvar').click();
    await page.waitForTimeout(500);
    await expect(aviso(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('C5: tela estreita (390 px) quebra linha, sem rolagem horizontal, botões à vista', async ({ page }) => {
    await entrar(page, 390, 800);
    await abrirTransportadora(page);
    await page.getByTestId('transportadoras.salvar').click();
    await expect(aviso(page)).toBeVisible();
    const a = (await aviso(page).boundingBox())!;
    const salvar = (await page.getByTestId('transportadoras.salvar').boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(390);
    expect(salvar.x + salvar.width).toBeLessThanOrEqual(390);
    expect(a.y + a.height).toBeLessThanOrEqual(salvar.y + 1);
    // Cancelar e Salvar ficam juntos na mesma linha (o aviso é que quebra para cima)
    const cancelar = (await page.getByTestId('transportadoras.cancelar').boundingBox())!;
    expect(Math.abs(cancelar.y - salvar.y)).toBeLessThan(4);
    const transborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(transborda).toBe(false);
    if (process.env.E2E_PRINT_DIR) await page.screenshot({ path: `${process.env.E2E_PRINT_DIR}/item07-aviso-390.png` });
  });

  test('C6: outra gaveta (catálogo, Marcas): salvar vazia mostra o aviso; com nome, não', async ({ page }) => {
    await entrar(page);
    await page.goto('/catalogo/marcas');
    await page.getByTestId('marcas.nova').first().click({ timeout: 60_000 });
    await page.getByTestId('marcas.salvar').click();
    await expect(aviso(page)).toHaveText(TEXTO);
    await page.getByRole('dialog').locator('input').first().fill('Marca X');
    await expect(aviso(page)).toHaveCount(0);
    await page.getByTestId('marcas.salvar').click();
    await page.waitForTimeout(500);
    await expect(aviso(page)).toHaveCount(0);
  });
});
