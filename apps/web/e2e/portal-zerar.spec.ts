/**
 * e2e do "Zerar dados" (ADR 0068; RN-PLA-12) no portal config., modo falso: o item no menu "⋯" ao lado do Excluir, o diálogo com a
 * prévia calculando (o worker conta) e depois por grupo, o código e a senha, o andamento e o concluído; e (desenho §6.4, R-20261124-090510)
 * a tabela "Conectores" no topo da aba Integração e a aba Dados, uma tabela por entidade com "Reprocessar" e "Zerar dados" no "⋯", o
 * "Leva junto:" da cascata e o resultado com o lote e os comandos de reenvio. Prints em
 * docs/prints/zerar-dados, 1280 e 390 px (escala 2).
 * Roda contra o `next dev` com `NEXT_PUBLIC_PORTAL_FALSO=1`, no `config.localhost` e no `fdv.localhost/config` (projetos do
 * `playwright.config.mjs`; ADR 0071).
 */
import { expect, test } from '@playwright/test';

import { urlDoPortal, pastaDosPrints } from './enderecos';

/** Prints com `E2E_PRINTS=1` (ver `enderecos.ts`). */
const prints = () => pastaDosPrints('zerar-dados');

for (const [nome, largura] of [['', 1280], ['-celular', 390]] as const) {
  test(`Zerar dados: menu, prévia, andamento e concluído (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(urlDoPortal('/entrar'));
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
    await page.screenshot({ animations: 'disabled', path: `${prints()}/01-menu${nome}.png` });

    await page.getByTestId('empresas.zerar-AM2290').click();
    // a prévia é do worker: o giro até ficar pronta, sem campos nem confirmar
    await expect(page.getByTestId('empresa-zerar.calculando')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('empresa-zerar.codigo')).toHaveCount(0);
    await expect(page.getByTestId('empresa-acao.confirmar')).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: `${prints()}/02-calculando${nome}.png` });
    await expect(page.getByTestId('empresa-zerar.previa')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('empresa-zerar.grupo-usuarios')).toHaveText('Usuários não administradores18');
    await expect(page.getByRole('dialog')).toContainText('Mantém: empresa, plano, administradores, perfis, parâmetros e conectores.');
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeDisabled();
    await page.getByTestId('empresa-zerar.codigo').fill('am2290');
    await page.getByTestId('empresa-zerar.senha').fill('certa-123');
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: `${prints()}/02-previa${nome}.png` });

    await page.getByTestId('empresa-acao.confirmar').click();
    await expect(page.getByTestId('empresa-zerar.andamento')).toContainText('Em andamento…');
    await page.screenshot({ animations: 'disabled', path: `${prints()}/03-andamento${nome}.png` });

    await expect(page.getByTestId('empresa-zerar.concluido')).toHaveText('20.137 linhas apagadas.', { timeout: 20000 });
    await page.screenshot({ animations: 'disabled', path: `${prints()}/04-concluido${nome}.png` });

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
  test(`Conectores no topo da Integração; aba Dados com Reprocessar e Zerar dados por entidade (${largura} px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(urlDoPortal('/entrar'));
    await page.getByTestId('entrar.email').fill('time@macuxi.com.br');
    await page.getByTestId('entrar.senha').fill('certa-123');
    await page.getByTestId('entrar.entrar').click();
    await expect(page).toHaveURL(/\/empresas/, { timeout: 60000 });
    await page.goto(urlDoPortal(`/empresas/${UMA}`));
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    // Integração: "Conectores" no topo, antes das seções Conector e API, uma tabela só (RD-3550); nada por entidade nesta aba
    const integracao = page.getByTestId('integracao.aba');
    const topo = integracao.getByTestId('integracao.topo');
    await expect(topo.getByText('Nenhum Conector.')).toBeVisible({ timeout: 60000 });
    await page.getByTestId('integracao.gerar').click();
    await page.getByTestId('integracao.ja-copiei').click();
    const erp = topo.getByTestId('integracao.conector.erp');
    await expect(erp).toContainText('Nunca conectou');
    const yTopo = (await topo.boundingBox())!.y;
    const yConector = (await page.locator('#integracao-conector').boundingBox())!.y;
    expect(yTopo).toBeLessThan(yConector);
    await expect(integracao.locator('table[data-testid="integracao.conectores"]')).toHaveCount(1);
    // o time da Macuxi vê o Último sinal (prioridade 2: some no quadro estreito); "Monitor" não aparece mais
    await expect(topo.getByText('Último sinal', { exact: true })).toBeVisible({ visible: largura > 500 });
    for (const fora of ['Monitor', 'Cargas recentes', 'Dados no Hub']) await expect(integracao.getByText(fora, { exact: true })).toHaveCount(0);
    await expect(integracao.getByTestId('dados.entidades')).toHaveCount(0);
    await topo.screenshot({ animations: 'disabled', path: `${prints()}/05-conectores${nome}.png` });

    // Dados: uma tabela só, por entidade (o primeiro clique pode chegar antes da hidratação: repete até a aba abrir)
    await expect(async () => {
      await page.getByTestId('empresa-pagina.aba-dados').click();
      await expect(page.getByTestId('dados.entidades')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30000 });
    await expect(page).toHaveURL(/#dados$/);
    const dados = page.getByTestId('dados.aba');
    await expect(dados.getByTestId('dados.entidade.estoque')).toBeVisible({ timeout: 60000 });
    await expect(dados.locator('table')).toHaveCount(1);
    // "Corrigir no ERP" tem prioridade 3: some no quadro estreito
    await expect(dados.getByText('Corrigir no ERP', { exact: true })).toBeVisible({ visible: largura > 500 });
    // a tabela não passa da tela (no celular: Entidade + Situação + "⋯")
    const caixa = await dados.getByTestId('dados.entidades').boundingBox();
    expect(caixa && caixa.x + caixa.width).toBeLessThanOrEqual(largura);
    // os nomes mais largos cabem inteiros na célula da Entidade (truncate sem reticências), com folga ≥ 4 px
    for (const nomeEntidade of ['Endereços de clientes', 'Formas de pagamento']) {
      const celula = dados.getByTestId('dados.entidades').locator('td', { hasText: new RegExp(`^${nomeEntidade}$`) }).first();
      await expect(celula).toBeVisible();
      const { texto, util } = await celula.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const st = getComputedStyle(el);
        return { texto: r.getBoundingClientRect().width, util: el.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) };
      });
      expect(util - texto).toBeGreaterThanOrEqual(4);
    }
    // o selo "Com falha" (o mais largo da Situação) sai inteiro: texto sem corte e ≥ 4 px da borda direita da célula
    const selos = dados.getByText('Com falha', { exact: true });
    await expect(selos.first()).toBeVisible();
    for (const selo of await selos.all()) {
      const { corte, esquerda, direita } = await selo.evaluate((el) => {
        const s = el.getBoundingClientRect();
        const c = el.closest('td')!.getBoundingClientRect();
        return { corte: el.scrollWidth - el.clientWidth, esquerda: s.left - c.left, direita: c.right - s.right };
      });
      expect(corte).toBe(0);
      expect(esquerda).toBeGreaterThanOrEqual(0);
      expect(direita).toBeGreaterThanOrEqual(4);
    }
    // "⋯" em toda entidade com o que fazer (com ou sem lote recente); RD-2678: a linha sem dados diz "Sem dados" uma vez só
    for (const e of ['produto', 'estoque', 'cliente']) await expect(dados.getByTestId(`dados.entidades.acoes.${e}`)).toBeVisible();
    await expect(dados.getByTestId('dados.entidades.acoes.filial')).toHaveCount(0);
    if (largura > 500) await expect(dados.getByTestId('dados.entidade.filial')).toContainText('Sem dados');
    await expect(dados.getByTestId('dados.entidade.filial')).not.toContainText('—');
    await page.screenshot({ animations: 'disabled', fullPage: true, path: `${prints()}/05-dados${nome}.png` });

    // Reprocessar (Produtos com falha): o menu tem Reprocessar e Zerar dados; depois, a linha fica "Em dia" e o menu só com Zerar
    await dados.getByTestId('dados.entidades.acoes.produto').click();
    await expect(page.getByTestId('dados.entidade.zerar.produto')).toBeVisible();
    await page.getByTestId('dados.entidade.reprocessar.produto').click();
    await expect(page.getByText('Reprocessamento iniciado.')).toBeVisible({ timeout: 20000 });
    await expect(dados.getByTestId('dados.entidade.produto')).toContainText('Em dia', { timeout: 20000 });
    await expect(dados.getByTestId('dados.entidade.produto')).not.toContainText('Com falha');
    await dados.getByTestId('dados.entidades.acoes.produto').click();
    await expect(page.getByTestId('dados.entidade.zerar.produto')).toBeVisible();
    await expect(page.getByTestId('dados.entidade.reprocessar.produto')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Zerar dados de Clientes: o diálogo leva junto os Endereços
    await expect(async () => {
      if (!(await page.getByTestId('empresa-zerar.dialogo').isVisible())) {
        if (!(await page.getByTestId('dados.entidade.zerar.cliente').isVisible())) await dados.getByTestId('dados.entidades.acoes.cliente').click();
        await page.getByTestId('dados.entidade.zerar.cliente').click({ timeout: 2000 });
      }
      await expect(page.getByTestId('empresa-zerar.previa')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByRole('dialog')).toContainText('Zerar Clientes de Distribuidora Uma Ltda?');
    await expect(page.getByTestId('empresa-zerar.entidades')).toHaveText('Leva junto:Endereços de clientes');
    await page.getByTestId('empresa-zerar.codigo').fill('distribuidora-uma');
    await page.getByTestId('empresa-zerar.senha').fill('certa-123');
    await expect(page.getByTestId('empresa-acao.confirmar')).toBeEnabled();
    await page.screenshot({ animations: 'disabled', path: `${prints()}/06-entidade${nome}.png` });

    await page.getByTestId('empresa-acao.confirmar').click();
    await expect(page.getByTestId('empresa-zerar.concluido')).toHaveText('5.030 linhas apagadas.', { timeout: 20000 });
    await expect(page.getByTestId('empresa-zerar.reenvio')).toContainText('conector carga-completa cliente');
    await expect(page.getByTestId('empresa-zerar.reenvio')).toContainText('conector carga-completa cliente_endereco');
    await expect(page.getByTestId('empresa-zerar.lote')).toContainText(/Lote \d{8}T\d{6}Z-[0-9a-f]{8}/);
    await page.screenshot({ animations: 'disabled', path: `${prints()}/07-resultado${nome}.png` });

    // a tabela recarrega: Clientes e Endereços saem (sem lote nem registro) e ficam sem "⋯"
    await page.getByTestId('empresa-acao.cancelar').click();
    await expect(dados.getByTestId('dados.entidades.acoes.cliente')).toHaveCount(0, { timeout: 20000 });
    await expect(dados.getByTestId('dados.entidades.acoes.cliente_endereco')).toHaveCount(0);
    if (largura > 500) await expect(dados.getByTestId('dados.entidade.cliente')).toContainText('Sem dados');
    await expect(dados.getByTestId('dados.entidades.acoes.produto')).toHaveCount(1);
    await ctx.close();
  });
}
