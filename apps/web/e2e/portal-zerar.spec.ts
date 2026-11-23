/**
 * e2e do "Zerar dados" (ADR 0068; RN-PLA-12) no portal config., modo falso: o item no menu "⋯" ao lado do Excluir, o diálogo com a
 * prévia por grupo, o código e a senha, o andamento e o concluído. Prints em docs/prints/zerar-dados, 1280 e 390 px (escala 2).
 * Roda contra o `next dev` com `NEXT_PUBLIC_PORTAL_FALSO=1` (config em `playwright.config.mjs`).
 */
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const PRINTS = fileURLToPath(new URL('../docs/prints/zerar-dados', import.meta.url));

for (const [nome, largura] of [['', 1280], ['-celular', 390]] as const) {
  test(`Zerar dados: menu, prévia, andamento e concluído (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('/entrar');
    await page.getByTestId('entrar.email').fill('time@macuxi.com.br');
    await page.getByTestId('entrar.senha').fill('certa-123');
    await page.getByTestId('entrar.entrar').click();
    await expect(page).toHaveURL(/\/empresas/, { timeout: 60000 });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    // o primeiro clique pode chegar antes da hidratação: repete até o menu abrir
    const abrirMenu = () =>
      expect(async () => {
        // a rolagem até o botão fecha o menu (MenuAcoes sai no scroll): rola antes, depois clica
        await page.getByTestId('empresas.acoes-AM2290').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        if (await page.getByTestId('empresas.zerar-AM2290').isVisible()) return;
        await page.getByTestId('empresas.acoes-AM2290').click();
        await expect(page.getByTestId('empresas.zerar-AM2290')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });

    await abrirMenu();
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/01-menu${nome}.png` });

    await page.getByTestId('empresas.zerar-AM2290').click();
    await expect(page.getByTestId('empresa-zerar.previa')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeDisabled();
    await page.getByTestId('empresa-zerar.codigo').fill('am2290');
    await page.getByTestId('empresa-zerar.senha').fill('certa-123');
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/02-previa${nome}.png` });

    await page.getByTestId('empresa-acao.confirmar').click();
    await expect(page.getByTestId('empresa-zerar.andamento')).toContainText('Em andamento…');
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/03-andamento${nome}.png` });

    await expect(page.getByTestId('empresa-zerar.concluido')).toHaveText('20.119 linhas apagadas.', { timeout: 20000 });
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/04-concluido${nome}.png` });

    // a empresa sem dados: só a linha e "Fechar"
    await page.getByTestId('empresa-acao.cancelar').click();
    await abrirMenu();
    await page.getByTestId('empresas.zerar-AM2290').click();
    await expect(page.getByTestId('empresa-zerar.vazio')).toHaveText('Não há dados para zerar.');
    await expect(page.getByTestId('empresa-acao.confirmar')).toHaveCount(0);
    await expect(page.getByTestId('empresa-acao.cancelar')).toHaveText('Fechar');
    await ctx.close();
  });
}
