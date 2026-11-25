/**
 * R-20261124-110151 — Catálogo aberto a partir do Novo pedido (RF-CAT-04, RN-PRO-01, regra 7). Sem banco.
 * Integração (unidades em modules/catalogo/contracts): href × shell real, `acoesDaTela` depois do shell (perfil, ação,
 * licença) e a página `catalogo-no-pedido` montada no `criarShell` real (páginas lidas do fonte).
 * Os blocos "item 14 com a ação real" (no fim) usam as extensões do Vendedor lidas do fonte e o `adicionarAoPedidoEmCurso` real.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as contratosCatalogo from '@macuxi/catalogo/contracts';
import { acoesDaTela, hrefCatalogoNoPedido, type AcaoProduto } from '@macuxi/catalogo/contracts';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { criarShell, type ModuloId, type ModuloShell, type PaginaShell, type Perfil } from '@macuxi/platform-sdk';
import { criarArmazenamentoEmMemoria } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MOTIVO_SEM_PRECO } from '../../modules/vendedor/domain/produto-no-rascunho';
import { chaveDoRascunhoNovo } from '../../modules/vendedor/domain/rascunhos';
import { adicionarAoPedidoEmCurso, AVISO_ADICIONADO_AO_PEDIDO } from '../../modules/vendedor/app/lib/pedido-em-curso';
import { draftKeyFor, rascunhoVazio, type Rascunho } from '../../modules/vendedor/app/lib/pedidos';
import { criarRepositorio } from '../../modules/vendedor/app/lib/repositorio';
import { abaInicialDoRascunho } from '../../modules/vendedor/app/lib/textos-pedido';
import { lerModuloApp } from './apoio/modulo-app';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const FONTE_APP_CATALOGO = ler('modules/catalogo/app/index.ts');
const linhaDaPagina = (id: string) => FONTE_APP_CATALOGO.split('\n').find((l) => l.includes(`id: '${id}'`)) ?? '';

/** Páginas do Catálogo lidas do fonte (mesma leitura de promotor-sem-pedido.test.ts). */
const paginasCatalogo: PaginaShell<string>[] = ['catalogo', 'catalogo-no-pedido', 'produto'].map((id) => {
  const l = linhaDaPagina(id);
  const navegacao = /navegacao: '([^']+)'/.exec(l)?.[1];
  const apps = /apps: \[([^\]]*)\]/.exec(l)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) as ('campo' | 'gestao')[] | undefined;
  return {
    id,
    caminho: /caminho: '([^']+)'/.exec(l)![1]!,
    titulo: id,
    componente: id,
    acao: /\bacao: '([^']+)'/.exec(l)?.[1],
    ...(navegacao ? { navegacao, icone: 'search', ordem: 60 } : {}),
    ...(apps ? { apps } : {}),
  };
});

const pagar = { rotulo: 'x', testID: 't', abrir: () => undefined } satisfies AcaoProduto;
/** Três ações no slot: uma de pedido (escrita, `pedido.criar`), uma de consulta e uma sem `onde`. */
const extensoesVendedor = [
  { slot: 'produto.acoes', id: 'add-pedido', acao: 'pedido.criar', apps: ['campo' as const], payload: { ...pagar, onde: 'pedido' as const } },
  { slot: 'produto.acoes', id: 'add-orcamento', acao: 'pedido.criar', apps: ['campo' as const], payload: { ...pagar, onde: 'consulta' as const } },
  { slot: 'produto.acoes', id: 'ver-historico', acao: 'pedido.ver', payload: pagar },
];
const shell = (app: 'campo' | 'gestao') => {
  const modulos: ModuloShell<string>[] = [{ manifesto: core }, { manifesto: catalogo, paginas: paginasCatalogo }, { manifesto: vendedor, extensoes: extensoesVendedor }, { manifesto: promotor }];
  return criarShell(app, modulos);
};
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor'];
const naTela = (perfil: Perfil, ativos: ModuloId[], dentroDoPedido: boolean) =>
  acoesDaTela(shell('campo').montar({ perfil, modulosAtivos: ativos }).extensoes<AcaoProduto>('produto.acoes'), dentroDoPedido).map((e) => e.id);

describe('critério 1 — hrefCatalogoNoPedido', () => {
  it('o caminho do href é o da página registrada no shell', () => {
    const caminho = hrefCatalogoNoPedido({ pedidoEmCurso: 'p' }).slice('/m/'.length).split('?')[0]!;
    expect(shell('campo').montar({ perfil: 'vendedor', modulosAtivos: TODOS }).pagina(caminho)?.id).toBe('catalogo-no-pedido');
  });
});

describe('critério 2 — onde a ação aparece (shell real + acoesDaTela)', () => {
  it('vendedor: dentro do pedido, a de pedido e a sem "onde"; fora, a de consulta e a sem "onde"', () => {
    expect(naTela('vendedor', TODOS, true)).toEqual(['add-pedido', 'ver-historico']);
    expect(naTela('vendedor', TODOS, false)).toEqual(['add-orcamento', 'ver-historico']);
  });
});

describe('critério 3 — página catalogo-no-pedido', () => {
  it('shell: existe no Campo, não no Gestão; não entra na navegação; o promotor (produto.consultar) também a abre', () => {
    const campo = shell('campo').montar({ perfil: 'vendedor', modulosAtivos: TODOS });
    expect(campo.pagina('catalogo-no-pedido')?.modulo).toBe('catalogo');
    expect(campo.navegacao.map((n) => n.id)).not.toContain('catalogo-no-pedido');
    expect(shell('gestao').montar({ perfil: 'supervisor', modulosAtivos: TODOS }).pagina('catalogo-no-pedido')).toBeNull();
    expect(shell('campo').montar({ perfil: 'promotor', modulosAtivos: TODOS }).pagina('catalogo-no-pedido')).not.toBeNull();
    expect(shell('campo').montar({ perfil: 'vendedor', modulosAtivos: ['core'] }).pagina('catalogo-no-pedido')).toBeNull();
  });
});

describe('critério 4 — promotor e licença', () => {
  it('promotor nunca vê ação pedido.criar, dentro ou fora do pedido (RN-PRO-01)', () => {
    for (const dentro of [true, false]) expect(naTela('promotor', TODOS, dentro)).not.toContain('add-pedido');
    for (const dentro of [true, false]) expect(naTela('promotor', TODOS, dentro)).not.toContain('add-orcamento');
  });
  it('sem a licença do Vendedor (dono da ação), nenhuma ação dele aparece, dentro ou fora do pedido', () => {
    expect(naTela('vendedor', ['core', 'catalogo'], true)).toEqual([]);
    expect(naTela('vendedor', ['core', 'catalogo'], false)).toEqual([]);
  });
});

/**
 * Com a ação real do Vendedor (item 14, RN-VEN-49): extensões montadas no mesmo criarShell; o "+" grava num armazenamento em
 * memória. A tela do Novo pedido: modules/vendedor/app/screens/catalogo-no-pedido.test.ts.
 */
const extensoesReais = () =>
  lerModuloApp(ler('modules/vendedor/app/index.ts'))
    .filter((i) => i.tipo === 'extensao' && i.slot === 'produto.acoes')
    .map((i) => ({
      slot: 'produto.acoes',
      id: i.id,
      ...(i.acao ? { acao: i.acao } : {}),
      ...(i.apps ? { apps: i.apps as ('campo' | 'gestao')[] } : {}),
      payload: { ...pagar, ...(i.onde ? { onde: i.onde } : {}) },
    }));
const shellReal = (app: 'campo' | 'gestao') =>
  criarShell(app, [{ manifesto: core }, { manifesto: catalogo, paginas: paginasCatalogo }, { manifesto: vendedor, extensoes: extensoesReais() }, { manifesto: promotor }]);
const naTelaReal = (app: 'campo' | 'gestao', perfil: Perfil, ativos: ModuloId[], dentroDoPedido: boolean) =>
  acoesDaTela(shellReal(app).montar({ perfil, modulosAtivos: ativos }).extensoes<AcaoProduto>('produto.acoes'), dentroDoPedido).map((e) => e.id);

describe('item 14 com a ação real — critério 1: o botão Catálogo da aba Itens abre o Catálogo do pedido em curso', () => {
  it('ida e volta do código: a chave do rascunho (novo, salvo ou edição) sai no `pedido` do href e o Catálogo a repassa intacta ao ctx', () => {
    for (const chave of [chaveDoRascunhoNovo('c1'), '7b0e1c2a-1111-4111-8111-111111111111', draftKeyFor('c1', 'ped-9'), 'a b&c=d']) {
      const href = hrefCatalogoNoPedido({ clienteId: 'c1', pedidoEmCurso: chave });
      const qs = new URLSearchParams(href.split('?')[1]);
      expect(qs.get('pedido'), chave).toBe(chave);
      expect(qs.get('cliente')).toBe('c1');
    }
    // o Catálogo (vitrine e ficha) lê `pedido` e passa ao contexto da ação (o `pedidoEmCurso` do "+")
    expect(ler('modules/catalogo/app/telas/catalogo.tsx')).toMatch(/const pedidoEmCurso = params\.pedido \? String\(params\.pedido\) : null;/);
    expect(ler('modules/catalogo/app/telas/comum.tsx')).toMatch(/pedidoEmCurso \};/);
  });
});

describe('item 14 com a ação real — critérios 4 a 6: quem vê o "+"', () => {
  it('critério 6: dentro do pedido só o "+"; fora, só o "Adicionar ao orçamento" (acoesDaTela sobre o shell real)', () => {
    expect(naTelaReal('campo', 'vendedor', TODOS, true)).toEqual(['adicionar-ao-pedido']);
    expect(naTelaReal('campo', 'vendedor', TODOS, false)).toEqual(['adicionar-ao-orcamento']);
  });
  it('critério 5: o promotor nunca vê o "+" nem o orçamento, dentro ou fora do pedido; no Gestão ninguém vê', () => {
    for (const dentro of [true, false]) {
      expect(naTelaReal('campo', 'promotor', TODOS, dentro)).toEqual([]);
      for (const perfil of ['supervisor', 'gerente', 'promotor'] as const) expect(naTelaReal('gestao', perfil, TODOS, dentro), perfil).toEqual([]);
    }
  });
  it('critério 4: sem a licença do Catálogo, nada do Catálogo (página nem ação) nem produto.consultar', () => {
    const semCatalogo = shellReal('campo').montar({ perfil: 'vendedor', modulosAtivos: ['core', 'vendedor'] });
    expect(semCatalogo.pagina('catalogo-no-pedido')).toBeNull();
    expect(semCatalogo.extensoes('produto.acoes')).toEqual([]);
    expect(semCatalogo.pode('produto.consultar')).toBe(false);
    expect(shellReal('campo').montar({ perfil: 'vendedor', modulosAtivos: TODOS }).pode('produto.consultar')).toBe(true);
  });
});

describe('item 14 com a ação real — critérios 2 e 3: o "+" grava no rascunho do aparelho (offline)', () => {
  const RASCUNHO = chaveDoRascunhoNovo('c1');
  const arm = (rascunho: Partial<Rascunho> = {}) =>
    criarArmazenamentoEmMemoria({
      // cliente com tabela própria: o preço normal é o da tabela dele (RN-CAT-06), não o da `default`
      clientes: [{ id: 'c1', trade_name: 'Mercado', price_table_id: 't1' }],
      produtos: {
        default: { items: [{ id: 'p1', description: 'Parafuso', price_cents: 999 }, { id: 'p3', description: 'Arruela', price_cents: 100 }], synced_at: 'x' },
        t1: { items: [{ id: 'p1', description: 'Parafuso', price_cents: 500 }, { id: 'p2', description: 'Porca', price_cents: 250 }, { id: 'p3', description: 'Arruela', price_cents: null }], synced_at: 'x' },
      },
      rascunhos: { [RASCUNHO]: { ...rascunhoVazio('c1'), lines: { p2: 2 }, discount_pct: 0, aba: 'itens', updated_at: '2026-11-24T12:00:00.000Z', ...rascunho }, outro: { ...rascunhoVazio('c9'), lines: { p1: 7 } } },
    });
  const lerRascunho = async (a: ReturnType<typeof arm>, chave = RASCUNHO) => (await criarRepositorio(a).carregar()).rascunhos[chave]!;

  it('critério 2: só o rascunho em curso muda; o outro rascunho do aparelho fica intacto', async () => {
    const a = arm();
    await adicionarAoPedidoEmCurso(RASCUNHO, 'p1', a);
    expect((await lerRascunho(a, 'outro')).lines).toEqual({ p1: 7 });
  });

  it('critério 2 (valor × regra RN-CAT-06): vale a tabela do cliente, não a default; sem preço nela (mesmo com preço na default), recusa e não grava', async () => {
    const a = arm();
    expect(await adicionarAoPedidoEmCurso(RASCUNHO, 'p3', a)).toBe(MOTIVO_SEM_PRECO('Arruela'));
    const r = await lerRascunho(a);
    expect(r.lines).toEqual({ p2: 2 });
    expect(r.updated_at).toBe('2026-11-24T12:00:00.000Z');
  });

  it('critério 3: o Novo pedido remontado lê o rascunho na aba Itens; o "+" conta como alteração (renova as 24 h)', async () => {
    const a = arm();
    await adicionarAoPedidoEmCurso(RASCUNHO, 'p1', a);
    const r = await lerRascunho(a);
    expect(r.aba).toBe('itens');
    expect(abaInicialDoRascunho(r)).toBe('itens');
    expect(Date.parse(r.updated_at)).toBeGreaterThan(Date.parse('2026-11-24T12:00:00.000Z'));
  });

  /** Contrato novo do Catálogo: `abrir` pode devolver o aviso, que o Catálogo mostra por `executarAcaoProduto` (dois estados do repositório). */
  const executar = (contratosCatalogo as Record<string, unknown>).executarAcaoProduto as
    | ((acao: Pick<AcaoProduto, 'abrir'>, ctx: Parameters<AcaoProduto['abrir']>[0], avisar: (t: string) => void) => Promise<void>)
    | undefined;
  it.runIf(Boolean(executar))('critério 2: o toque no "+" devolve o aviso curto (sucesso ou motivo da recusa) ao Catálogo, que o mostra', async () => {
    const a = arm();
    const avisos: string[] = [];
    // a mesma chamada do `abrir` do fonte (conferida em promotor-sem-pedido.test.ts), com o armazenamento do teste
    const acao = { abrir: (ctx: { pedidoEmCurso?: string | null; produtoId: string }) => adicionarAoPedidoEmCurso(ctx.pedidoEmCurso, ctx.produtoId, a) };
    const ctx = (produtoId: string) => ({ produtoId, sku: produtoId, nomeProduto: produtoId, clienteId: 'c1', vendavel: true, pedidoEmCurso: RASCUNHO }) as Parameters<AcaoProduto['abrir']>[0];
    await executar!(acao, ctx('p1'), (t) => avisos.push(t));
    await executar!(acao, ctx('p3'), (t) => avisos.push(t));
    expect(avisos).toEqual([AVISO_ADICIONADO_AO_PEDIDO, MOTIVO_SEM_PRECO('Arruela')]);
  });

  // Aviso do "+" (modulo-catalogo, app/telas/comum.tsx): os botões da lista e da ficha executam a ação por `executarAcaoProduto` e
  // mostram o texto devolvido ("Adicionado ao pedido" ou o motivo da recusa), em vez de chamar `a.payload.abrir(ctx)` e descartá-lo.
  it('aviso do "+": a lista e a ficha do Catálogo executam a ação por executarAcaoProduto (o aviso chega à tela)', () => {
    const comum = ler('modules/catalogo/app/telas/comum.tsx');
    expect(comum).not.toMatch(/onPress=\{\(\) => a\.payload\.abrir\(ctx\)\}/);
    expect(comum).toMatch(/executarAcaoProduto\(/);
  });

  it('critério 3: o pedido salvo (Salvar > Pedido) que foi ao Catálogo também volta na aba Itens, não no Resumo', async () => {
    const a = arm({ salvo_em: '2026-11-24T11:00:00.000Z' });
    await adicionarAoPedidoEmCurso(RASCUNHO, 'p1', a);
    expect(abaInicialDoRascunho(await lerRascunho(a))).toBe('itens');
    // sem a volta do Catálogo, o pedido salvo segue reabrindo no Resumo (T-0137)
    expect(abaInicialDoRascunho({ salvo_em: '2026-11-24T11:00:00.000Z', aba: 'resumo' })).toBe('resumo');
    expect(abaInicialDoRascunho({ salvo_em: '2026-11-24T11:00:00.000Z' })).toBe('resumo');
  });
});
