/**
 * e2e da aba Empresa do portal (R-20261124-090942 item 04; ADR 0075 e ADR 0074), modo falso, nos dois hosts (`config.localhost` e
 * `fdv.localhost/config`, ADR 0071), para o time Macuxi e para o admin do cliente:
 * - colunas: à esquerda o Plano e, logo abaixo, Apps; à direita Dados da empresa (e, para o time, Administradores) e a marca;
 * - Apps: "Gerar link" do Macuxi Campo → Baixar, Copiar link, "O link vale até DD/MM às HH:MM" e o SHA-256 recolhido;
 * - Dados da empresa: em branco no que falta; "Editar" → "Trazer dados da Receita Federal" preenche só os vazios (o telefone e o
 *   e-mail já gravados ficam); CEP inválido = erro no campo; "Salvar" grava e o cartão mostra;
 * - Nome fantasia (uma informação, um lugar): só no cartão Dados da empresa; na gaveta, editável pelo time Macuxi (grava pela rota
 *   da marca, T-0182, só quando mudou) e só leitura para o admin; o cartão da logo fica só com a logo.
 * Prints em 1366 px (escala 2), prefixo `04-`, em `E2E_PRINTS_DIR`, quando definido.
 */
import { expect, test, type Page } from '@playwright/test';

import { urlDoPortal } from './enderecos';

const UMA = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

const print = async (page: Page, nome: string, inteira = true) => {
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', fullPage: inteira, path: `${process.env.E2E_PRINTS_DIR}/04-${nome}-${test.info().project.name}-1366.png` });
};

async function abrirAbaEmpresa(page: Page, email: string) {
  await page.goto(urlDoPortal('/entrar'));
  await page.getByTestId('entrar.email').fill(email);
  await page.getByTestId('entrar.senha').fill('Senha#Forte2026');
  await page.getByTestId('entrar.entrar').click();
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible({ timeout: 60000 });
  await page.goto(urlDoPortal(`/empresas/${UMA}`));
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  // o 1º clique pode chegar antes da hidratação: repete até a aba abrir
  await expect(async () => {
    await page.getByTestId('empresa-pagina.aba-empresa').click();
    await expect(page.getByTestId('empresa-cadastro.editar')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 90000 });
  await expect(page.getByTestId('empresa-plano.cartao')).toBeVisible({ timeout: 60000 });
}

/** Caixa do elemento (falha se não estiver na tela). */
async function caixa(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`sem ${testId}`);
  return b;
}

async function conferirColunas(page: Page) {
  const plano = await caixa(page, 'empresa-plano.cartao');
  const apps = await caixa(page, 'empresa-pagina.apps');
  const cadastro = await caixa(page, 'empresa-cadastro');
  // Apps logo abaixo do Plano, na mesma coluna; Dados da empresa na coluna da direita, no topo
  expect(Math.abs(apps.x - plano.x)).toBeLessThan(40);
  expect(apps.y).toBeGreaterThan(plano.y + plano.height);
  expect(cadastro.x).toBeGreaterThan(plano.x + plano.width);
  expect(cadastro.y).toBeLessThan(apps.y);
}

for (const [quem, email] of [
  ['time-macuxi', 'time@macuxi.com.br'],
  ['admin', 'admin@uma.com.br'],
] as const) {
  test(`${quem}: Plano e Apps à esquerda, Dados da empresa à direita; link do app com data e hora`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await abrirAbaEmpresa(page, email);
    await conferirColunas(page);
    await expect(page.getByTestId('empresa-admins')).toHaveCount(quem === 'admin' ? 0 : 1);
    // em branco no que não está preenchido; o que já está gravado aparece com máscara
    await expect(page.getByTestId('empresa-cadastro.cnpj')).toHaveText('11.222.333/0001-81');
    // o endereço numa linha só, em branco quando nada foi preenchido; o CNPJ só no cartão (fora do cabeçalho)
    await expect(page.getByTestId('empresa-cadastro.endereco')).toHaveText('');
    await expect(page.getByTestId('empresa-cadastro.logradouro')).toHaveCount(0);
    await expect(page.getByText(/^Código .*CNPJ/)).toHaveCount(0);
    // admin do cliente sem logo salva: sem o cartão Logo (ele não pode agir ali)
    await expect(page.getByTestId('empresa-logo')).toHaveCount(quem === 'admin' ? 0 : 1);
    await expect(page.getByTestId('empresa-cadastro.telefone')).toHaveText('(92) 3633-0000');
    // o nome fantasia só no cartão Dados da empresa: o cartão da logo fica só com a logo
    await expect(page.getByTestId('empresa-cadastro.nome_fantasia')).toBeVisible();
    await expect(page.locator('[data-testid^="empresa-nome-fantasia"]')).toHaveCount(0);
    await expect(page.getByTestId('empresa-pagina.conteudo-empresa').getByText('Nome fantasia', { exact: true })).toHaveCount(1);

    await page.getByTestId('empresa-pagina.baixar-campo-gerar').click();
    const link = page.getByTestId('empresa-pagina.baixar-campo-link');
    await expect(link).toBeVisible({ timeout: 30000 });
    await expect(link).toContainText('Baixar Campo-Oficial-v1.0.34.apk');
    await expect(link).toContainText(/O link vale até \d{2}\/\d{2} às \d{2}:\d{2}\./);
    await expect(link).not.toContainText('Depois disso');
    await expect(page.getByTestId('empresa-pagina.baixar-campo-copiar')).toBeVisible();
    // SHA-256 recolhido: o código só aparece ao abrir
    const sha = page.getByTestId('empresa-pagina.baixar-campo-sha');
    await expect(sha.locator('code')).toBeHidden();
    await expect(page.getByTestId('empresa-pagina.baixar-campo-gerar')).toHaveText('Gerar novo link');
    await print(page, `aba-empresa-${quem}`);
    await sha.locator('summary').click();
    await expect(sha.locator('code')).toBeVisible();
    await ctx.close();
  });
}

test('Dados da empresa: Receita preenche só os vazios, CEP inválido no campo, Salvar grava (admin do cliente)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await abrirAbaEmpresa(page, 'admin@uma.com.br');
  await page.getByTestId('empresa-cadastro.editar').click();
  const gaveta = page.getByRole('dialog', { name: 'Dados da empresa' });
  await expect(gaveta).toBeVisible();
  await expect(page.getByTestId('empresa-cadastro.campo-cnpj')).toBeDisabled();
  await expect(page.getByTestId('empresa-cadastro.campo-nome_fantasia')).toBeDisabled();
  await expect(page.getByTestId('empresa-cadastro.salvar')).toBeDisabled();
  // o bairro digitado antes da consulta fica
  await page.getByTestId('empresa-cadastro.campo-bairro').fill('Chapada');
  await page.getByTestId('empresa-cadastro.receita').click();
  await expect(page.getByTestId('empresa-cadastro.aviso')).toContainText('campos preenchidos com os dados da Receita. Confira e salve.', { timeout: 30000 });
  await expect(page.getByTestId('empresa-cadastro.campo-logradouro')).toHaveValue('Rua Fictícia');
  await expect(page.getByTestId('empresa-cadastro.campo-uf')).toHaveValue('AM');
  await expect(page.getByTestId('empresa-cadastro.campo-bairro')).toHaveValue('Chapada');
  await expect(page.getByTestId('empresa-cadastro.campo-telefone')).toHaveValue('(92) 3633-0000');
  await expect(page.getByTestId('empresa-cadastro.campo-email')).toHaveValue('financeiro@distribuidora-uma.com.br');
  await expect(page.getByTestId('empresa-cadastro.campo-inscricao_estadual')).toHaveValue('');
  await print(page, 'dados-cadastrais-receita', false);

  await page.getByTestId('empresa-cadastro.campo-cep').fill('123');
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(gaveta).toContainText('CEP inválido: use os 8 números.');
  await page.getByTestId('empresa-cadastro.campo-cep').fill('69050-010');
  await page.getByTestId('empresa-cadastro.campo-inscricao_estadual').fill('04.123.456-7');
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(gaveta).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByTestId('empresa-cadastro.endereco')).toHaveText('Rua Fictícia, 100 · Sala 2 · Chapada · Manaus/AM · 69050-010');
  await expect(page.getByTestId('empresa-cadastro.inscricao_estadual')).toHaveText('041234567');
  await print(page, 'dados-cadastrais-salvos');
  await ctx.close();
});

test('Nome fantasia: o time Macuxi edita na gaveta dos Dados da empresa e só ele grava (rota da marca)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await abrirAbaEmpresa(page, 'time@macuxi.com.br');
  await page.getByTestId('empresa-cadastro.editar').click();
  const gaveta = page.getByRole('dialog', { name: 'Dados da empresa' });
  await expect(gaveta).toBeVisible();
  const nome = page.getByTestId('empresa-cadastro.campo-nome_fantasia');
  await expect(nome).toBeEnabled();
  await expect(page.getByTestId('empresa-cadastro.campo-cnpj')).toBeDisabled();
  await expect(page.getByTestId('empresa-cadastro.salvar')).toBeDisabled();
  // só o nome fantasia mudou: o Salvar libera e grava só ele
  await nome.fill('Uma Distribuidora');
  await expect(page.getByTestId('empresa-cadastro.salvar')).toBeEnabled();
  await print(page, 'dados-cadastrais-nome-fantasia', false);
  await page.getByTestId('empresa-cadastro.salvar').click();
  await expect(gaveta).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByTestId('empresa-cadastro.nome_fantasia')).toHaveText('Uma Distribuidora');
  await print(page, 'dados-cadastrais-nome-fantasia-salvo');
  await ctx.close();
});
