/**
 * T-0173 e v1.0.19 — Integração ERP no BKO (Playwright), com a API SIMULADA por `page.route` (não precisa da demo nem de banco).
 *
 * v1.0.19 (monitor refeito: UMA LINHA POR ENTIDADE; matriz em docs/testes/v1019-monitor-entidade.md). Confere, pela tela, valor × regra
 * (RF-INT-04, RN-INT-15, RN-INT-16):
 *  - cabeçalho "‹conector› · v‹versão› · última carga recebida dd/mm às hh:mm" (versão de `MonitorResumo.conectores`);
 *  - colunas exatas; uma linha por entidade, as com falha primeiro e depois a carga mais recente;
 *  - "Última carga" `dd/mm às hh:mm · falhou hh:mm` ou `· n lotes`, no fuso do tenant (America/Manaus), inclusive virada de dia e de mês;
 *  - chip "Com falha" / "Em dia"; "x de y" pt-BR (lote que falhou não integrou nada; em andamento e cancelado, vazio); "Reprocessar"
 *    só com falha reprocessável;
 *  - "Histórico (n)" com os lotes da entidade, "Reprocessar os n lotes" (do mais antigo ao mais recente) e "Ver erros" abrindo a gaveta
 *    com a data e a hora da falha;
 *  - reprocessamento parcial (RN-INT-15): erro do próprio lote (409 `conteudo_expirado`, `lote_nao_pode_reprocessar`) segue com os
 *    demais e diz quantos foram e qual falhou; erro que não é do lote (serviço fora, 429) para a fila;
 *  - popup de autorização (RN-INT-16): senha errada, 429, uma autorização para os n lotes, depois de um erro no meio só os restantes,
 *    e a senha nunca na URL;
 *  - os filtros Entidade e Status e a tabela de lotes saíram;
 *  - De-para na seção Integração da página Parâmetros e os 5 cards de Pedidos com os números de `MonitorResumo.resumo_pedidos`; sem licença, tudo some.
 * O esperado é calculado À MÃO pela regra (não pelo código do módulo). Os dados são fictícios.
 *
 * Pré-requisito: o BKO no ar (`pnpm --filter web dev`, porta 3000). Rodar: `pnpm test:e2e tests/e2e/bko/integracao-simples.spec.ts`
 * (`MACUXI_PW_CANAL=` usa o Chromium do Playwright). Viewport 1366×768 (tela de referência da spec).
 * Em `next dev` o Next abre o próprio `role=dialog` (aviso "Security Insight", `data-nextjs-dialog`): os popups do BKO são
 * localizados pelo nome acessível, nunca por `[role="dialog"]` solto.
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

/** Lotes recentes do tenant (horários em UTC; Manaus = UTC−4). */
const L = {
  rota: lote(0, '3f9c2a71', 'rota', 'recebido', '2026-11-15T18:39:50.000Z', null, 320, 0),
  produtoNovo: lote(
    1,
    'c7a2e913',
    'produto',
    'concluido',
    '2026-11-15T18:20:00.000Z',
    '2026-11-15T18:22:10.000Z',
    3500,
    0,
  ),
  produtoVelho: lote(
    2,
    'c7a2e914',
    'produto',
    'concluido',
    '2026-11-15T15:00:00.000Z',
    '2026-11-15T15:01:00.000Z',
    3500,
    0,
  ),
  preco: lote(
    3,
    '51de8a04',
    'preco',
    'concluido_com_erros',
    '2026-11-15T17:00:00.000Z',
    '2026-11-15T17:03:00.000Z',
    1240,
    60,
  ),
  clienteOk: lote(
    4,
    '8b14d0e2',
    'cliente',
    'concluido',
    '2026-11-15T16:00:00.000Z',
    '2026-11-15T16:01:00.000Z',
    500,
    0,
  ),
  // lote antigo que falhou: a linha fica Com falha, mas a Última carga e o "x de y" são do lote mais recente (o concluído)
  clienteFalhou: lote(
    5,
    '8b14d0e3',
    'cliente',
    'falhou',
    '2026-11-14T12:00:00.000Z',
    '2026-11-14T12:00:45.000Z',
    500,
    500,
  ),
  estoqueFalhou: lote(
    6,
    '0e6b7f35',
    'estoque',
    'falhou',
    '2026-11-15T15:10:00.000Z',
    '2026-11-15T15:10:45.000Z',
    800,
    800,
  ),
  // falha geral (sem erro por linha): nada aplicado
  estoqueFalhouAntes: lote(
    7,
    '0e6b7f36',
    'estoque',
    'falhou',
    '2026-11-15T13:00:00.000Z',
    '2026-11-15T13:00:30.000Z',
    800,
    0,
  ),
  estoqueOk: lote(
    8,
    '0e6b7f37',
    'estoque',
    'concluido',
    '2026-11-15T11:00:00.000Z',
    '2026-11-15T11:05:00.000Z',
    800,
    0,
  ),
  // virada de dia no fuso: 03:50Z de 15/11 = 14/11 23:50 em Manaus
  nota: lote(
    9,
    '72f0d3ab',
    'nota',
    'concluido',
    '2026-11-15T03:50:00.000Z',
    '2026-11-15T04:05:00.000Z',
    12000,
    0,
  ),
  // virada de mês no fuso: 03:30Z de 01/11 = 31/10 23:30 em Manaus
  endereco: lote(
    10,
    'e19b55c0',
    'cliente_endereco',
    'concluido',
    '2026-11-01T03:30:00.000Z',
    '2026-11-01T03:31:05.000Z',
    1,
    0,
  ),
  // recebido 14/11 23:58 e falhou 15/11 00:03 em Manaus: a falha é do dia seguinte ao recebimento
  titulo: lote(
    11,
    'a4c81b96',
    'titulo',
    'falhou',
    '2026-11-15T03:58:00.000Z',
    '2026-11-15T04:03:00.000Z',
    50,
    0,
  ),
  // cancelado no BKO (10:00Z = 06:00 em Manaus): não aplicou nada, a célula Linhas fica vazia; não é reprocessável (Em dia)
  vendedor: lote(
    12,
    '5d7e9f10',
    'vendedor',
    'cancelado',
    '2026-11-15T10:00:00.000Z',
    '2026-11-15T10:02:00.000Z',
    40,
    0,
  ),
};
const LOTES = Object.values(L);
const CONECTORES = [{ conector_id: 'erp-matriz', versao_conector: '1.4.2' }];

/**
 * Esperado pela regra, linha a linha e NA ORDEM da tela (com falha primeiro; depois a carga mais recente):
 * [entidade, Entidade, Última carga, Situação, Linhas integradas, Reprocessar?, Histórico].
 * Última carga e Linhas integradas são do lote MAIS RECENTE da entidade: "falhou hh:mm" só quando ele falhou, senão "· n lotes" com
 * mais de um; integradas = recebidas − com erro, 0 no lote que falhou e vazio em andamento e no cancelado (RN-INT-15). "Com falha" = há lote
 * reprocessável (falhou ou concluído com avisos), o mesmo critério do botão Reprocessar.
 */
const LINHAS: Array<[string, string, string, string, string, boolean, string]> = [
  // concluído com avisos não é "falhou": a Última carga não leva a hora da falha
  ['preco', 'Preços', '15/11 às 13:00', 'Com falha', '1.180 de 1.240', true, 'Histórico (1)'],
  ['cliente', 'Clientes', '15/11 às 12:00 · 2 lotes', 'Com falha', '500 de 500', true, 'Histórico (2)'],
  ['estoque', 'Estoque', '15/11 às 11:10 · falhou 11:10', 'Com falha', '0 de 800', true, 'Histórico (3)'],
  // a falha é do dia seguinte ao recebimento: a hora da falha leva a data no formato curto (spec do designer; D-V1019-01 não é defeito)
  ['titulo', 'Títulos', '14/11 às 23:58 · falhou 15/11 00:03', 'Com falha', '0 de 50', true, 'Histórico (1)'],
  // em andamento: nada integrado ainda, a célula fica vazia
  ['rota', 'Rotas', '15/11 às 14:39', 'Em dia', '', false, 'Histórico (1)'],
  ['produto', 'Produtos', '15/11 às 14:20 · 2 lotes', 'Em dia', '3.500 de 3.500', false, 'Histórico (2)'],
  // cancelado: não aplicou linha nenhuma, a célula fica vazia (não "0 de 40")
  ['vendedor', 'Vendedores', '15/11 às 06:00', 'Em dia', '', false, 'Histórico (1)'],
  ['nota', 'Notas fiscais', '14/11 às 23:50', 'Em dia', '12.000 de 12.000', false, 'Histórico (1)'],
  ['cliente_endereco', 'Endereços de clientes', '31/10 às 23:30', 'Em dia', '1 de 1', false, 'Histórico (1)'],
];

const ERROS_ESTOQUE = {
  itens: [
    {
      indice: 4,
      external_id: 'EST-005',
      codigo: 'campo_obrigatorio',
      campo: 'quantidade',
      mensagem: 'Falta a quantidade.',
      reprocessavel: true,
    },
  ],
  total: 1,
};

/** RN-INT-08: os 5 números vêm PRONTOS em `MonitorResumo.resumo_pedidos` (a Integração calcula; a tela de Pedidos só formata). */
const RESUMO_PEDIDOS = {
  na_fila: 7,
  entregue_ao_conector: 1234,
  rejeitado_pelo_erp: 3,
  presos_sem_retorno: 2,
  retidos_sem_mapeamento: 5,
};
/** [testId, rótulo, valor exibido, classe de cor] — números de MonitorResumo.resumo_pedidos (contrato do Hub). */
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
    { id: uuid(201), nome: 'Ana Ribeiro' },
    { id: uuid(202), nome: 'Bruno Lima' },
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
  /**
   * `direto`: 200 para todo lote. `autorizar`: pede autorizador (403) e responde 422 até a 5ª senha, 429 depois.
   * `autorizar-ok`: pede autorizador (403) e aceita `senha-ficticia-certa`. `expirado`: o lote `estoqueFalhouAntes` responde 409
   * `conteudo_expirado` e os outros 200. `expirado-todos`: `estoqueFalhouAntes` 409 `conteudo_expirado` e `estoqueFalhou` 409
   * `lote_nao_pode_reprocessar`. `fora`: `estoqueFalhouAntes` 503 `servico_indisponivel` (erro que não é do lote).
   * `autorizar-limite`: como `autorizar-ok`, mas o 2º POST autorizado recebe 429 uma vez. `autorizar-expirado`: como `autorizar-ok`,
   * com `estoqueFalhouAntes` 409 `conteudo_expirado`.
   */
  reprocessar?:
    | 'direto'
    | 'autorizar'
    | 'autorizar-ok'
    | 'expirado'
    | 'expirado-todos'
    | 'fora'
    | 'autorizar-limite'
    | 'autorizar-expirado';
}

interface Chamadas {
  urls: string[];
  /** Lotes que receberam POST de reprocessar, na ordem, com o corpo. */
  reprocessados: Array<{ lote_id: string; autorizador_id?: string }>;
  /** Todo POST de reprocessar, na ordem, com ou sem sucesso. */
  tentados: string[];
}

/** Sessão fictícia no navegador + a API simulada (contratos Zod de integracao/vendedor/core). Devolve as chamadas feitas. */
async function preparar(page: Page, c: Cenario = {}): Promise<Chamadas> {
  const chamadas: Chamadas = { urls: [], reprocessados: [], tentados: [] };
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
  let limiteDado = false;
  await page.route('**/api-proxy/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/api-proxy(\/v1)?/, '');
    chamadas.urls.push(req.url());
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
        lotes_recentes: LOTES,
        conectores: CONECTORES,
        resumo_pedidos: RESUMO_PEDIDOS,
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
    if (/^\/integracao\/lotes\/[^/]+\/erros$/.test(p)) return json(200, ERROS_ESTOQUE);
    if (/^\/integracao\/lotes\/[^/]+\/reprocessar$/.test(p)) {
      const loteId = p.split('/')[3]!;
      const corpo = (req.postDataJSON() ?? {}) as { autorizador_id?: string; senha?: string };
      chamadas.tentados.push(loteId);
      const ok = () => {
        chamadas.reprocessados.push({
          lote_id: loteId,
          ...(corpo.autorizador_id ? { autorizador_id: corpo.autorizador_id } : {}),
        });
        return json(200, { lote_id: loteId, reenfileiradas: 0, status: 'recebido' });
      };
      const modo = c.reprocessar ?? 'direto';
      const antes = loteId === L.estoqueFalhouAntes.lote_id;
      if (modo === 'direto') return ok();
      if (modo === 'expirado') return antes ? json(409, EXPIRADO) : ok();
      if (modo === 'expirado-todos') return json(409, antes ? EXPIRADO : NAO_PODE);
      if (modo === 'fora') return antes ? json(503, FORA) : ok();
      if (!corpo.autorizador_id)
        return json(403, { codigo: 'autorizador_necessario', mensagem: 'Escolha quem autoriza.' });
      const certa = corpo.senha === 'senha-ficticia-certa';
      if (modo === 'autorizar-ok' && certa) return ok();
      if (modo === 'autorizar-expirado' && certa) return antes ? json(409, EXPIRADO) : ok();
      if (modo === 'autorizar-limite' && certa) {
        if (antes || limiteDado) return ok();
        limiteDado = true;
        return json(429, LIMITE);
      }
      tentativas++;
      return tentativas > 5
        ? // a mensagem do 429 é a da API (modules/integracao/domain/status-lote.ts); a tela mostra o que vem
          json(429, {
            codigo: 'muitas_tentativas',
            mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.',
          })
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
  return chamadas;
}

const EXPIRADO = {
  codigo: 'conteudo_expirado',
  mensagem: 'O conteúdo deste lote já foi apagado. Peça ao Conector para reenviar a carga.',
};
const NAO_PODE = { codigo: 'lote_nao_pode_reprocessar', mensagem: 'Este lote não pode ser reprocessado.' };
const FORA = {
  codigo: 'servico_indisponivel',
  mensagem: 'Serviço fora do ar. Tente de novo em alguns minutos.',
};
const LIMITE = {
  codigo: 'muitas_tentativas',
  mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.',
};
/** Rótulo do lote na mensagem: `o lote de dd/mm às hh:mm` do recebimento em Manaus (13:00Z = 09:00; 15:10Z = 11:10). */
const ANTES = 'o lote de 15/11 às 09:00';
const DEPOIS = 'o lote de 15/11 às 11:10';

/** Área dos avisos (toasts) do BKO. */
const avisos = (page: Page) => page.locator('div[aria-live="polite"].fixed');

async function abrirMonitor(page: Page) {
  await page.goto('/integracao');
  await expect(page.getByTestId('integracao.entidades')).toBeVisible({ timeout: 120_000 });
}

const celulas = async (page: Page, testId: string) =>
  (await page.getByTestId(testId).locator('td').allInnerTexts()).map((t) => t.trim());

test.describe('T-0173 e v1.0.19 — Integração ERP (API simulada)', () => {
  test('RF-INT-04: cabeçalho com conector, versão e última carga; uma linha por entidade com Última carga, Situação, "x de y" e ações', async ({
    page,
  }) => {
    await preparar(page);
    await abrirMonitor(page);
    await expect(page.locator('h1').first()).toHaveText('Integração ERP');
    await expect(page.getByTestId('integracao.monitor.atualizar')).toHaveText('Atualizar');
    // cabeçalho: conector e versão do lote mais recente (rota, 18:39:50Z = 14:39 em Manaus)
    await expect(page.locator('main')).toContainText(
      'erp-matriz · v1.4.2 · última carga recebida 15/11 às 14:39',
    );

    const cab = (await page.locator('[data-testid="integracao.entidades"] thead th').allTextContents()).map(
      (t) => t.trim(),
    );
    expect(cab).toEqual(['Entidade', 'Última carga', 'Situação', 'Linhas integradas', '']);
    const ordem = await page
      .locator('[data-testid="integracao.entidades"] tbody tr')
      .evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-testid')));
    expect(ordem, 'uma linha por entidade; com falha primeiro, depois a carga mais recente').toEqual(
      LINHAS.map(([e]) => `integracao.entidade.${e}`),
    );

    for (const [entidade, rotulo, ultima, situacao, linhas, reprocessar, historico] of LINHAS) {
      const cel = await celulas(page, `integracao.entidade.${entidade}`);
      expect(cel[0], entidade).toBe(rotulo);
      expect(cel[1], `${entidade}: Última carga`).toBe(ultima);
      expect(cel[2], `${entidade}: Situação`).toBe(situacao);
      expect(cel[3], `${entidade}: Linhas integradas`).toBe(linhas);
      await expect(
        page.getByTestId(`integracao.entidade.reprocessar.${entidade}`),
        `${entidade}: Reprocessar`,
      ).toHaveCount(reprocessar ? 1 : 0);
      await expect(page.getByTestId(`integracao.entidade.historico.${entidade}`)).toHaveText(historico);
    }

    // coluna Última carga com 300px: o texto mais longo (Títulos, com a data da falha) cabe numa linha só a 1366×768
    const larguraUltima = await page
      .locator('[data-testid="integracao.entidades"] thead th')
      .nth(1)
      .evaluate((th) => Math.round(th.getBoundingClientRect().width));
    expect(larguraUltima, 'largura da coluna Última carga').toBe(300);
    const linhasDoTexto = await page
      .getByTestId('integracao.entidade.titulo')
      .locator('td')
      .nth(1)
      .evaluate((td) => {
        const r = document.createRange();
        r.selectNodeContents(td);
        return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size;
      });
    expect(linhasDoTexto, 'Última carga do Títulos numa linha').toBe(1);

    // a lista de lotes e os filtros Entidade e Status saíram
    await expect(page.getByTestId('integracao.lotes')).toHaveCount(0);
    await expect(page.getByTestId('integracao.filtro-status')).toHaveCount(0);
    await expect(page.getByTestId('integracao.filtro-entidade')).toHaveCount(0);
    const conteudo = await page.getByTestId('pagina-integracao-monitor-conteudo').innerText();
    for (const fora of ['Duração', 'Conclusão', 'De-para', 'Pedidos no ERP', 'Exportar', 'Só com erro', '—'])
      expect(conteudo, `"${fora}" saiu da tela`).not.toContain(fora);
  });

  test('RF-INT-04: Histórico (n) abre os lotes da entidade; "Reprocessar os 2 lotes" refaz do mais antigo ao mais recente', async ({
    page,
  }) => {
    const chamadas = await preparar(page);
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.historico.estoque').click();
    await expect(page).toHaveURL(/historico=estoque/);
    const dialogo = page.locator('[role="dialog"]').filter({ has: page.getByTestId('integracao.historico') });
    await expect(dialogo).toContainText('Histórico — Estoque');
    await expect(dialogo).toContainText('erp-matriz · 3 lotes');
    const cab = (
      await dialogo.locator('[data-testid="integracao.historico.lotes"] thead th').allTextContents()
    ).map((t) => t.trim());
    expect(cab).toEqual(['Recebido', 'Falhou', 'Situação', 'Linhas', '']);
    const linhas = dialogo.locator('[data-testid="integracao.historico.lotes"] tbody tr');
    await expect(linhas).toHaveCount(3);
    // Recebido `dd/mm hh:mm` (célula de tabela); Falhou só a hora no mesmo dia do recebimento
    const esperado = [
      ['15/11 11:10', '11:10', 'Com falha', '0 de 800'],
      ['15/11 09:00', '09:00', 'Com falha', '0 de 800'],
      ['15/11 07:00', '', 'Concluído', '800 de 800'],
    ];
    for (let i = 0; i < esperado.length; i++) {
      const cel = (await linhas.nth(i).locator('td').allInnerTexts()).map((t) => t.trim());
      expect(cel.slice(0, 4), `lote ${i + 1} do histórico`).toEqual(esperado[i]);
    }
    // Cancelar só em andamento (RN-INT-15): nenhum lote do Estoque está em andamento; Ver erros só no lote que falhou ou tem erro
    await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);
    await expect(dialogo.getByRole('button', { name: 'Ver erros' })).toHaveCount(2);
    await expect(page.getByTestId(`integracao.lote.ver-erros.${L.estoqueOk.lote_id}`)).toHaveCount(0);

    await expect(dialogo.getByTestId('integracao.historico.reprocessar')).toHaveText(
      'Reprocessar os 2 lotes',
    );
    await dialogo.getByTestId('integracao.historico.reprocessar').click();
    await expect(page.getByText('Reprocessamento iniciado.')).toBeVisible();
    await expect(page.getByTestId('integracao.historico')).toHaveCount(0);
    expect(chamadas.reprocessados.map((r) => r.lote_id)).toEqual([
      L.estoqueFalhouAntes.lote_id,
      L.estoqueFalhou.lote_id,
    ]);
  });

  test('RN-INT-15: lote em andamento leva Cancelar no Histórico; Reprocessar da linha refaz o único lote com avisos', async ({
    page,
  }) => {
    const chamadas = await preparar(page);
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.historico.rota').click();
    const dialogo = page.locator('[role="dialog"]').filter({ has: page.getByTestId('integracao.historico') });
    await expect(dialogo.getByTestId(`integracao.lote.cancelar.${L.rota.lote_id}`)).toHaveCount(1);
    // em andamento: Linhas vazia e sem Ver erros
    const rota = (
      await dialogo
        .locator('[data-testid="integracao.historico.lotes"] tbody tr')
        .first()
        .locator('td')
        .allInnerTexts()
    ).map((t) => t.trim());
    expect(rota.slice(0, 4)).toEqual(['15/11 14:39', '', 'Em andamento', '']);
    await expect(page.getByTestId(`integracao.lote.ver-erros.${L.rota.lote_id}`)).toHaveCount(0);
    await expect(dialogo.getByTestId('integracao.historico.reprocessar')).toHaveCount(0);
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    await expect(page).not.toHaveURL(/historico=/);

    await page.getByTestId('integracao.entidade.reprocessar.preco').click();
    await expect(page.getByText('Reprocessamento iniciado.')).toBeVisible();
    expect(chamadas.reprocessados.map((r) => r.lote_id)).toEqual([L.preco.lote_id]);
  });

  test('RF-INT-04: "Ver erros" abre a gaveta do lote com a data e a hora da falha e os erros por linha', async ({
    page,
  }) => {
    await preparar(page);
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.historico.estoque').click();
    await page.getByTestId(`integracao.lote.ver-erros.${L.estoqueFalhou.lote_id}`).click();
    await expect(page).toHaveURL(new RegExp(`lote=${L.estoqueFalhou.lote_id}`));
    const detalhe = page.getByTestId('integracao.lote-detalhe');
    await expect(detalhe).toBeVisible();
    // 15:10:45Z = 11:10 em Manaus
    await expect(detalhe).toContainText('Com falha');
    await expect(detalhe).toContainText('falhou em 15/11/2026 11:10');
    await expect(detalhe.getByTestId('integracao.erros')).toContainText('Falta a quantidade.');
    await expect(detalhe.getByTestId('integracao.erros')).toContainText('EST-005');
    // com a gaveta aberta o Histórico some
    await expect(page.getByTestId('integracao.historico')).toHaveCount(0);
  });

  test('RN-INT-16: sem permissão, o popup pede a senha de quem autoriza; erro limpa a senha; 429 avisa; a senha nunca vai na URL', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'autorizar' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    const dialogo = page.locator('[role="dialog"]').filter({ hasText: 'Autorizar reprocessamento' });
    await expect(dialogo).toBeVisible();
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
    expect(chamadas.urls.filter((u) => u.includes('senha-ficticia'))).toEqual([]);
    expect(chamadas.reprocessados).toEqual([]);
  });

  test('RN-INT-16: uma autorização vale para os n lotes da entidade, com quem autorizou em cada chamada', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'autorizar-ok' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    await page.locator('#integracao-autorizar-senha').fill('senha-ficticia-certa');
    await page.getByTestId('integracao.autorizar.confirmar').click();
    await expect(page.getByText('Reprocessamento iniciado.')).toBeVisible();
    await expect(
      page.locator('[role="dialog"]').filter({ hasText: 'Autorizar reprocessamento' }),
    ).toHaveCount(0);
    const quem = AUTORIZADORES.itens[0]!.id;
    expect(chamadas.reprocessados).toEqual([
      { lote_id: L.estoqueFalhouAntes.lote_id, autorizador_id: quem },
      { lote_id: L.estoqueFalhou.lote_id, autorizador_id: quem },
    ]);
    expect(chamadas.urls.filter((u) => u.includes('senha-ficticia'))).toEqual([]);
  });

  test('RN-INT-15: lote com o conteúdo apagado (409) não impede os outros; o aviso diz quantos foram e qual falhou (D-V1019-02)', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'expirado' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    await expect(avisos(page)).toContainText(
      `1 de 2 lotes reprocessados. Falhou ${ANTES}: ${EXPIRADO.mensagem}`,
    );
    // do mais antigo (o que expirou) ao mais recente, que tem de ir
    expect(chamadas.tentados).toEqual([L.estoqueFalhouAntes.lote_id, L.estoqueFalhou.lote_id]);
    expect(chamadas.reprocessados.map((r) => r.lote_id)).toEqual([L.estoqueFalhou.lote_id]);
    await expect(avisos(page)).not.toContainText('Reprocessamento iniciado.');
  });

  test('RN-INT-15: todos os lotes com erro do próprio lote: "Nenhum lote reprocessado." e cada falha com a sua mensagem', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'expirado-todos' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.historico.estoque').click();
    await page.getByTestId('integracao.historico.reprocessar').click();
    await expect(avisos(page)).toContainText(
      `Nenhum lote reprocessado. Falhou ${ANTES}: ${EXPIRADO.mensagem} Falhou ${DEPOIS}: ${NAO_PODE.mensagem}`,
    );
    await expect(avisos(page)).not.toContainText('0 de 2');
    expect(chamadas.tentados).toEqual([L.estoqueFalhouAntes.lote_id, L.estoqueFalhou.lote_id]);
    expect(chamadas.reprocessados).toEqual([]);
  });

  test('RN-INT-15: erro que não é do lote (serviço fora) para a fila e não tenta os outros', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'fora' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    await expect(avisos(page)).toContainText(`Nenhum lote reprocessado. Falhou ${ANTES}: ${FORA.mensagem}`);
    expect(chamadas.tentados).toEqual([L.estoqueFalhouAntes.lote_id]);
    expect(chamadas.reprocessados).toEqual([]);
    // o popup de senha não abre: não é caso de autorização
    await expect(
      page.locator('[role="dialog"]').filter({ hasText: 'Autorizar reprocessamento' }),
    ).toHaveCount(0);
  });

  test('RN-INT-16: limite (429) no meio da fila mantém o popup só com os lotes restantes; o que já foi não é refeito', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'autorizar-limite' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    const dialogo = page.locator('[role="dialog"]').filter({ hasText: 'Autorizar reprocessamento' });
    const senha = page.locator('#integracao-autorizar-senha');
    await senha.fill('senha-ficticia-certa');
    await page.getByTestId('integracao.autorizar.confirmar').click();
    await expect(dialogo).toContainText(LIMITE.mensagem);
    await expect(senha).toHaveValue('');
    expect(chamadas.reprocessados.map((r) => r.lote_id)).toEqual([L.estoqueFalhouAntes.lote_id]);

    await senha.fill('senha-ficticia-certa');
    await page.getByTestId('integracao.autorizar.confirmar').click();
    await expect(avisos(page)).toContainText('Reprocessamento iniciado.');
    await expect(dialogo).toHaveCount(0);
    const quem = AUTORIZADORES.itens[0]!.id;
    // 1º POST sem autorizador (403, abre o popup); com a senha: o 1º lote vai, o 2º leva 429; a 2ª autorização vai só para o lote
    // que faltava (sem 409 `lote_nao_pode_reprocessar` no que já foi)
    expect(chamadas.tentados).toEqual([
      L.estoqueFalhouAntes.lote_id,
      L.estoqueFalhouAntes.lote_id,
      L.estoqueFalhou.lote_id,
      L.estoqueFalhou.lote_id,
    ]);
    expect(chamadas.reprocessados).toEqual([
      { lote_id: L.estoqueFalhouAntes.lote_id, autorizador_id: quem },
      { lote_id: L.estoqueFalhou.lote_id, autorizador_id: quem },
    ]);
    expect(chamadas.urls.filter((u) => u.includes('senha-ficticia'))).toEqual([]);
  });

  test('RN-INT-16: no popup, lote com o conteúdo apagado segue com os outros e fecha com o aviso parcial', async ({
    page,
  }) => {
    const chamadas = await preparar(page, { reprocessar: 'autorizar-expirado' });
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.reprocessar.estoque').click();
    await page.locator('#integracao-autorizar-senha').fill('senha-ficticia-certa');
    await page.getByTestId('integracao.autorizar.confirmar').click();
    await expect(avisos(page)).toContainText(
      `1 de 2 lotes reprocessados. Falhou ${ANTES}: ${EXPIRADO.mensagem}`,
    );
    await expect(
      page.locator('[role="dialog"]').filter({ hasText: 'Autorizar reprocessamento' }),
    ).toHaveCount(0);
    expect(chamadas.reprocessados.map((r) => r.lote_id)).toEqual([L.estoqueFalhou.lote_id]);
  });

  test('RN-INT-15: lote cancelado no Histórico: Situação Cancelado, Linhas vazia, sem Cancelar, Ver erros nem Reprocessar', async ({
    page,
  }) => {
    await preparar(page);
    await abrirMonitor(page);
    await page.getByTestId('integracao.entidade.historico.vendedor').click();
    const dialogo = page.locator('[role="dialog"]').filter({ has: page.getByTestId('integracao.historico') });
    await expect(dialogo).toContainText('Histórico — Vendedores');
    const cel = (
      await dialogo
        .locator('[data-testid="integracao.historico.lotes"] tbody tr')
        .first()
        .locator('td')
        .allInnerTexts()
    ).map((t) => t.trim());
    expect(cel.slice(0, 4)).toEqual(['15/11 06:00', '', 'Cancelado', '']);
    await expect(page.getByTestId(`integracao.lote.cancelar.${L.vendedor.lote_id}`)).toHaveCount(0);
    await expect(page.getByTestId(`integracao.lote.ver-erros.${L.vendedor.lote_id}`)).toHaveCount(0);
    await expect(dialogo.getByTestId('integracao.historico.reprocessar')).toHaveCount(0);
  });

  test('De-para na seção Integração de Parâmetros (item Parâmetros aceso; seção fora do menu), com Alertas, folha e vazio', async ({
    page,
  }) => {
    await preparar(page);
    await page.goto('/parametros/integracao');
    await expect(page.getByRole('heading', { name: 'De-para de códigos' })).toBeVisible({ timeout: 120_000 });
    const menu = page.getByTestId('menu-bko');
    await expect(menu.getByTestId('nav-plataforma-parametros')).toHaveAttribute('aria-current', 'page');
    await expect(menu.locator('a[href="/parametros/integracao"]')).toHaveCount(0);
    await expect(page.getByTestId('parametros-secao-integracao')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('parametros-integracao-de-para')).toBeVisible();
    await expect(page.locator('main')).toContainText('5 pedidos retidos: condição 28D sem código do ERP');
    await page.getByRole('button', { name: 'Novo de-para' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Novo de-para' })).toBeVisible();
  });

  test('De-para vazio: só o texto, "Novo de-para" só no cabeçalho, sem filtros nem busca (RD-0967)', async ({
    page,
  }) => {
    await preparar(page, { mapeamentosVazio: true });
    await page.goto('/parametros/integracao');
    await expect(page.getByText('Nenhum de-para ainda.')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Novo de-para' })).toHaveCount(1);
    await expect(page.getByTestId('integracao.mapeamento.filtro-entidade')).toHaveCount(0);
    await expect(page.getByTestId('integracao.mapeamento.busca')).toHaveCount(0);
  });

  test('RN-INT-08: os 5 cards de Pedidos mostram os números prontos de MonitorResumo.resumo_pedidos, só informativos', async ({
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
      expect(erros).toEqual([]);
      await page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros').click();
      await expect(page.getByTestId('pagina-parametros')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('parametros-secao-integracao')).toHaveCount(0);
    });
  }
});

/**
 * Portal `config.` (RN-INT-15): o selo do cartão da base usa os MESMOS 5 status da tela do BKO (`rotuloDoLote` da Integração),
 * inclusive `cancelado` (lote cancelado no BKO) e "Em andamento" (o Hub segue gravando depois do prazo de espera da tela).
 * Host `config.localhost` (o Chromium resolve `*.localhost` para o próprio aparelho); sessão fictícia do time da Macuxi.
 */
const TENANT_PORTAL = '0f000000-0000-4000-8000-0000000000aa';
const BASES_PORTAL: Array<[string, string, string]> = [
  ['filial', 'concluido', 'Concluído'],
  ['vendedor', 'concluido_com_erros', 'Concluído com avisos'],
  ['cliente', 'falhou', 'Com falha'],
  ['produto', 'cancelado', 'Cancelado'],
  ['preco', 'processando', 'Em andamento'],
];
const lotePortal = (i: number) => `0c000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

test('RN-INT-15: portal config. — o selo da carga mostra os 5 status, sem os rótulos antigos', async ({
  page,
  baseURL,
}) => {
  const portal = (baseURL ?? 'http://localhost:3000').replace('//localhost', '//config.localhost');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.install({ time: new Date(AGORA) });
  const agoraMs = Date.parse(AGORA);
  await page.addInitScript((s) => sessionStorage.setItem('macuxi.portal.sessao', JSON.stringify(s)), {
    token: 'token-ficticio-do-portal-0123456789',
    expira_em: new Date(agoraMs + 4 * 3600_000).toISOString(),
    sessao_expira_em: new Date(agoraMs + 8 * 3600_000).toISOString(),
    tipo: 'super_admin',
    empresa: null,
    empresas: [],
  });
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  await page.route('**/api-proxy/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^\/api-proxy(\/v1)?/, '');
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/plataforma/empresas')
      return json(200, {
        itens: [
          {
            id: TENANT_PORTAL,
            codigo: 'DIST01',
            razao_social: 'Distribuidora Fictícia Ltda',
            cnpj: '11222333000181',
            fuso: FUSO,
            status: 'ativo',
            criada_em: '2026-11-01T12:00:00.000Z',
            modulos: [
              { modulo: 'core', licencas: 10 },
              { modulo: 'integracao', licencas: null },
            ],
          },
        ],
      });
    if (p === '/integracao/ordem-carga')
      return json(200, {
        itens: BASES_PORTAL.map(([entidade], i) => ({
          entidade,
          posicao: i + 1,
          opcional: false,
          depende_de: [],
        })),
      });
    if (p === '/integracao/cargas-arquivo' && req.method() === 'POST') {
      const corpo = req.postDataJSON() as { entidade: string; modo?: string };
      const id = lotePortal(BASES_PORTAL.findIndex(([e]) => e === corpo.entidade));
      return json(202, {
        lote_id: id,
        status: 'recebido',
        entidade: corpo.entidade,
        modo: corpo.modo ?? 'delta',
        recebidos: 2,
        repetido: false,
        consulta: `/integracao/v1/lotes/${id}`,
        conector_id: 'portal-arquivo',
        linhas_lidas: 2,
        linhas_invalidas_leitura: 0,
      });
    }
    if (/^\/integracao\/lotes\/[^/]+\/erros$/.test(p)) return json(200, { itens: [], total: 0 });
    const m = p.match(/^\/integracao\/lotes\/([^/]+)$/);
    if (m) {
      const i = BASES_PORTAL.findIndex((_b, j) => lotePortal(j) === m[1]);
      const [entidade, status] = BASES_PORTAL[i]!;
      return json(200, {
        lote_id: m[1],
        entidade,
        modo: 'delta',
        status,
        contagens: {
          recebidas: 2,
          duplicadas_no_lote: 0,
          com_erro: 0,
          novas: 2,
          atualizadas: 0,
          inalteradas: 0,
          obsoletas: 0,
        },
        erros: [],
        avisos: [],
        cursor: null,
        inativadas: 0,
        recebido_em: AGORA,
        concluido_em: status === 'processando' ? null : AGORA,
      });
    }
    return json(404, { codigo: 'nao_encontrado', mensagem: 'Rota não simulada.' });
  });

  await page.goto(`${portal}/empresas/${TENANT_PORTAL}`);
  await expect(page.getByTestId('base-preco')).toBeVisible({ timeout: 120_000 });
  for (const [entidade] of BASES_PORTAL) {
    await page.getByTestId(`base-${entidade}.arquivo`).setInputFiles({
      name: `${entidade}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from('external_id,nome\nX-001,Linha um\nX-002,Linha dois\n'),
    });
    await expect(page.getByTestId(`base-${entidade}.importar`)).toBeEnabled();
    await page.getByTestId(`base-${entidade}.importar`).click();
    // "Em andamento": o Hub segue gravando além dos 15 min de espera da tela
    // só depois da 1ª leitura do lote (fase "gravando"): antes disso a espera ainda não marcou o início
    if (entidade === 'preco') {
      await expect(page.getByTestId('base-preco.progresso')).toContainText('Gravando o arquivo');
      await page.clock.fastForward('16:00');
    }
    await expect(page.getByTestId(`base-${entidade}.resultado`)).toBeAttached({ timeout: 60_000 });
  }
  for (const [entidade, , rotulo] of BASES_PORTAL) {
    const linhas = (await page.getByTestId(`base-${entidade}`).innerText()).split('\n').map((l) => l.trim());
    expect(linhas, `base ${entidade}`).toContain(rotulo);
  }
  const todas = (await page.getByTestId('empresa-pagina.bases').innerText()).split('\n').map((l) => l.trim());
  for (const velho of ['Na fila', 'Gravando', 'Concluído com erros', 'Falhou'])
    expect(todas, velho).not.toContain(velho);
  // RD-0968: o cartão em andamento tem o selo e só a ação; o "Gravando no Hub…" e o aviso longo saíram
  const preco = await page.getByTestId('base-preco').innerText();
  expect(preco).toContain('Volte daqui a pouco para ver o resultado.');
  for (const velho of ['Gravando no Hub', 'O Hub continua gravando'])
    expect(preco, velho).not.toContain(velho);
  expect(erros).toEqual([]);
});
