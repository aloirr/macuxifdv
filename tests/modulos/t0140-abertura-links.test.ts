/**
 * T-0140 (teste de campo de 08/11 à noite, branch claude/relaxed-johnson-w2afvp aplicado à mão) — o que dá para provar sem
 * aparelho: (A) "Novo pedido" não fecha mais o app, pela ficha, pela Rota e pelo Catálogo; (B) o link do recado do Início e da
 * central só navega para tela que o perfil tem, e o shell (`caminhoDoLink`/`destinoDaNotificacao`) decide igual ao Core
 * (`linkNavegavel`). Sem banco: roda local e no CI. Matriz e roteiro do aparelho: docs/testes/T-0140.md.
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

import { caminhoDoLink, destinoDaNotificacao, recadosDoInicio } from '../../apps/mobile/src/lib/inicio';
import { linkNavegavel } from '../../modules/core/app/lib/notificacoes';
import { CAMINHO_NOVO_PEDIDO, hrefNovoPedido, irParaNovoPedido } from '../../modules/vendedor/app/rotas';

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
    it('Rota → ficha → folha do check-in "Novo pedido": leva a visita e a parada', () => {
      irParaNovoPedido({ customerId: C, visitId: V, stopId: S });
      expect(empurrados).toEqual([`/m/novo-pedido?customerId=${C}&visitId=${V}&stopId=${S}`]);
    });
    it('Catálogo "Adicionar ao pedido" sem cliente: /m/novo-pedido (abre o seletor de cliente, não o editor)', () => {
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
      expect(idx).toMatch(/slot: 'produto\.acoes'[\s\S]*?irParaNovoPedido\(origem \?\? \{ customerId: ctx\.clienteId \?\? undefined \}\)/);
      // a folha do check-in (aberta pela Rota) chama a MESMA ação de destaque da ficha, com a visita recém-aberta
      const ficha = ler('modules/core/app/telas/cliente.tsx');
      expect(ficha).toMatch(/testID: 'checkin-new-order'[\s\S]*?acaoDestaque\.payload\.abrir\(\{ \.\.\.contexto, visitaId \}\)/);
      expect(ler('modules/core/app/telas/rota.tsx')).toMatch(/abrirCliente\(s\.customer\.id, 'Rota de hoje', true\)/);
    });
    it('a tela decide editor × seletor só pelo `customerId` e remonta o editor por cliente (chave)', () => {
      const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
      expect(tela).toContain('if (!customerId) return <CustomerPicker />;');
      expect(tela).toMatch(/<OrderEditor key=\{`\$\{customerId\}:\$\{editId \?\? ''\}:\$\{vendedorId \?\? ''\}`\}/);
    });
  });
});

// ---------------------------------------------------------------- (B) links do recado
/** Páginas do Campo de um vendedor (manifesto real: rota é só do Campo) e do Gestão (sem rota). */
const PAGINAS_CAMPO = new Set(['rota', 'cliente', 'clientes', 'notificacoes', 'metas', 'pedidos', 'pedido', 'novo-pedido', 'catalogo']);
const PAGINAS_GESTAO = new Set(['notificacoes', 'cliente', 'pedidos', 'pedido', 'novo-pedido', 'equipe']);
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

describe('T-0140 B — link do recado: shell (`caminhoDoLink`/`destinoDaNotificacao`) = Core (`linkNavegavel`) (RN-CORE-23)', () => {
  for (const [app, paginas] of [
    ['Campo', PAGINAS_CAMPO],
    ['Gestão', PAGINAS_GESTAO],
  ] as const) {
    const telaExiste = (c: string) => paginas.has(c);
    it.each(LINKS.map((l) => [JSON.stringify(l), l] as const))(`B1 ${app}: %s — Início e central decidem igual`, (_n, link) => {
      const core = linkNavegavel(link, telaExiste);
      const shell = destinoDaNotificacao(link ?? null, telaExiste);
      // o Core devolve o link ou nada; o shell devolve o link ou a central. Mesmo critério nos dois.
      expect(shell).toBe(core ?? '/m/notificacoes');
      // nunca navega para fora do app nem para tela que o perfil não tem
      if (core) {
        expect(core.startsWith('/m/')).toBe(true);
        expect(telaExiste(caminhoDoLink(core)!)).toBe(true);
      }
    });
  }

  it('B2. sem `telaExiste` (o Core monta o Início antes do shell filtrar), os dois aceitam os mesmos links internos', () => {
    for (const l of LINKS) {
      expect(destinoDaNotificacao(l ?? null), String(l)).toBe(linkNavegavel(l) ?? '/m/notificacoes');
      expect(caminhoDoLink(l) === null, String(l)).toBe(linkNavegavel(l) === null);
    }
  });

  it('B3. casos do relato: /m/core-rota abre a central; /m/rota abre a Rota no Campo e a central no Gestão (rota é só do Campo)', () => {
    expect(destinoDaNotificacao('/m/core-rota', (c) => PAGINAS_CAMPO.has(c))).toBe('/m/notificacoes');
    expect(destinoDaNotificacao('/m/rota', (c) => PAGINAS_CAMPO.has(c))).toBe('/m/rota');
    expect(destinoDaNotificacao('/m/rota', (c) => PAGINAS_GESTAO.has(c))).toBe('/m/notificacoes');
    expect(caminhoDoLink('/m/pedido?id=1#x')).toBe('pedido');
    expect(ler('modules/core/app/index.ts')).toMatch(/\{ id: 'rota', caminho: 'rota',[^}]*apps: \['campo'\]/);
  });

  it('B4. o item do Início guarda o link e o toque passa pela tela do perfil (`visaoShell.pagina`)', () => {
    const itens = recadosDoInicio({
      itens: [
        { id: 'n1', titulo: 'Prioridade', subtitulo: 'Passe cedo', hora: '09:15', tipo: 'recado', destaque: true, lida: false, link: '/m/core-rota' },
        { id: 'n2', titulo: 'Rota', subtitulo: 'Veja a rota', hora: '09:20', tipo: 'recado', destaque: false, lida: true, link: '/m/rota' },
        { id: 'n3', titulo: 'Externo', subtitulo: '', hora: '09:30', tipo: 'sistema', destaque: false, lida: false, link: 'https://exemplo.com' },
      ],
      total: 3,
    } as unknown as Parameters<typeof recadosDoInicio>[0]);
    expect(itens.map((i) => i.destino)).toEqual(['/m/core-rota', '/m/rota', '/m/notificacoes']);
    // o shell reaplica com a visão do usuário: /m/core-rota (sem tela) vai para a central
    expect(itens.map((i) => destinoDaNotificacao(i.destino, (c) => PAGINAS_CAMPO.has(c)))).toEqual(['/m/notificacoes', '/m/rota', '/m/notificacoes']);
    expect(ler('apps/mobile/src/app/(tabs)/index.tsx')).toContain('navegar(destinoDaNotificacao(r.destino, (c) => visaoShell.pagina(c) !== null))');
    expect(ler('modules/core/app/telas/notificacoes.tsx')).toContain('linkNavegavel(n.link, (c) => visao.pagina(c) !== null)');
  });

  it('B5. seed da demo e fixture dois-tenants gravam o recado com /m/rota (tela que existe), nunca /m/core-rota', () => {
    for (const f of ['db/seeds/demo/demo.ts', 'db/seeds/fixtures/dois-tenants.ts']) {
      const s = ler(f);
      expect(s, f).not.toContain('/m/core-rota');
      expect(s, f).toContain("link: '/m/rota'");
    }
  });
});
