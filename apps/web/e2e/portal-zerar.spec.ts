/**
 * e2e do "Zerar dados" (ADR 0068; RN-PLA-12) no portal config., modo falso: o item no menu "⋯" ao lado do Excluir, o diálogo com a
 * prévia por grupo, o código e a senha, o andamento e o concluído; e, na aba Integração (desenho §6.4), a seção Monitor com o
 * "Zerar dados" no "⋯" de cada entidade da "Dados no Hub", o "Leva junto:" da cascata e o resultado com o lote e os comandos de reenvio. Prints em
 * docs/prints/zerar-dados, 1280 e 390 px (escala 2).
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

const UMA = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

for (const [nome, largura] of [['', 1280], ['-celular', 390]] as const) {
  test(`Zerar dados por entidade na aba Integração (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('/entrar');
    await page.getByTestId('entrar.email').fill('time@macuxi.com.br');
    await page.getByTestId('entrar.senha').fill('certa-123');
    await page.getByTestId('entrar.entrar').click();
    await expect(page).toHaveURL(/\/empresas/, { timeout: 60000 });
    await page.goto(`/empresas/${UMA}`);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const monitor = page.getByTestId('integracao.monitor');
    await expect(monitor.getByTestId('integracao.monitor.entidade.estoque')).toBeVisible({ timeout: 60000 });
    await expect(monitor.getByText('Cargas recentes', { exact: true })).toBeVisible();
    // "Corrigir no ERP" tem prioridade 3: some no quadro estreito
    await expect(monitor.getByText('Corrigir no ERP', { exact: true })).toBeVisible({ visible: largura > 500 });
    // nenhuma tabela passa da tela (no celular: Entidade + Situação + "⋯" no painel; Entidade + "⋯" no "Dados no Hub")
    for (const t of ['integracao.monitor.conectores', 'integracao.entidades', 'integracao.monitor.entidades']) {
      const caixa = await monitor.getByTestId(t).boundingBox();
      expect(caixa && caixa.x + caixa.width).toBeLessThanOrEqual(largura);
    }
    // o nome mais longo ("Endereços de clientes") cabe inteiro na célula da Entidade (truncate sem reticências)
    for (const t of ['integracao.monitor.entidades', 'integracao.entidades']) {
      const celula = monitor.getByTestId(t).locator('td', { hasText: /^Endereços de clientes$/ }).first();
      await expect(celula).toBeVisible();
      const { texto, util } = await celula.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const st = getComputedStyle(el);
        return { texto: r.getBoundingClientRect().width, util: el.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) };
      });
      expect(texto).toBeLessThanOrEqual(util);
    }
    // "Zerar dados" num lugar só: o "⋯" da "Dados no Hub" (com ou sem lote recente); o "⋯" do painel tem Reprocessar e Histórico
    await expect(monitor.getByTestId('integracao.entidades.acoes.produto')).toBeVisible();
    await expect(monitor.getByTestId('integracao.monitor.entidades.acoes.estoque')).toBeVisible();
    await expect(monitor.getByTestId('integracao.monitor.entidades.acoes.cliente')).toBeVisible();
    await monitor.screenshot({ animations: 'disabled', path: `${PRINTS}/05-monitor${nome}.png` });

    // o primeiro clique pode chegar antes da hidratação: repete até o diálogo abrir
    await expect(async () => {
      if (!(await page.getByTestId('empresa-zerar.dialogo').isVisible())) {
        if (!(await page.getByTestId('integracao.entidade.zerar.cliente').isVisible())) await monitor.getByTestId('integracao.monitor.entidades.acoes.cliente').click();
        await page.getByTestId('integracao.entidade.zerar.cliente').click({ timeout: 2000 });
      }
      await expect(page.getByTestId('empresa-zerar.previa')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByRole('dialog')).toContainText('Zerar Clientes de Distribuidora Uma Ltda?');
    await expect(page.getByTestId('empresa-zerar.entidades')).toHaveText('Leva junto:Endereços de clientes');
    await page.getByTestId('empresa-zerar.codigo').fill('distribuidora-uma');
    await page.getByTestId('empresa-zerar.senha').fill('certa-123');
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/06-entidade${nome}.png` });

    await page.getByTestId('empresa-acao.confirmar').click();
    await expect(page.getByTestId('empresa-zerar.concluido')).toHaveText('5.030 linhas apagadas.', { timeout: 20000 });
    await expect(page.getByTestId('empresa-zerar.reenvio')).toContainText('conector carga-completa cliente');
    await expect(page.getByTestId('empresa-zerar.reenvio')).toContainText('conector carga-completa cliente_endereco');
    await expect(page.getByTestId('empresa-zerar.lote')).toContainText(/Lote \d{8}T\d{6}Z-[0-9a-f]{8}/);
    await page.screenshot({ animations: 'disabled', path: `${PRINTS}/07-resultado${nome}.png` });

    // o painel recarrega: Clientes e Endereços saem (sem lote nem registro) e ficam sem "Zerar dados"
    await page.getByTestId('empresa-acao.cancelar').click();
    await expect(monitor.getByTestId('integracao.monitor.entidades.acoes.cliente')).toHaveCount(0, { timeout: 20000 });
    await expect(monitor.getByTestId('integracao.monitor.entidades.acoes.cliente_endereco')).toHaveCount(0);
    await expect(monitor.getByTestId('integracao.monitor.entidades.acoes.produto')).toHaveCount(1);
    await ctx.close();
  });
}
