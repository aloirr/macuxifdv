/**
 * e2e do portal config. no modo falso (spec portal-config-enxuto §10.2 e §11): aba Integração em dois lados (Conector | API), o caso
 * do ERP (Bases do Conector e credencial de API), "Envia os pedidos" no diálogo "Bases", "Reativar" com a chave nova, o guia da API em
 * PDF e a aba Empresa com plano; refaz os prints 05b, 05c, 05d, 05e e 06b em 1280 e 390 px (escala 2). Roda contra o `next dev` com `NEXT_PUBLIC_PORTAL_FALSO=1` (config em `playwright.config.mjs`).
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const PRINTS = fileURLToPath(new URL('../docs/prints/portal-config-enxuto', import.meta.url));
const SEM_FORMA = ['filial', 'vendedor', 'catalogo_no', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'tabela_escalonada', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota'];

async function estado(page: Page) {
  return page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) ?? '';
      const v = JSON.parse(sessionStorage.getItem(k) ?? 'null') as { conectores?: Record<string, { conector_id: string; tipo: string; recebe_pedidos: boolean; entidades: string[] }[]> } | null;
      if (v && v.conectores) return Object.values(v.conectores).flat().map((c) => [c.conector_id, c.tipo, c.recebe_pedidos, c.entidades]);
    }
    return null;
  });
}

for (const [nome, largura] of [['', 1280], ['-celular', 390]] as const) {
  test(`ERP: Bases do Conector e credencial de API (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('/entrar');
    await page.getByTestId('entrar.email').fill('admin@uma.com.br');
    await page.getByTestId('entrar.senha').fill('certa-123');
    await page.getByTestId('entrar.entrar').click();
    await expect(page.getByTestId('integracao.aba')).toBeVisible({ timeout: 60000 });
    // o indicador do next dev não entra nos prints
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await expect(page.getByText('Nenhum Conector.')).toBeVisible();

    // começo: o Conector com todas as bases e os pedidos
    await page.getByTestId('integracao.identificador').fill('erp');
    await page.getByTestId('integracao.gerar').click();
    await expect(page.getByTestId('integracao.credencial')).toBeVisible();
    await page.getByTestId('integracao.ja-copiei').click();
    await expect(page.getByTestId('integracao.api-sem-bases')).toBeVisible();
    await expect(page.getByTestId('integracao.api-gerar')).toBeDisabled();

    // Guia: o PDF (rota pública, sem sessão) ao lado do OpenAPI
    await expect(page.getByTestId('integracao.guia')).toHaveText('Baixar o guia (PDF)');
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('integracao.guia').click()]);
    expect(pdf.suggestedFilename()).toBe('macuxi-guia-api-v1.pdf');
    await expect(page.getByTestId('integracao.openapi')).toBeVisible();

    // Conector > Bases > desmarca Formas de pagamento > Gravar
    await page.getByTestId('integracao.bases-erp').click();
    const dialogo = page.getByRole('dialog', { name: 'Bases do Conector erp' });
    await expect(dialogo).toBeVisible();
    const marcadas = dialogo.locator('[data-testid^="integracao.bases."]:checked');
    await expect(marcadas).toHaveCount(16);
    await dialogo.getByTestId('integracao.bases.forma_pagamento').uncheck();
    await expect(marcadas).toHaveCount(15);
    await expect(dialogo.getByTestId('integracao.bases-recebe-pedidos')).toBeChecked();
    await expect(dialogo.getByTestId('integracao.bases-recebe-pedidos')).toBeEnabled();
    await expect(dialogo).toContainText('Envia os pedidos aprovados ao ERP');
    await page.screenshot({ path: `${PRINTS}/05c-dialogo-bases${nome}.png` });
    await dialogo.getByTestId('integracao.bases-gravar').click();
    await expect(dialogo).toBeHidden();

    // lado da API: só "Formas de pagamento", marcada; pedidos desmarcados
    const bases = page.locator('[data-testid^="integracao.api-bases."]');
    await expect(bases).toHaveCount(1);
    await expect(page.getByTestId('integracao.api-bases.forma_pagamento')).toBeChecked();
    await expect(page.getByTestId('integracao.api-recebe-pedidos')).not.toBeChecked();
    await expect(page.locator('fieldset[data-testid="integracao.api-bases"] > legend')).toHaveText('Bases');

    // no diálogo de novo: Formas de pagamento desmarcada; Gravar sem nenhuma base fica desabilitado
    await page.getByTestId('integracao.bases-erp').click();
    await expect(dialogo.getByTestId('integracao.bases.forma_pagamento')).not.toBeChecked();
    for (const e of SEM_FORMA) await dialogo.getByTestId(`integracao.bases.${e}`).uncheck();
    await expect(dialogo.getByTestId('integracao.bases-gravar')).toBeDisabled();
    await dialogo.getByTestId('integracao.bases-cancelar').click();

    // API > Gerar a credencial
    await page.getByTestId('integracao.api-identificador').fill('erp-api');
    await page.getByTestId('integracao.api-nome').fill('ERP pela API');
    await page.getByTestId('integracao.api-gerar').click();
    await expect(page.getByTestId('integracao.api-chave')).toHaveText(/^mx_falso_/);
    await expect(page.getByTestId('integracao.api-copiar')).toHaveText('Copiar');
    await expect(page.getByTestId('integracao.api-credenciais')).toContainText('erp-api');
    await page.getByTestId('integracao.api-chave').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PRINTS}/05d-gerar-credencial-api${nome}.png`, fullPage: true });

    expect(await estado(page)).toEqual([
      ['erp', 'conector', true, SEM_FORMA],
      ['erp-api', 'nuvem', false, ['forma_pagamento']],
    ]);

    // lado da API: nenhum texto do Conector; nova chave e desativar no texto da credencial
    const api = page.locator('section[aria-labelledby="integracao-api"]');
    for (const velho of ['Conector instalado', 'arquivo de configuração', 'Credencial da API do Conector', 'Conector do ERP']) await expect(api).not.toContainText(velho);
    await expect(page.locator('legend', { hasText: 'Bases' })).toHaveCount(0);
    await page.getByTestId('integracao.api-ja-copiei').click();
    await expect(page.getByTestId('integracao.api-sem-bases')).toBeVisible();
    await page.getByTestId('integracao.nova-chave-erp-api').click();
    await expect(page.getByRole('dialog', { name: 'Gerar nova chave para a credencial erp-api?' })).toContainText('Troque a chave no sistema que chama a API.');
    await page.getByTestId('integracao.acao-cancelar').click();
    await page.getByTestId('integracao.desativar-erp-api').click();
    await expect(page.getByRole('dialog', { name: 'Desativar a credencial erp-api?' })).toContainText('As chamadas com esta chave passam a ser recusadas.');
    await page.getByTestId('integracao.acao-cancelar').click();

    // RD-2609: o diálogo do erp lista só as livres para ele (sem Formas de pagamento, que é da erp-api) e nada desabilitado
    await page.getByTestId('integracao.bases-erp').click();
    await expect(dialogo.locator('[data-testid^="integracao.bases."]')).toHaveCount(15);
    await expect(dialogo.locator('input[type=checkbox]:disabled')).toHaveCount(0);
    await expect(dialogo.getByTestId('integracao.bases.forma_pagamento')).toHaveCount(0);
    await expect(dialogo).not.toContainText('erp-api');
    await expect(dialogo.locator('fieldset > legend')).toHaveText('Bases');
    await dialogo.getByTestId('integracao.bases-cancelar').click();
    await page.getByTestId('integracao.bases-erp-api').click();
    const dialogoApi = page.getByRole('dialog', { name: 'Bases da credencial erp-api' });
    await expect(dialogoApi.locator('[data-testid^="integracao.bases."]')).toHaveCount(1);
    await expect(dialogoApi.getByTestId('integracao.bases.forma_pagamento')).toBeChecked();
    // os pedidos já vão pelo erp: a caixa da credencial fica bloqueada
    await expect(dialogoApi.getByTestId('integracao.bases-recebe-pedidos')).toBeDisabled();
    await dialogoApi.getByTestId('integracao.bases-cancelar').click();

    // "Envia os pedidos" editável no diálogo: o erp deixa de enviar (PATCH { entidades, recebe_pedidos }) e a caixa da credencial abre
    await page.getByTestId('integracao.bases-erp').click();
    await dialogo.getByTestId('integracao.bases-recebe-pedidos').uncheck();
    await dialogo.getByTestId('integracao.bases-gravar').click();
    await expect(dialogo).toBeHidden();
    expect(await estado(page)).toEqual([
      ['erp', 'conector', false, SEM_FORMA],
      ['erp-api', 'nuvem', false, ['forma_pagamento']],
    ]);
    await page.getByTestId('integracao.bases-erp-api').click();
    await expect(dialogoApi.getByTestId('integracao.bases-recebe-pedidos')).toBeEnabled();
    await dialogoApi.getByTestId('integracao.bases-cancelar').click();

    // Desativar o erp: a linha fica só com "Reativar"
    await page.getByTestId('integracao.desativar-erp').click();
    await page.getByTestId('integracao.acao-confirmar-desativar').click();
    await expect(page.getByTestId('integracao.reativar-erp')).toHaveText('Reativar');
    await expect(page.getByTestId('integracao.bases-erp')).toHaveCount(0);
    await page.screenshot({ path: `${PRINTS}/05b-integracao${nome}.png`, fullPage: true });

    // Reativar (caso da thathyany): as livres marcadas (sem Formas de pagamento, da erp-api); o erp volta enviando os pedidos; a chave nova uma vez
    await page.getByTestId('integracao.reativar-erp').click();
    const reativar = page.getByRole('dialog', { name: 'Reativar o Conector erp?' });
    await expect(reativar.locator('[data-testid^="integracao.bases."]:checked')).toHaveCount(15);
    await expect(reativar.getByTestId('integracao.bases.forma_pagamento')).toHaveCount(0);
    await expect(reativar.getByTestId('integracao.bases-recebe-pedidos')).not.toBeChecked();
    await reativar.getByTestId('integracao.bases-recebe-pedidos').check();
    await expect(reativar.getByTestId('integracao.bases-gravar')).toHaveText('Reativar');
    await reativar.getByTestId('integracao.bases-gravar').click();
    await expect(reativar).toBeHidden();
    const chave = page.getByTestId('integracao.nova-chave-erp.chave');
    await expect(chave).toHaveText(/^mx_falso_/);
    await expect(page.getByTestId('integracao.nova-chave-erp.copiar')).toHaveText('Copiar');
    await expect(page.getByTestId('integracao.reativar-erp')).toHaveCount(0);
    await chave.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PRINTS}/05e-reativar${nome}.png`, fullPage: true });
    expect(await estado(page)).toEqual([
      ['erp', 'conector', true, SEM_FORMA],
      ['erp-api', 'nuvem', false, ['forma_pagamento']],
    ]);
    await ctx.close();
  });
}

for (const [nome, largura] of [['', 1280], ['-celular', 390]] as const) {
  test(`aba Empresa com plano, time da Macuxi (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('/entrar');
    await page.getByTestId('entrar.email').fill('time@macuxi.com.br');
    await page.getByTestId('entrar.senha').fill('certa-123');
    await page.getByTestId('entrar.entrar').click();
    await expect(page).toHaveURL(/\/empresas/, { timeout: 60000 });
    await page.goto('/empresas/0b6f1a52-5c1e-4c4e-9a43-000000000001#empresa');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const conteudo = page.getByTestId('empresa-pagina.conteudo-empresa');
    await expect(conteudo).toBeVisible({ timeout: 60000 });
    await expect(conteudo).not.toHaveAttribute('data-sem-plano', 'sim');
    await expect(page.getByTestId('empresa-pagina.aba-empresa')).toHaveAttribute('aria-selected', 'true');
    await expect(conteudo).toContainText('Promotor Avulso');
    await page.screenshot({ path: `${PRINTS}/06b-aba-empresa${nome}.png`, fullPage: true });
    await ctx.close();
  });
}
