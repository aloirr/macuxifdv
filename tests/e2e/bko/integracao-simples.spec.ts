/**
 * T-0173 — Integração ERP simples no BKO (Playwright), com a API SIMULADA por `page.route` (não precisa da demo nem de banco).
 *
 * Confere, pela tela, valor × regra (RN-INT-15; spec docs/design/integracao-simples §3, §4, §5, §8, §9):
 *  - colunas exatas da tabela de lotes; início/conclusão `dd/mm hh:mm` no fuso do tenant (America/Manaus), inclusive virada de dia e de mês;
 *  - duração (`45 s`, `2 min 10 s`, `3 min`, `1 h 05 min`; em andamento, até agora) e "x de y" nas linhas integradas;
 *  - os 5 status e o "⋯" só com ação (Cancelar em andamento; Reprocessar em Com falha e Concluído com avisos);
 *  - popup de autorização (RN-INT-16): senha errada, 429 e a senha nunca na URL;
 *  - De-para em Parâmetros → Integração e os 5 cards de Pedidos com os números de `MonitorResumo.pedidos`; sem licença, tudo some.
 * O esperado é calculado À MÃO pela regra (não pelo código do módulo). Os dados são fictícios.
 *
 * Pré-requisito: o BKO no ar (`pnpm --filter web dev`, porta 3000). Rodar: `pnpm test:e2e tests/e2e/bko/integracao-simples.spec.ts`
 * (`MACUXI_PW_CANAL=` usa o Chromium do Playwright). Viewport 1366×768 (tela de referência da spec).
 */
import { expect, test, type Page } from '@playwright/test';

const AGORA = '2026-11-15T18:40:00.000Z'; // 15/11 14:40 em Manaus
const FUSO = 'America/Manaus';
const MODULOS = ['core', 'catalogo', 'vendedor', 'integracao'];

const id = (prefixo: string, n: number) => `${prefixo}-1c2d-4e5f-8a9b-${String(n).padStart(12, '0')}`;
const lote = (
  n: number,
  prefixo: string,
  entidade: string,
  status: string,
  recebido_em: string,
  concluido_em: string | null,
  recebidas: number,
  com_erro: number,
) => ({
  lote_id: id(prefixo, n),
  conector_id: 'erp-matriz',
  entidade,
  modo: 'delta',
  status,
  recebidas,
  com_erro,
  novas: 0,
  atualizadas: Math.max(0, recebidas - com_erro),
  inalteradas: 0,
  obsoletas: 0,
  inativadas: 0,
  recebido_em,
  concluido_em,
});

/** [lote, [Início, Duração, Conclusão, Status, Linhas integradas], ações do "⋯"] — esperado pela RN-INT-15. */
const LOTES: Array<[ReturnType<typeof lote>, string[], string[]]> = [
  [
    lote(0, '3f9c2a71', 'rota', 'recebido', '2026-11-15T18:39:50.000Z', null, 320, 0),
    ['15/11 14:39', '10 s', '', 'Em andamento', '320'],
    ['Cancelar'],
  ],
  [
    lote(1, '8b14d0e2', 'cliente', 'processando', '2026-11-15T18:37:20.000Z', null, 1240, 0),
    ['15/11 14:37', '2 min 40 s', '', 'Em andamento', '1.240'],
    ['Cancelar'],
  ],
  [
    lote(
      2,
      'c7a2e913',
      'produto',
      'concluido',
      '2026-11-15T18:20:00.000Z',
      '2026-11-15T18:22:10.000Z',
      3500,
      0,
    ),
    ['15/11 14:20', '2 min 10 s', '15/11 14:22', 'Concluído', '3.500'],
    [],
  ],
  [
    lote(
      3,
      '51de8a04',
      'preco',
      'concluido_com_erros',
      '2026-11-15T17:00:00.000Z',
      '2026-11-15T17:03:00.000Z',
      1240,
      60,
    ),
    ['15/11 13:00', '3 min', '15/11 13:03', 'Concluído com avisos', '1.180 de 1.240'],
    ['Reprocessar'],
  ],
  [
    lote(
      4,
      '0e6b7f35',
      'estoque',
      'falhou',
      '2026-11-15T15:10:00.000Z',
      '2026-11-15T15:10:45.000Z',
      800,
      800,
    ),
    ['15/11 11:10', '45 s', '15/11 11:10', 'Com falha', '0 de 800'],
    ['Reprocessar'],
  ],
  [
    lote(5, 'a4c81b96', 'titulo', 'cancelado', '2026-11-15T13:00:00.000Z', '2026-11-15T14:05:30.000Z', 95, 0),
    ['15/11 09:00', '1 h 05 min', '15/11 10:05', 'Cancelado', '95'],
    [],
  ],
  // virada de dia no fuso: 03:50Z de 15/11 = 14/11 23:50 em Manaus
  [
    lote(
      6,
      '72f0d3ab',
      'nota',
      'concluido',
      '2026-11-15T03:50:00.000Z',
      '2026-11-15T04:05:00.000Z',
      12000,
      0,
    ),
    ['14/11 23:50', '15 min', '15/11 00:05', 'Concluído', '12.000'],
    [],
  ],
  // virada de mês no fuso: 03:30Z de 01/11 = 31/10 23:30 em Manaus
  [
    lote(
      7,
      'e19b55c0',
      'cliente_endereco',
      'concluido',
      '2026-11-01T03:30:00.000Z',
      '2026-11-01T03:31:05.000Z',
      1,
      0,
    ),
    ['31/10 23:30', '1 min 5 s', '31/10 23:31', 'Concluído', '1'],
    [],
  ],
];

const PEDIDOS_ERP = {
  por_estado: {
    pendente: 7,
    enviado: 1234,
    integrado: 980,
    rejeitado_erp: 3,
    faturado_parcial: 4,
    faturado_total: 900,
    cancelado: 2,
  },
  presos: 2,
  retidos: 5,
};
/** [testId, rótulo, valor exibido, classe de cor] — números de MonitorResumo.pedidos (contrato do Hub). */
const CARDS: Array<[string, string, string, string | null]> = [
  ['na_fila', 'Na fila', '7', null],
  ['entregue', 'Entregue ao Conector', '1.234', null],
  ['rejeitado', 'Rejeitado pelo ERP', '3', 'text-danger'],
  ['presos', 'Presos sem retorno', '2', 'text-danger'],
  ['retidos', 'Retidos sem mapeamento', '5', 'text-warning'],
];

const uuid = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const MAPEAMENTOS = {
  itens: [
    {
      id: uuid(101),
      tipo: 'condicao_pagamento',
      codigo_macuxi: 'AV',
      codigo_erp: '001',
      descricao: 'À vista',
      ativo: true,
      atualizado_em: '2026-11-10T12:00:00.000Z',
    },
    {
      id: uuid(103),
      tipo: 'condicao_pagamento',
      codigo_macuxi: '30-60',
      codigo_erp: '3060',
      descricao: null,
      ativo: false,
      atualizado_em: '2026-11-11T12:00:00.000Z',
    },
  ],
  condicoes_sem_correspondente: [{ codigo_macuxi: '28D', pedidos: 5 }],
};
const AUTORIZADORES = {
  itens: [
    { id: uuid(201), nome: 'Ana Ribeiro', perfil: 'admin' },
    { id: uuid(202), nome: 'Bruno Lima', perfil: 'analista' },
  ],
};
const pedido = (n: number, cliente: string, status: string, total: number) => ({
  id: uuid(300 + n),
  number: `PV-2026-${1000 + n}`,
  idempotency_key: uuid(400 + n),
  seller_id: uuid(500),
  seller_name: 'Carla Souza',
  customer_id: uuid(600 + n),
  customer_name: cliente,
  branch_id: null,
  branch_name: null,
  filial: null,
  price_table_id: null,
  discount_pct: 0,
  subtotal_cents: total,
  discount_cents: 0,
  total_cents: total,
  payment_terms: '30 dias',
  status,
  pending_reason: '',
  rejection_reason: '',
  erp_order_code: '',
  created_offline_at: null,
  received_at: '2026-11-15T14:00:00.000Z',
  updated_at: '2026-11-15T14:00:00.000Z',
  status_changed_at: null,
  items_count: 3,
  units: 24,
});

interface Cenario {
  perfil?: string;
  modulos?: string[];
  monitorStatus?: number;
  mapeamentosVazio?: boolean;
  /** `autorizar`: o reprocessar pede autorizador (403) e responde 422 até a 5ª senha, 429 depois. */
  reprocessar?: 'direto' | 'autorizar';
}

/** Sessão fictícia no navegador + a API simulada (contratos Zod de integracao/vendedor/core). Devolve as URLs chamadas. */
async function preparar(page: Page, c: Cenario = {}): Promise<string[]> {
  const urls: string[] = [];
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.setFixedTime(new Date(AGORA));
  const usuario = {
    id: uuid(999),
    name: 'Teste Admin',
    email: 'teste@exemplo.invalid',
    perfil: c.perfil ?? 'admin',
    empresa: 'Distribuidora Fictícia',
    fuso: FUSO,
  };
  await page.addInitScript((u) => {
    const j = JSON.stringify(u);
    localStorage.setItem('macuxi.web.user', j);
    sessionStorage.setItem('macuxi.web.token', 'token-ficticio');
    sessionStorage.setItem('macuxi.web.token.usuario', j);
  }, usuario);
  let tentativas = 0;
  await page.route('**/api-proxy/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/api-proxy(\/v1)?/, '');
    urls.push(req.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/me/modulos')
      return json(200, {
        modulos: (c.modulos ?? MODULOS).map((m) => ({ id: m, versao: '1.0.0' })),
        versao_licencas: 'v1',
        calculado_em: AGORA,
      });
    if (p === '/integracao/monitor') {
      if ((c.monitorStatus ?? 200) !== 200)
        return json(c.monitorStatus!, { codigo: 'MODULO_INATIVO', mensagem: 'Módulo não contratado.' });
      return json(200, {
        gerado_em: AGORA,
        conectores: [],
        alertas: [],
        lotes_recentes: LOTES.map((l) => l[0]),
        cargas: [],
        pendencias_inativacao: [],
        reconciliacoes: [],
        pedidos: PEDIDOS_ERP,
      });
    }
    if (p === '/integracao/mapeamentos' && req.method() === 'GET')
      return json(200, c.mapeamentosVazio ? { itens: [], condicoes_sem_correspondente: [] } : MAPEAMENTOS);
    if (p === '/integracao/mapeamentos/codigos-macuxi')
      return json(200, {
        tipo: u.searchParams.get('tipo'),
        disponivel: true,
        itens: [
          { codigo: '28D', nome: '28 dias', ativo: true },
          { codigo: 'AV', nome: 'À vista', ativo: true },
        ],
      });
    if (p === '/integracao/lotes/autorizadores') return json(200, AUTORIZADORES);
    if (/^\/integracao\/lotes\/[^/]+\/reprocessar$/.test(p)) {
      const corpo = (req.postDataJSON() ?? {}) as { autorizador_id?: string };
      if ((c.reprocessar ?? 'direto') === 'direto')
        return json(200, { lote_id: p.split('/')[3], reenfileiradas: 60, status: 'recebido' });
      if (!corpo.autorizador_id)
        return json(403, { codigo: 'autorizador_necessario', mensagem: 'Escolha quem autoriza.' });
      tentativas++;
      return tentativas > 5
        ? json(429, { codigo: 'muitas_tentativas', mensagem: 'Muitas tentativas.' })
        : json(422, { codigo: 'senha_incorreta', mensagem: 'Senha incorreta.' });
    }
    if (p === '/vendedor/pedidos') {
      const itens =
        u.searchParams.get('status') === 'pending_approval'
          ? []
          : [
              pedido(1, 'Mercadinho Boa Vista', 'sent_to_erp', 152390),
              pedido(2, 'Padaria Ponta Negra', 'approved', 41250),
            ];
      return json(200, {
        itens,
        proximo_cursor: null,
        total_filtro: { quantidade: itens.length, soma_cents: itens.reduce((s, i) => s + i.total_cents, 0) },
      });
    }
    return json(404, { codigo: 'nao_encontrado', mensagem: 'Rota não simulada.' });
  });
  return urls;
}

test.describe('T-0173 — Integração ERP simples (API simulada)', () => {
  test('RN-INT-15: tabela de lotes com colunas, datas no fuso, duração, "x de y", status e "⋯" só com ação', async ({
    page,
  }) => {
    await preparar(page);
    await page.goto('/integracao');
    await expect(page.getByTestId('integracao.lotes')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('h1').first()).toHaveText('Integração ERP');
    await expect(page.getByTestId('integracao.monitor.atualizar')).toBeVisible();
    const cab = (await page.locator('[data-testid="integracao.lotes"] thead th').allTextContents()).map((t) =>
      t.trim(),
    );
    expect(cab).toEqual([
      'Entidade',
      'Lote',
      'Início',
      'Duração',
      'Conclusão',
      'Status',
      'Linhas integradas',
      'Ações',
    ]);
    await expect(page.locator('[data-testid="integracao.filtro-status"] option')).toHaveText([
      'Todos',
      'Em andamento',
      'Concluído',
      'Concluído com avisos',
      'Com falha',
      'Cancelado',
    ]);
    const conteudo = await page.getByTestId('pagina-integracao-monitor-conteudo').innerText();
    for (const fora of ['Conector', 'De-para', 'Pedidos no ERP', 'Exportar', 'Só com erro', '—'])
      expect(conteudo, `"${fora}" saiu da tela`).not.toContain(fora);

    for (const [l, esperado, acoes] of LOTES) {
      const cel = (await page.getByTestId(`integracao.lote.${l.lote_id}`).locator('td').allInnerTexts()).map(
        (t) => t.trim(),
      );
      expect(cel.slice(2, 7), `lote ${l.lote_id.slice(0, 8)} (${l.status})`).toEqual(esperado);
      expect(cel[1]).toBe(l.lote_id.slice(0, 8));
      await expect(page.getByTestId(`integracao.lotes.acoes.${l.lote_id}`)).toHaveCount(acoes.length ? 1 : 0);
      if (acoes.length) {
        await page.getByTestId(`integracao.lotes.acoes.${l.lote_id}`).click();
        await expect(page.locator('[role="menuitem"]')).toHaveText(acoes);
        await page.keyboard.press('Escape');
      }
    }

    await page.getByTestId('integracao.filtro-status').selectOption({ label: 'Em andamento' });
    await expect(page.locator('[data-testid="integracao.lotes"] tbody tr')).toHaveCount(2);
  });

  test('RN-INT-15: o clique na linha abre o log do lote', async ({ page }) => {
    await preparar(page);
    await page.goto('/integracao');
    const alvo = LOTES[3]![0];
    await page.getByTestId(`integracao.lote.${alvo.lote_id}`).locator('td').first().click();
    await expect(page).toHaveURL(new RegExp(`lote=${alvo.lote_id}`));
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });

  test('RN-INT-16: sem permissão, o popup pede a senha de quem autoriza; erro limpa a senha; 429 avisa; a senha nunca vai na URL', async ({
    page,
  }) => {
    const urls = await preparar(page, { reprocessar: 'autorizar' });
    await page.goto('/integracao');
    const alvo = LOTES[4]![0];
    await page.getByTestId(`integracao.lotes.acoes.${alvo.lote_id}`).click();
    await page.getByTestId(`integracao.lote.reprocessar.${alvo.lote_id}`).click();
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo).toContainText('Autorizar reprocessamento');
    await expect(page.getByTestId('integracao.autorizar.quem')).toHaveValue(AUTORIZADORES.itens[0]!.id);
    await expect(page.getByTestId('integracao.autorizar.confirmar')).toBeDisabled();
    // um rótulo só no popup ("Senha de" + quem autoriza); o campo leva o nome acessível da pessoa escolhida
    await expect(dialogo.locator('label:visible')).toHaveText(['Senha de']);
    await expect(page.getByLabel(`Senha de ${AUTORIZADORES.itens[0]!.nome}`)).toHaveCount(1);
    const senha = page.locator('#integracao-autorizar-senha');
    for (let i = 1; i <= 5; i++) {
      await senha.fill(`senha-ficticia-${i}`);
      await page.getByTestId('integracao.autorizar.confirmar').click();
      await expect(dialogo).toContainText('Senha incorreta.');
      await expect(senha).toHaveValue('');
    }
    await senha.fill('senha-ficticia-6');
    await page.getByTestId('integracao.autorizar.confirmar').click();
    await expect(dialogo).toContainText('Muitas tentativas. Tente de novo em alguns minutos.');
    expect(urls.filter((u) => u.includes('senha-ficticia'))).toEqual([]);
  });

  test('De-para em Parâmetros → Integração (entre Operação e Produtos), com Alertas, folha e vazio', async ({
    page,
  }) => {
    await preparar(page);
    await page.goto('/parametros/integracao');
    await expect(page.getByRole('heading', { name: 'De-para de códigos' })).toBeVisible({ timeout: 120_000 });
    const menu = (await page.getByTestId('menu-bko').textContent()) ?? '';
    expect(menu.indexOf('Operação')).toBeLessThan(menu.indexOf('Parâmetros'));
    expect(menu.indexOf('Parâmetros')).toBeLessThan(menu.indexOf('Produtos'));
    await expect(page.getByTestId('menu-bko').locator('a[href="/parametros/integracao"]')).toHaveText(
      'Integração',
    );
    await expect(page.locator('main')).toContainText('5 pedidos retidos: condição 28D sem código do ERP');
    await page.getByRole('button', { name: 'Novo de-para' }).first().click();
    await expect(page.locator('[role="dialog"]').last()).toContainText('Novo de-para');
  });

  test('De-para vazio', async ({ page }) => {
    await preparar(page, { mapeamentosVazio: true });
    await page.goto('/parametros/integracao');
    await expect(page.getByText('Nenhum de-para ainda.')).toBeVisible({ timeout: 120_000 });
  });

  test('RN-INT-08: os 5 cards de Pedidos mostram os números de MonitorResumo.pedidos, só informativos', async ({
    page,
  }) => {
    await preparar(page);
    await page.goto('/pedidos');
    await expect(page.getByTestId('pedidos.cards-erp')).toBeVisible({ timeout: 120_000 });
    for (const [tid, rotulo, valor, cor] of CARDS) {
      const card = page.getByTestId(`pedidos.card-erp.${tid}`);
      await expect(card).toContainText(rotulo);
      await expect(card, `${rotulo}: número no padrão pt-BR`).toContainText(valor);
      if (cor) await expect(card.locator(`.${cor}`)).toHaveCount(1);
      await expect(card.locator('button, a')).toHaveCount(0);
    }
  });

  for (const [nome, c] of [
    ['sem licença do módulo Integração', { modulos: ['core', 'catalogo', 'vendedor'], monitorStatus: 403 }],
    ['sem monitor.ver (gerente)', { perfil: 'gerente', monitorStatus: 403 }],
  ] as Array<[string, Cenario]>) {
    test(`${nome}: cards e De-para somem e a página de Pedidos continua inteira`, async ({ page }) => {
      const erros: string[] = [];
      page.on('pageerror', (e) => erros.push(String(e)));
      await preparar(page, c);
      await page.goto('/pedidos');
      await expect(page.getByTestId('pedidos.tabela')).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(1_000);
      await expect(page.getByTestId('pedidos.cards-erp')).toHaveCount(0);
      await expect(page.getByTestId('menu-bko').locator('a[href="/parametros/integracao"]')).toHaveCount(0);
      expect(erros).toEqual([]);
    });
  }
});
