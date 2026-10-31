/**
 * T-0003 C3.3 "promotor não vê nenhuma ação de pedido" — lado UI (RN-PRO-01), cenários S0-061, S0-062 e S0-066.
 * T-0015 (O-3, doc 03 §2 "Ver pedidos": promotor = carteira, leitura): o promotor PODE `pedido.ver` (somente leitura,
 * quando tem o Vendedor) e NUNCA pode uma ação de ESCRITA de pedido (criar, editar, cancelar, excluir, aprovar, em nome).
 *
 * - BKO: o shell web REAL (apps/web/lib/modulos.ts, com as páginas reais dos 8 módulos) e o veto de perfil do login.
 * - App Campo: o shell mobile importa React Native e não roda em Node; por isso as páginas e extensões do Vendedor são
 *   LIDAS DO FONTE (modules/vendedor/app/index.ts) e montadas no MESMO `criarShell` do platform-sdk que o app usa, com os
 *   manifestos reais. Se alguém acrescentar página/extensão de pedido sem `acao`, a leitura do fonte pega.
 * - Telas: os botões de editar/cancelar/duplicar/novo pedido dependem de `usePode`/`SePode` da ação de pedido.
 * O pior caso é sempre o promotor COM o Vendedor licenciado (RN-PRO-01 independe da licença).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { criarShell, ehAcaoDeEscritaDePedido, ehAcaoDeLeituraDePedido, ehAcaoDePedido, mensagemPerfilForaDoApp, type ModuloShell, type PaginaShell } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { SHELL_WEB } from '../../apps/web/lib/modulos';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TODOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
const ACOES_DE_PEDIDO = Object.keys(vendedor.acoes).filter(ehAcaoDePedido);
/** RN-PRO-01: o que o promotor nunca pode. A leitura (`pedido.ver`) é liberada pela matriz §2 (O-3). */
const ACOES_DE_ESCRITA = ACOES_DE_PEDIDO.filter(ehAcaoDeEscritaDePedido);

interface ItemLido {
  tipo: 'pagina' | 'extensao';
  id: string;
  slot?: string;
  caminho?: string;
  navegacao?: string;
  acao?: string;
  apps?: string[];
}

/** Páginas (`{ id, caminho, ... }` numa linha) e extensões (`slot: ...` até o próximo `slot:`) declaradas no fonte. */
function lerModuloApp(fonte: string): ItemLido[] {
  const itens: ItemLido[] = [];
  const paginas = fonte.slice(fonte.indexOf('paginas:'), fonte.indexOf('entidadesSync:'));
  for (const linha of paginas.split('\n')) {
    const id = /\bid: '([^']+)'/.exec(linha)?.[1];
    if (!id) continue;
    itens.push({
      tipo: 'pagina',
      id,
      caminho: /caminho: '([^']+)'/.exec(linha)?.[1],
      navegacao: /navegacao: '([^']+)'/.exec(linha)?.[1],
      acao: /\bacao: '([^']+)'/.exec(linha)?.[1],
      apps: /apps: \[([^\]]*)\]/.exec(linha)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)),
    });
  }
  const ext = fonte.slice(fonte.indexOf('extensoes:'));
  for (const bloco of ext.split(/slot: /).slice(1)) {
    itens.push({
      tipo: 'extensao',
      slot: /^'([^']+)'/.exec(bloco)?.[1],
      id: /\bid: '([^']+)'/.exec(bloco)?.[1] ?? '?',
      acao: /\bacao: '([^']+)'/.exec(bloco)?.[1],
    });
  }
  return itens;
}

const itensVendedorApp = lerModuloApp(ler('modules/vendedor/app/index.ts'));

describe('C3.3 no BKO (shell web real)', () => {
  it('S0-066: promotor (e vendedor) não entram no BKO: o login mostra o app certo e encerra a sessão', () => {
    expect(mensagemPerfilForaDoApp('promotor', 'web')).toMatch(/Macuxi Campo/);
    expect(ler('apps/web/components/login-screen.tsx')).toMatch(/mensagemPerfilForaDoApp\(sessao\.usuario\.perfil, 'web'\)[\s\S]{0,400}\/auth\/logout/);
  });

  it('manifesto do Vendedor (O-3): a única ação de leitura é pedido.ver, com o promotor; nenhuma ação de escrita tem o promotor', () => {
    expect(ACOES_DE_PEDIDO.filter(ehAcaoDeLeituraDePedido)).toEqual(['pedido.ver']);
    expect(vendedor.acoes['pedido.ver']!.perfis).toContain('promotor');
    expect(ACOES_DE_ESCRITA).toEqual(expect.arrayContaining(['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir', 'pedido.aprovar', 'pedido.criar_em_nome']));
    for (const a of ACOES_DE_ESCRITA) expect(vendedor.acoes[a]!.perfis, a).not.toContain('promotor');
  });

  it('S0-066: mesmo que o promotor chegasse ao shell com TODOS os módulos ativos, nenhuma ação de ESCRITA de pedido é permitida', () => {
    const v = SHELL_WEB.montar({ perfil: 'promotor', modulosAtivos: [...TODOS] });
    for (const a of ACOES_DE_ESCRITA) expect(v.pode(a), a).toBe(false);
    expect(v.navegacao.filter((n) => n.pagina.acao && ehAcaoDeEscritaDePedido(n.pagina.acao))).toEqual([]);
    // controle positivo: o analista pode criar pedido no mesmo shell
    expect(SHELL_WEB.montar({ perfil: 'analista', modulosAtivos: [...TODOS] }).pode('pedido.criar')).toBe(true);
  });
});

describe('C3.3 no app Campo (criarShell do SDK + o que o Vendedor declara no fonte)', () => {
  it('a leitura do fonte encontrou as páginas e extensões do Vendedor', () => {
    expect(itensVendedorApp.filter((i) => i.tipo === 'pagina').map((i) => i.id)).toEqual(['pedidos', 'pedido', 'novo-pedido']);
    expect(itensVendedorApp.filter((i) => i.tipo === 'extensao').map((i) => `${i.slot}/${i.id}`)).toEqual(['cliente.abas/mix', 'cliente.abas/ultimos-pedidos', 'cliente.acoes/novo-pedido']);
  });

  it('S0-061: toda AÇÃO de pedido declarada no app (novo pedido e extensões da ficha) exige uma ação pedido.* do manifesto', () => {
    const acoes = itensVendedorApp.filter((i) => i.id.includes('novo') || i.tipo === 'extensao');
    expect(acoes.length).toBeGreaterThanOrEqual(4);
    for (const i of acoes) {
      expect(i.acao, `${i.tipo} ${i.id}`).toBeDefined();
      expect(ehAcaoDeEscritaDePedido(i.acao!), `${i.tipo} ${i.id}`).toBe(true);
      expect(vendedor.acoes[i.acao!]!.perfis, `${i.tipo} ${i.id}`).not.toContain('promotor');
    }
  });

  const shellCampo = () => {
    const paginas: PaginaShell<string>[] = itensVendedorApp
      .filter((i) => i.tipo === 'pagina')
      .map((i) => ({ id: i.id, caminho: i.caminho!, titulo: i.id, componente: i.id, ...(i.navegacao ? { navegacao: i.navegacao } : {}), ...(i.acao ? { acao: i.acao } : {}), ...(i.apps ? { apps: i.apps as ('campo' | 'gestao')[] } : {}) }));
    const extensoes = itensVendedorApp.filter((i) => i.tipo === 'extensao').map((i) => ({ slot: i.slot!, id: i.id, ...(i.acao ? { acao: i.acao } : {}), payload: { rotulo: i.id } }));
    const modulos: ModuloShell<string>[] = [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, paginas, extensoes }, { manifesto: promotor }];
    return criarShell('campo', modulos);
  };

  it('S0-061/S0-062: promotor com o Vendedor licenciado — sem "Novo pedido" (rota direta nula), sem abas/ações de pedido na ficha', () => {
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] });
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.extensoes('cliente.acoes')).toEqual([]);
    expect(v.extensoes('cliente.abas')).toEqual([]);
    for (const a of ACOES_DE_ESCRITA) expect(v.pode(a), a).toBe(false);
    expect(v.pode('pedido.ver')).toBe(true); // O-3: leitura liberada
    // controle positivo: o vendedor vê tudo
    const vend = shellCampo().montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'vendedor'] });
    expect(vend.pagina('novo-pedido')).not.toBeNull();
    expect(vend.extensoes('cliente.acoes').map((e) => e.id)).toEqual(['novo-pedido']);
  });

  // O-3 RESOLVIDO (T-0015; doc 03 §2 e esclarecimento abaixo da matriz): com o Vendedor licenciado o promotor vê a aba
  // "Pedidos" só de leitura (lista e detalhe), e a API agora responde a leitura na carteira (200) e 404 fora dela
  // (tests/integracao/api/promotor-pedido.test.ts). Escrita: nenhuma, nem na UI nem na API.
  it('O-3: promotor com o Vendedor licenciado vê a aba Pedidos e o detalhe, só de leitura (sem nenhuma ação de escrita)', () => {
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] });
    expect(v.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo)).toEqual(['Pedidos']);
    expect(v.pagina('pedidos')).not.toBeNull();
    expect(v.pagina('pedido')).not.toBeNull();
    expect(v.navegacao.every((n) => !n.pagina.acao || !ehAcaoDeEscritaDePedido(n.pagina.acao))).toBe(true);
  });

  it('O-3 / RN-PRO-01: o detalhe do pedido fica somente leitura sem permissão de escrita (botões não renderizam)', () => {
    const detalhe = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    expect(detalhe).toMatch(/pedidoSomenteLeitura\(\{ criar: podeCriar, editar: podeEditar, cancelar: podeCancelar \}\)/);
    expect(detalhe).toMatch(/\{somenteLeitura \? null : \(/);
    const lib = ler('modules/vendedor/app/lib/somente-leitura.ts');
    expect(lib).toContain('!pode.criar && !pode.editar && !pode.cancelar');
  });

  it('S0-061 sem o Vendedor: o promotor não pode nem pedido.ver (módulo inativo)', () => {
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: ['core', 'promotor'] });
    for (const a of ACOES_DE_PEDIDO) expect(v.pode(a), a).toBe(false);
  });

  it('S0-061: na licença padrão o promotor não tem o Vendedor, e o app não monta nada do Vendedor', () => {
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: ['core', 'promotor'] });
    expect(v.navegacao.filter((n) => n.modulo === 'vendedor')).toEqual([]);
    expect(v.pagina('pedidos')).toBeNull();
  });

  it('S0-061: telas de pedido só mostram os botões com a permissão da ação (usePode/SePode)', () => {
    const detalhe = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    for (const a of ['pedido.editar', 'pedido.cancelar', 'pedido.criar']) expect(detalhe, a).toContain(`usePode('${a}')`);
    expect(ler('modules/vendedor/app/screens/orders-screen.tsx')).toContain('<SePode acao="pedido.criar">');
    expect(ler('modules/vendedor/app/screens/new-order-screen.tsx')).toContain("usePode('pedido.editar')");
  });
});
