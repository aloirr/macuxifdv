/**
 * T-0140 (teste de campo de 08/11 à noite, branch claude/relaxed-johnson-w2afvp aplicado à mão) — o que dá para provar sem
 * aparelho: (A) "Novo pedido" não fecha mais o app, pela ficha, pela Rota e pelo Catálogo; (B) o link do recado só navega para
 * tela que o perfil tem (RN-CORE-23; regra única do SDK `linkInternoNavegavel` desde a RD-0032). Sem banco: roda local e no CI.
 * Matriz e roteiro do aparelho: docs/testes/T-0140.md.
 *
 * (B) desde o 8b79045 (T-0170; D2, R-20261113-054158; RD-0249) o cartão Recados saiu do Início e o recado ficou só no sino:
 * `destinoDaNotificacao` e `recadosDoInicio` (apps/mobile/src/lib/inicio.ts) foram apagados. Hoje o toque no recado mora no Core,
 * em três entradas: o balão do sino (`BalaoRecadosETarefas`), a tela "Recados e tarefas" e a central antiga (`TelaNotificacoes`);
 * as três chamam `linkInternoNavegavel(link, (c) => visao.pagina(c) !== null)`. O shell só abre o balão, o "Ver todos"
 * (`destinoVerTodos`) e a tarefa (`destinoDaTarefa`), em apps/mobile/src/lib/sino.ts.
 * Convenção (a de kit-piloto-t0162.test.ts): `it` = vale hoje; `it.fails` = desvio aberto D-T0140-n (fica vermelho quando
 * corrigido e vira `it` no mesmo commit).
 * - D-T0140-1 (modulo-core, balao-recados-e-tarefas.tsx): no balão, recado com link para tela que o perfil não tem (ex.: /m/rota
 *   no Gestão, /m/core-rota) fecha o balão e não abre nada; a regra manda para a central ("Recados e tarefas").
 *
 * (A) A causa era hook depois de `return` antecipado no `OrderEditor` (o 1º render saía em "Cliente não encontrado", o 2º chamava
 * mais hooks e o React lançava; sem tela de erro no build, o Android fechava o app). As telas importam react-native e não
 * renderizam no Node; a prova é o ESLint REAL do repositório (eslint.config.mjs → packages/config, `react-hooks/rules-of-hooks`)
 * sobre as telas do lote, mais a prova de que a regra pega o defeito original. As três entradas (ficha, check-in da Rota e
 * Catálogo) chamam a mesma `irParaNovoPedido` (modules/vendedor/app/rotas.ts), com o roteador simulado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const empurrados: string[] = [];
vi.mock('expo-router', () => ({
  router: {
    push: (h: string) => empurrados.push(h),
    navigate: (h: string) => empurrados.push(h),
    replace: (h: string) => empurrados.push(h),
  },
}));

import { caminhoDoLinkInterno as caminhoDoLink, linkInternoNavegavel as linkNavegavel } from '@macuxi/platform-sdk';
import { destinoDaTarefa, destinoVerTodos } from '../../apps/mobile/src/lib/sino';
import { CAMINHO_NOVO_PEDIDO, hrefNovoPedido, irParaNovoPedido } from '../../modules/vendedor/app/rotas';
import { CHECKIN_NA_FICHA, SO_ORCAMENTO } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

// ---------------------------------------------------------------- (A) Novo pedido sem fechar o app
/** Telas tocadas pelo lote e as que levam ao Novo pedido (ficha, Rota, Catálogo), mais as telas de erro do shell. */
const TELAS_DO_LOTE = [
  'modules/vendedor/app/screens/new-order-screen.tsx',
  'modules/vendedor/app/screens/order-detail-screen.tsx',
  'modules/vendedor/app/screens/orders-screen.tsx',
  'modules/core/app/telas/cliente.tsx',
  'modules/core/app/telas/rota.tsx',
  'modules/core/app/telas/notificacoes.tsx',
  'modules/core/app/components/open-visit-bar.tsx',
  'modules/core/app/components/visit-sheets.tsx',
  'modules/core/app/components/checkin-sheet.tsx',
  'modules/catalogo/app/telas/catalogo.tsx',
  'modules/catalogo/app/telas/comum.tsx',
  'apps/mobile/src/components/tela-de-erro.tsx',
  'apps/mobile/src/app/_layout.tsx',
  'apps/mobile/src/app/(tabs)/index.tsx',
  'apps/mobile/src/app/(tabs)/m/[...caminho].tsx',
  'apps/mobile/src/app/profile.tsx',
];

const eslint = new ESLint({ cwd: RAIZ });

describe('T-0140 A — Novo pedido sem fechar o app (regra dos hooks, RF-VEN-05)', () => {
  it('A1. a regra `react-hooks/rules-of-hooks` está ligada como ERRO nas telas (.tsx) pela configuração real do repositório', async () => {
    for (const f of ['modules/vendedor/app/screens/new-order-screen.tsx', 'modules/core/app/telas/cliente.tsx', 'apps/mobile/src/app/_layout.tsx']) {
      const cfg = (await eslint.calculateConfigForFile(join(RAIZ, f))) as { rules?: Record<string, unknown> };
      const r = cfg.rules?.['react-hooks/rules-of-hooks'];
      expect(Array.isArray(r) ? r[0] : r, f).toBe(2);
    }
  });

  it('A2. a regra pega o defeito original: hook depois do `return` antecipado ("Cliente não encontrado") é erro de lint', async () => {
    const defeito = `
      import { useMemo, useState } from 'react';
      export function OrderEditor({ customerId, clientes }: { customerId: string; clientes: string[] }) {
        const [aba] = useState('venda');
        if (!clientes.includes(customerId)) return null; // 1º render: carga ainda vazia
        const total = useMemo(() => aba.length, [aba]); // 2º render: hook a mais → o React lança
        return total;
      }`;
    const [r] = await eslint.lintText(defeito, { filePath: join(RAIZ, 'modules/vendedor/app/screens/__sintetico-t0140.tsx') });
    expect(r!.messages.filter((m) => m.ruleId === 'react-hooks/rules-of-hooks').length).toBeGreaterThan(0);
  });

  it('A3. nenhuma violação da regra dos hooks no Novo pedido, no detalhe, na ficha, na Rota, no Catálogo e nas telas de erro', async () => {
    const resultados = await eslint.lintFiles(TELAS_DO_LOTE.map((f) => join(RAIZ, f)));
    const violacoes = resultados.flatMap((r) => r.messages.filter((m) => m.ruleId === 'react-hooks/rules-of-hooks').map((m) => `${r.filePath}:${m.line} ${m.message}`));
    expect(violacoes).toEqual([]);
    expect(resultados).toHaveLength(TELAS_DO_LOTE.length);
  }, 120_000);

  it('A4. o editor espera a carga do aparelho antes de decidir "Cliente não encontrado" (o 1º render não sai cedo)', () => {
    const editor = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    const corpo = editor.slice(editor.indexOf('function OrderEditor('));
    const espera = corpo.indexOf('if (!app.carregado) return <Loading />;');
    expect(espera).toBeGreaterThan(0);
    expect(corpo.indexOf('titulo="Cliente não encontrado"')).toBeGreaterThan(espera);
  });

  describe('A5. as três entradas abrem a MESMA tela pela mesma rota (`irParaNovoPedido`)', () => {
    beforeEach(() => {
      empurrados.length = 0;
    });
    const C = '11111111-1111-4111-8111-111111111111';
    const V = '22222222-2222-4222-8222-222222222222';
    const S = '33333333-3333-4333-8333-333333333333';

    it('ficha do cliente (slot cliente.acoes): /m/novo-pedido?customerId=…', () => {
      irParaNovoPedido({ customerId: C });
      expect(empurrados).toEqual([`/m/novo-pedido?customerId=${C}`]);
    });
    it('com atendimento aberto (ficha aberta pela Rota): leva a visita e a parada', () => {
      irParaNovoPedido({ customerId: C, visitId: V, stopId: S });
      expect(empurrados).toEqual([`/m/novo-pedido?customerId=${C}&visitId=${V}&stopId=${S}`]);
    });
    it('sem cliente: /m/novo-pedido (abre o seletor de cliente, não o editor; era a entrada do Catálogo antes do R-20261114-151000)', () => {
      irParaNovoPedido({ customerId: undefined });
      expect(empurrados).toEqual(['/m/novo-pedido']);
    });
    it('o caminho é a página `novo-pedido` registrada no manifesto do shell e o link é navegável', () => {
      for (const h of [hrefNovoPedido({ customerId: C }), hrefNovoPedido({ customerId: C, visitId: V, stopId: S }), hrefNovoPedido()]) {
        expect(caminhoDoLink(h)).toBe(CAMINHO_NOVO_PEDIDO);
        expect(linkNavegavel(h)).toBe(h);
      }
      expect(ler('modules/vendedor/app/index.ts')).toMatch(/\{ id: 'novo-pedido', caminho: 'novo-pedido',[^}]*componente: NewOrderScreen \}/);
    });
    it('as extensões usam a mesma função: ficha e check-in (cliente.acoes) e Catálogo (produto.acoes)', () => {
      const idx = ler('modules/vendedor/app/index.ts');
      expect(idx).toContain('abrir: (ctx) => irParaNovoPedido({ customerId: ctx.clienteId, visitId: ctx.visitaId ?? undefined, stopId: ctx.paradaId ?? undefined })');
      // R-20261114-151000 (Catálogo só para consulta): com o PR do Vendedor, o Catálogo abre a folha do orçamento e não o novo
      // pedido; isso é conferido em tests/modulos/catalogo-so-consulta-r20261114.test.ts. Aqui ficam a ficha e o check-in.
      if (!SO_ORCAMENTO) expect(idx).toMatch(/slot: 'produto\.acoes'[\s\S]*?irParaNovoPedido\(origem \?\? \{ customerId: ctx\.clienteId \?\? undefined \}\)/);
      const ficha = ler('modules/core/app/telas/cliente.tsx');
      const folha = ler('modules/core/app/components/checkin-sheet.tsx');
      if (CHECKIN_NA_FICHA) {
        // PR #258 (R-20261114-150000/150500): a folha do check-in não oferece mais "Novo pedido"; o rodapé dela só fecha e volta à
        // ficha (`checkin-abrir-ficha`) e o único "+ Novo pedido" é o do rodapé da ficha, com o contexto (visita aberta incluída)
        expect(folha).toMatch(/onPress: onClose, testID: 'checkin-abrir-ficha'/);
        expect(folha).not.toMatch(/checkin-new-order|AcaoDaFolha|\bacao\b|rotulo="[^"]*Novo pedido/);
        expect(ficha).not.toMatch(/checkin-new-order|acaoDestaque/);
        expect(ficha.slice(ficha.indexOf('<CheckinSheet'))).not.toMatch(/\bacao=/);
        expect(ficha).toMatch(/(acoesDoRodapeCliente\(acoes\)|acoesRodape)\.map\([\s\S]*?onPress=\{\(\) => a\.payload\.abrir\(contexto\)\}/);
      } else {
        // até o #258: a folha do check-in (aberta pela Rota) chama a MESMA ação de destaque da ficha, com a visita recém-aberta
        expect(ficha).toMatch(/testID: 'checkin-new-order'[\s\S]*?acaoDestaque\.payload\.abrir\(\{ \.\.\.contexto, visitaId \}\)/);
      }
      // #385: o título da origem vem do filtro da rota (tituloDaRota), não mais o texto fixo 'Rota de hoje'
      const rota = ler('modules/core/app/telas/rota.tsx');
      expect(rota).toMatch(/const titulo = tituloDaRota\(filtro\);[\s\S]*?abrirCliente\(s\.customer\.id, titulo, true\)/);
    });
    it('a tela decide editor × seletor só pelo `customerId` e remonta o editor por cliente (chave)', () => {
      const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
      expect(tela).toContain('if (!customerId) return <CustomerPicker />;');
      expect(tela).toMatch(/<OrderEditor key=\{`\$\{customerId\}:\$\{editId \?\? ''\}:\$\{vendedorId \?\? ''\}`\}/);
    });
  });
});

// ---------------------------------------------------------------- (B) links do recado
/**
 * Páginas do Campo de um vendedor (manifesto real: rota é só do Campo) e do Gestão (sem rota). Recados e tarefas, tarefa e
 * notificações existem nos dois (modules/core/app/index.ts, conferido no B3).
 */
const PAGINAS_CAMPO = new Set(['rota', 'cliente', 'clientes', 'notificacoes', 'recados-e-tarefas', 'tarefa', 'metas', 'pedidos', 'pedido', 'novo-pedido', 'catalogo']);
const PAGINAS_GESTAO = new Set(['notificacoes', 'recados-e-tarefas', 'tarefa', 'cliente', 'pedidos', 'pedido', 'novo-pedido', 'equipe']);
const LINKS: Array<string | null | undefined> = [
  '/m/rota',
  '/m/core-rota', // o link gravado no seed antes da T-0140 (tela que não existe)
  '/m/pedido?id=00000000-0000-4000-8000-000000000001',
  '/m/rota#topo',
  '/m/notificacoes',
  '/m/novo-pedido?customerId=abc',
  '/m/promotor-loja', // tela de outro perfil
  '/m/',
  '/m/Rota',
  '/rota',
  'https://exemplo.com/m/rota',
  'javascript:alert(1)',
  '//m/rota',
  ' /m/rota',
  '',
  null,
  undefined,
];
/** A central de hoje: "Recados e tarefas" (o "Ver todos" do sino), que substitui a caixa de notificações. */
const CENTRAL = '/m/recados-e-tarefas';

const BALAO = 'modules/core/app/telas/recados-e-tarefas/balao-recados-e-tarefas.tsx';
const TELA_RECADOS = 'modules/core/app/telas/recados-e-tarefas/tela-recados-e-tarefas.tsx';
const NOTIFICACOES = 'modules/core/app/telas/notificacoes.tsx';
/** As três entradas do toque no recado e o nome com que cada uma importa a regra do SDK. */
const ENTRADAS = [
  [BALAO, 'linkInternoNavegavel'],
  [TELA_RECADOS, 'linkInternoNavegavel'],
  [NOTIFICACOES, 'linkNavegavel'],
] as const;

/** Corpo da função `abrir` da tela (de `const abrir =` até o `};` que a fecha). Falha alto se sumir, para o `it.fails` não passar por erro de leitura. */
function corpoDoAbrir(rel: string): string {
  const fonte = ler(rel);
  const inicio = fonte.indexOf('const abrir = (');
  if (inicio < 0) throw new Error(`${rel} sem \`const abrir = (\`: atualize os casos B do T-0140`);
  return fonte.slice(inicio, fonte.indexOf('\n  };', inicio));
}

describe('T-0140 B — link do recado: só abre tela que o perfil tem; senão, a central (RN-CORE-23, regra única do SDK)', () => {
  for (const [app, paginas] of [
    ['Campo', PAGINAS_CAMPO],
    ['Gestão', PAGINAS_GESTAO],
  ] as const) {
    const telaExiste = (c: string) => paginas.has(c);
    it.each(LINKS.map((l) => [JSON.stringify(l), l] as const))(`B1 ${app}: %s — a regra do SDK só devolve link interno de tela da visão`, (_n, link) => {
      // as três entradas chamam assim (B4): `linkInternoNavegavel(link ?? null, (c) => visao.pagina(c) !== null)`
      const destino = linkNavegavel(link ?? null, telaExiste);
      expect(destino).toBe(linkNavegavel(link, telaExiste)); // null e undefined decidem igual
      if (destino) {
        // nunca navega para fora do app nem para tela que o perfil não tem; o link sai como veio
        expect(destino).toBe(link);
        expect(destino.startsWith('/m/')).toBe(true);
        expect(telaExiste(caminhoDoLink(destino)!)).toBe(true);
      } else {
        // sem destino, quem chama fica na central (ou deveria ir para ela: D-T0140-1)
        expect(link == null || caminhoDoLink(link) === null || !telaExiste(caminhoDoLink(link)!)).toBe(true);
      }
    });
  }

  it('B2. sem `telaExiste`, a regra aceita exatamente os links com caminho interno (`caminhoDoLinkInterno`), e o shell não tem cópia', () => {
    for (const l of LINKS) {
      expect(caminhoDoLink(l) === null, String(l)).toBe(linkNavegavel(l) === null);
      if (linkNavegavel(l)) expect(linkNavegavel(l), String(l)).toBe(l);
    }
    // 8b79045 (RD-0249): `destinoDaNotificacao` e `recadosDoInicio` saíram de apps/mobile/src/lib/inicio.ts junto com o cartão
    expect(ler('apps/mobile/src/lib/inicio.ts')).not.toMatch(/destinoDaNotificacao|recadosDoInicio|linkInternoNavegavel/);
    expect(ler('apps/mobile/src/components/sino.tsx')).not.toContain('destinoDaNotificacao');
  });

  it('B3. casos do relato: /m/core-rota não abre tela (fica na central); /m/rota abre a Rota no Campo e não abre no Gestão', () => {
    const campo = (c: string) => PAGINAS_CAMPO.has(c);
    const gestao = (c: string) => PAGINAS_GESTAO.has(c);
    // o destino que a central "Recados e tarefas" e a central antiga dão ao toque: o link, ou continuar na central
    const naCentral = (link: string, telaExiste: (c: string) => boolean) => linkNavegavel(link, telaExiste) ?? CENTRAL;
    expect(naCentral('/m/core-rota', campo)).toBe(CENTRAL);
    expect(naCentral('/m/core-rota', gestao)).toBe(CENTRAL);
    expect(naCentral('/m/rota', campo)).toBe('/m/rota');
    expect(naCentral('/m/rota', gestao)).toBe(CENTRAL);
    expect(caminhoDoLink('/m/pedido?id=1#x')).toBe('pedido');
    // manifesto real: a Rota é só do Campo; a central e a tarefa existem nos dois apps
    const manifesto = ler('modules/core/app/index.ts');
    expect(manifesto).toMatch(/\{ id: 'rota', caminho: 'rota',[^}]*apps: \['campo'\]/);
    expect(manifesto).toMatch(/\{ id: 'recados-e-tarefas', caminho: 'recados-e-tarefas',[^}]*apps: \['campo', 'gestao'\]/);
    expect(manifesto).toMatch(/\{ id: 'tarefa', caminho: 'tarefa',[^}]*apps: \['campo', 'gestao'\]/);
    expect(manifesto).toMatch(/\{ id: 'notificacoes', caminho: 'notificacoes',[^}]*apps: \['campo', 'gestao'\]/);
    // o "Ver todos" do sino leva à central de hoje quando ela existe; senão, à antiga
    expect(destinoVerTodos(campo)).toBe(CENTRAL);
    expect(destinoVerTodos(gestao)).toBe(CENTRAL);
    expect(destinoVerTodos((c) => c === 'notificacoes')).toBe('/m/notificacoes');
    expect(destinoDaTarefa('a b/c')).toBe('/m/tarefa?id=a%20b%2Fc');
  });

  it('B4. o toque no recado passa pela visão do perfil nas três entradas do Core (balão, Recados e tarefas, central antiga); o Início não tem mais recado', () => {
    for (const [rel, nome] of ENTRADAS) {
      const fonte = ler(rel);
      // a regra é a ÚNICA do SDK (RD-0032), sem cópia própria
      expect(fonte, rel).toMatch(new RegExp(`import \\{ linkInternoNavegavel${nome === 'linkInternoNavegavel' ? '' : ` as ${nome}`} \\} from '@macuxi/platform-sdk'`));
      expect(corpoDoAbrir(rel), rel).toMatch(new RegExp(`${nome}\\(\\w+\\.(notificacao\\.)?link( \\?\\? null)?, \\(c\\) => visao\\.pagina\\(c\\) !== null\\)`));
    }
    // 8b79045 (D2, RD-0249): o Início só mostra o sino; o recado não tem mais cartão nem navegação própria no Início
    const inicio = ler('apps/mobile/src/app/(tabs)/index.tsx');
    expect(inicio).not.toMatch(/<Recados\b|destinoDaNotificacao|recadosDoInicio/);
    expect(inicio).toContain('<Sino testID="inicio-sino" />');
    // o shell entrega ao balão o "Ver todos" pela visão do usuário
    expect(ler('apps/mobile/src/components/sino.tsx')).toContain('destinoVerTodos((c) => visao.pagina(c) !== null)');
  });

  it.fails('B4b. D-T0140-1 (dono: modulo-core, balao-recados-e-tarefas.tsx): no balão, recado sem tela na visão vai para a central', () => {
    // Hoje o `abrir` do balão faz `if (destino) router.navigate(destino)` e mais nada: o balão fecha (`onFechar`) e o usuário
    // fica onde estava, sem ver o recado. Na tela "Recados e tarefas" e na central antiga o mesmo `null` deixa o usuário na
    // central, que é a regra. Passos no aparelho: Gestão, recado com link /m/rota, tocar no sino e no recado: nada abre.
    // Pronto quando o `abrir` do balão cair na central (ex.: `else onVerTodos()`) quando `linkInternoNavegavel` devolve null.
    expect(corpoDoAbrir(BALAO)).toMatch(/onVerTodos\(\)|recados-e-tarefas|notificacoes/);
  });

  it('B4c. nas duas centrais, o recado sem tela na visão não navega (o usuário continua na central)', () => {
    for (const rel of [TELA_RECADOS, NOTIFICACOES]) {
      expect(corpoDoAbrir(rel), rel).toMatch(/if \(destino\) router\.navigate\(destino as never\);/);
    }
  });

  it('B5. seed da demo e fixture dois-tenants gravam o recado com /m/rota (tela que existe), nunca /m/core-rota', () => {
    for (const f of ['db/seeds/demo/demo.ts', 'db/seeds/fixtures/dois-tenants.ts']) {
      const s = ler(f);
      expect(s, f).not.toContain('/m/core-rota');
      expect(s, f).toContain("link: '/m/rota'");
    }
  });
});
