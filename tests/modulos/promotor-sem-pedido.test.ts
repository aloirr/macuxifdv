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
 * - T-0052/T-0071: "Adicionar ao pedido" (slot `produto.acoes` do Catálogo, registrado pelo Vendedor com `acao: 'pedido.criar'`,
 *   `apps: ['campo']`) nunca chega ao promotor: nem no shell do Campo, nem no `produto.acoes` efetivo, nem com todos os módulos.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  criarShell,
  ehAcaoDeEscritaDePedido,
  ehAcaoDeLeituraDePedido,
  ehAcaoDePedido,
  mensagemPerfilForaDoApp,
  modulosEfetivos,
  type Manifesto,
  type ModuloId,
  type ModuloShell,
  type PaginaShell,
  type Perfil,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_INSTALADOS } from '../../apps/mobile/src/lib/instalados';
import { SHELL_WEB } from '../../apps/web/lib/modulos';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TODOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const satisfies readonly ModuloId[];
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
  /** T-0077: a página declara `perfis: PERFIS_PAGINAS` (= `manifest.perfis` do Vendedor, sem promotor). */
  perfisDoManifesto?: boolean;
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
      perfisDoManifesto: /perfis: PERFIS_PAGINAS\b/.test(linha),
    });
  }
  const ext = fonte.slice(fonte.indexOf('extensoes:'));
  for (const bloco of ext.split(/slot: /).slice(1)) {
    itens.push({
      tipo: 'extensao',
      slot: /^'([^']+)'/.exec(bloco)?.[1],
      id: /\bid: '([^']+)'/.exec(bloco)?.[1] ?? '?',
      acao: /\bacao: '([^']+)'/.exec(bloco)?.[1],
      // T-0052: o `apps` da extensão entra no shell (o "Adicionar ao pedido" é só do Campo)
      apps: /\bapps: \[([^\]]*)\]/.exec(bloco)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)),
    });
  }
  return itens;
}

const FONTE_VENDEDOR_APP = ler('modules/vendedor/app/index.ts');
const itensVendedorApp = lerModuloApp(FONTE_VENDEDOR_APP);

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

/** Shell do app (Campo ou Gestão) com os manifestos reais e o que o Vendedor declara no fonte. T-0077: as páginas entram COM o `perfis` que declaram no fonte (antes eram montadas sem ele, e o caso O-3 passava por isso). */
const shellDoApp = (app: 'campo' | 'gestao') => {
  const paginas: PaginaShell<string>[] = itensVendedorApp
    .filter((i) => i.tipo === 'pagina')
    .map((i) => ({
      id: i.id,
      caminho: i.caminho!,
      titulo: i.id,
      componente: i.id,
      ...(i.navegacao ? { navegacao: i.navegacao } : {}),
      ...(i.acao ? { acao: i.acao } : {}),
      ...(i.apps ? { apps: i.apps as ('campo' | 'gestao')[] } : {}),
      ...(i.perfisDoManifesto ? { perfis: vendedor.perfis as readonly Perfil[] } : {}),
    }));
  const extensoes = itensVendedorApp
    .filter((i) => i.tipo === 'extensao')
    .map((i) => ({ slot: i.slot!, id: i.id, ...(i.acao ? { acao: i.acao } : {}), ...(i.apps ? { apps: i.apps as ('campo' | 'gestao')[] } : {}), payload: { rotulo: i.id } }));
  const modulos: ModuloShell<string>[] = [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, paginas, extensoes }, { manifesto: promotor }];
  return criarShell(app, modulos);
};
const shellCampo = () => shellDoApp('campo');

describe('C3.3 no app Campo (criarShell do SDK + o que o Vendedor declara no fonte)', () => {
  it('a leitura do fonte encontrou as páginas e extensões do Vendedor', () => {
    expect(itensVendedorApp.filter((i) => i.tipo === 'pagina').map((i) => i.id)).toEqual(['pedidos', 'pedido', 'novo-pedido']);
    // T-0076: + card Orçamentos/A faturar no Início (inicio.cards/pedidos-resumo, também com acao pedido.criar)
    // T-0052: + "Adicionar ao pedido" no slot produto.acoes do Catálogo (acao pedido.criar, só Campo)
    expect(itensVendedorApp.filter((i) => i.tipo === 'extensao').map((i) => `${i.slot}/${i.id}`)).toEqual([
      'cliente.abas/mix',
      'cliente.abas/ultimos-pedidos',
      'cliente.acoes/novo-pedido',
      'produto.acoes/adicionar-ao-pedido',
      // T-0085 (RN-VEN-35): + "Fazer pedido em nome" no slot do próprio Vendedor, só Gestão, acao pedido.criar_em_nome
      'pedido.criar_em_nome/novo-pedido-em-nome',
      'inicio.cards/pedidos-resumo',
    ]);
    // toda extensão do Vendedor é só do Campo, menos o pedido em nome, que é só da Gestão (a leitura do `apps` entra no shell abaixo)
    for (const e of itensVendedorApp.filter((i) => i.tipo === 'extensao'))
      expect(e.apps, `${e.slot}/${e.id}`).toEqual(e.slot === 'pedido.criar_em_nome' ? ['gestao'] : ['campo']);
    // T-0085: a página novo-pedido vale no Campo e na Gestão (supervisor/gerente em nome do vendedor), sempre com acao pedido.criar
    expect(itensVendedorApp.find((i) => i.tipo === 'pagina' && i.id === 'novo-pedido')).toMatchObject({ acao: 'pedido.criar', apps: ['campo', 'gestao'], perfisDoManifesto: true });
  });

  it('T-0077 (R-20261104-204823): toda página do Vendedor declara `perfis` = manifest.perfis, que não tem o promotor (RN-PRO-01)', () => {
    expect(FONTE_VENDEDOR_APP).toMatch(/const PERFIS_PAGINAS = manifest\.perfis;/);
    for (const p of itensVendedorApp.filter((i) => i.tipo === 'pagina')) expect(p.perfisDoManifesto, p.id).toBe(true);
    expect(vendedor.perfis).not.toContain('promotor');
    expect(vendedor.perfis).toEqual(expect.arrayContaining(['vendedor', 'supervisor', 'gerente']));
  });

  it('S0-061: toda AÇÃO de pedido declarada no app (novo pedido e extensões da ficha) exige uma ação pedido.* do manifesto', () => {
    const acoes = itensVendedorApp.filter((i) => i.id.includes('novo') || i.tipo === 'extensao');
    expect(acoes.length).toBeGreaterThanOrEqual(5);
    expect(acoes.map((i) => i.id)).toContain('adicionar-ao-pedido');
    for (const i of acoes) {
      expect(i.acao, `${i.tipo} ${i.id}`).toBeDefined();
      expect(ehAcaoDeEscritaDePedido(i.acao!), `${i.tipo} ${i.id}`).toBe(true);
      expect(vendedor.acoes[i.acao!]!.perfis, `${i.tipo} ${i.id}`).not.toContain('promotor');
    }
  });


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

  // O-3 (T-0015; doc 03 §2) REVISTO na T-0077 pela decisão do gerente R-20261104-204823: o promotor LÊ os pedidos da
  // carteira (só leitura, conforme `promotor_ve_pedidos`) no Cliente 360 do Core e na API (tests/integracao/api/
  // promotor-ve-pedidos.test.ts), mas a aba/tela Pedidos do Vendedor NÃO é dele: as páginas têm `perfis` = manifest.perfis,
  // sem promotor. O caso antigo afirmava o contrário e só passava porque montava as páginas sem o `perfis`.
  // A leitura no Cliente 360 (ligada × desligada) está em tests/modulos/pedidos-busca-t0077.test.ts (R-05..R-08).
  it('O-3 / T-0077: promotor com o Vendedor licenciado NÃO recebe a aba Pedidos nem o detalhe; a permissão de leitura (pedido.ver) continua', () => {
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] });
    expect(v.navegacao.filter((n) => n.modulo === 'vendedor')).toEqual([]);
    expect(v.pagina('pedidos')).toBeNull();
    expect(v.pagina('pedido')).toBeNull();
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.pode('pedido.ver')).toBe(true); // leitura no Cliente 360 e na API
    for (const a of ACOES_DE_ESCRITA) expect(v.pode(a), a).toBe(false);
    // controle positivo no mesmo shell: o vendedor recebe a aba e o detalhe
    const vend = shellCampo().montar({ perfil: 'vendedor', modulosAtivos: ['core', 'catalogo', 'vendedor'] });
    expect(vend.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo)).toEqual(['Pedidos']);
    expect(vend.pagina('pedidos')).not.toBeNull();
    expect(vend.pagina('pedido')).not.toBeNull();
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

/**
 * T-0052/T-0071 — "Adicionar ao pedido" (produto.acoes/adicionar-ao-pedido do Vendedor, testID produto-adicionar) e a regra 7.
 * A vitrine e a ficha do produto do Catálogo desenham SÓ o que `useExtensoes('produto.acoes')` devolve (o `extensoes` do shell);
 * então provar o `extensoes('produto.acoes')` do shell é provar o que o promotor vê. Recado R-20261105-182427 (modulo-vendedor).
 * O shell aqui é o do describe acima (manifestos reais + páginas/extensões do Vendedor lidas do fonte, COM `apps`).
 */
describe('T-0052 — "Adicionar ao pedido" (produto.acoes) nunca chega ao promotor (regra 7, RN-PRO-01)', () => {
  const adicionar = itensVendedorApp.find((i) => i.slot === 'produto.acoes');
  const porId = new Map(MANIFESTOS_INSTALADOS.map((m) => [m.id, m] as const));
  /** Módulos efetivos de verdade: ligados no tenant E aceitos pelo perfil no manifesto, com dependências (RN-CORE-03). */
  const efetivos = (ativos: readonly ModuloId[], perfil: Perfil) =>
    modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS as Manifesto[], ativosNoTenant: [...ativos], doPerfil: ativos.filter((id) => porId.get(id)!.perfis.includes(perfil)) });
  const ids = (app: 'campo' | 'gestao', perfil: Perfil, ativos: readonly ModuloId[]) =>
    shellDoApp(app)
      .montar({ perfil, modulosAtivos: [...ativos] })
      .extensoes('produto.acoes')
      .map((e) => `${e.modulo}/${e.id}`);

  it('fonte: a ação exige pedido.criar, é só do Campo; o slot é oferecido pelo Catálogo e usado pelo Vendedor', () => {
    expect(adicionar).toMatchObject({ tipo: 'extensao', slot: 'produto.acoes', id: 'adicionar-ao-pedido', acao: 'pedido.criar', apps: ['campo'] });
    expect(FONTE_VENDEDOR_APP).toMatch(/id: 'adicionar-ao-pedido'[\s\S]{0,300}testID: 'produto-adicionar'/);
    expect(vendedor.acoes['pedido.criar']!.perfis).not.toContain('promotor');
    expect(catalogo.ofereceExtensoes).toContain('produto.acoes');
    expect(vendedor.usaExtensoes).toContain('produto.acoes');
    // o Promotor não contribui nada em produto.acoes (o manifesto dele nem usa o slot)
    expect(promotor.usaExtensoes).not.toContain('produto.acoes');
  });

  it('pior caso: promotor no Campo com o Vendedor (e todos os módulos) ligados na sessão → produto.acoes vazio', () => {
    expect(ids('campo', 'promotor', ['core', 'catalogo', 'vendedor', 'promotor'])).toEqual([]);
    expect(ids('campo', 'promotor', TODOS)).toEqual([]);
    const v = shellCampo().montar({ perfil: 'promotor', modulosAtivos: [...TODOS] });
    expect(v.pode('pedido.criar')).toBe(false);
    expect(v.pagina('novo-pedido')).toBeNull(); // nem a rota que a ação abriria
  });

  it('prova de que é a `acao: pedido.criar` que barra: a mesma extensão SEM a ação apareceria ao promotor (mutação controlada)', () => {
    const semAcao = { slot: 'produto.acoes', id: 'adicionar-ao-pedido', apps: ['campo' as const], payload: { rotulo: 'x' } };
    const shell = criarShell<string>('campo', [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, extensoes: [semAcao] }, { manifesto: promotor }]);
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] }).extensoes('produto.acoes').map((e) => e.id)).toEqual(['adicionar-ao-pedido']);
    // com a ação (como no fonte) some — é o caso acima
    expect(ids('campo', 'promotor', ['core', 'catalogo', 'vendedor', 'promotor'])).toEqual([]);
  });

  it('caso real: promotor com tudo licenciado no tenant → o Vendedor não é efetivo para ele e produto.acoes fica vazio', () => {
    const ef = efetivos(TODOS, 'promotor');
    expect(ef).not.toContain('vendedor');
    expect(ef).toContain('catalogo'); // o promotor VÊ o Catálogo (vitrine e ficha), só não recebe a ação de pedido
    expect(ids('campo', 'promotor', ef)).toEqual([]);
  });

  it('controle positivo: o vendedor no Campo recebe "Adicionar ao pedido"', () => {
    expect(ids('campo', 'vendedor', efetivos(['core', 'catalogo', 'vendedor'], 'vendedor'))).toEqual(['vendedor/adicionar-ao-pedido']);
    expect(ids('campo', 'vendedor', TODOS)).toEqual(['vendedor/adicionar-ao-pedido']);
  });

  it('só Campo: no app Gestão ninguém recebe a ação (nem supervisor/gerente, que podem pedido.criar)', () => {
    for (const perfil of ['supervisor', 'gerente', 'promotor'] as const) expect(ids('gestao', perfil, TODOS), perfil).toEqual([]);
  });

  it('módulo desativado: sem o Vendedor ou sem o Catálogo (dono do slot), a ação some também para o vendedor', () => {
    expect(ids('campo', 'vendedor', ['core', 'catalogo'])).toEqual([]);
    expect(ids('campo', 'vendedor', ['core', 'vendedor'])).toEqual([]);
  });

  it('as telas do Catálogo não desenham ação de pedido própria: os botões saem só de useExtensoes("produto.acoes")', () => {
    expect(ler('modules/catalogo/app/telas/comum.tsx')).toMatch(/useExtensoes<AcaoProduto>\('produto\.acoes'\)/);
    for (const tela of ['catalogo.tsx', 'produto.tsx', 'comum.tsx']) {
      // sem comentários: o cabeçalho de comum.tsx cita `acao: 'pedido.criar'` para explicar a regra
      const fonte = ler(`modules/catalogo/app/telas/${tela}`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(fonte, tela).not.toMatch(/['"]pedido\.(criar|editar)['"]/);
      expect(fonte, tela).not.toContain('produto-adicionar');
      expect(fonte, tela).not.toMatch(/@macuxi\/vendedor/);
    }
  });
});

/**
 * T-0085 (RF-GES-05, RN-VEN-35) — pedido em nome do vendedor: a página `novo-pedido` vale também na Gestão (supervisor e
 * gerente) e o Vendedor registra o slot `pedido.criar_em_nome` (só Gestão, acao pedido.criar_em_nome). Regra 7 / RN-PRO-01
 * reforçada: em NENHUM app o promotor recebe a página `novo-pedido`, o `pedido.criar_em_nome` nem o "Adicionar ao pedido".
 */
describe('T-0085 — pedido em nome: Gestão para supervisor/gerente, nunca para o promotor (regra 7, RN-PRO-01)', () => {
  const APPS = ['campo', 'gestao'] as const;
  const ATIVOS_PIOR_CASO = [['core', 'catalogo', 'vendedor', 'promotor'], [...TODOS]] as const;
  const visao = (app: 'campo' | 'gestao', perfil: Perfil, ativos: readonly ModuloId[] = TODOS) => shellDoApp(app).montar({ perfil, modulosAtivos: [...ativos] });
  const emNome = itensVendedorApp.find((i) => i.slot === 'pedido.criar_em_nome');

  it('fonte e manifesto: o slot é oferecido pelo Vendedor e usado pelo Gestor; a extensão exige pedido.criar_em_nome (só supervisor e gerente) e é só da Gestão', () => {
    expect(emNome).toMatchObject({ tipo: 'extensao', slot: 'pedido.criar_em_nome', id: 'novo-pedido-em-nome', acao: 'pedido.criar_em_nome', apps: ['gestao'] });
    expect(vendedor.ofereceExtensoes).toContain('pedido.criar_em_nome');
    expect(vendedor.acoes['pedido.criar_em_nome']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(ehAcaoDeEscritaDePedido('pedido.criar_em_nome')).toBe(true);
    expect(promotor.usaExtensoes).not.toContain('pedido.criar_em_nome');
    expect(promotor.ofereceExtensoes).not.toContain('pedido.criar_em_nome');
  });

  it('pior caso: promotor com o Vendedor (e todos os módulos) na sessão, no Campo E na Gestão → sem novo-pedido, sem pedido em nome, sem "Adicionar ao pedido"', () => {
    for (const app of APPS)
      for (const ativos of ATIVOS_PIOR_CASO) {
        const v = visao(app, 'promotor', ativos);
        const rotulo = `${app} ${ativos.length} módulos`;
        expect(v.pagina('novo-pedido'), rotulo).toBeNull();
        expect(v.extensoes('pedido.criar_em_nome'), rotulo).toEqual([]);
        expect(v.extensoes('produto.acoes'), rotulo).toEqual([]);
        expect(v.extensoes('cliente.acoes'), rotulo).toEqual([]);
        for (const a of ACOES_DE_ESCRITA) expect(v.pode(a), `${rotulo} ${a}`).toBe(false);
      }
  });

  it('caso real: com tudo licenciado no tenant o Vendedor não é efetivo para o promotor, em nenhum app', () => {
    const porId = new Map(MANIFESTOS_INSTALADOS.map((m) => [m.id, m] as const));
    const ef = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS as Manifesto[], ativosNoTenant: [...TODOS], doPerfil: TODOS.filter((id) => porId.get(id)!.perfis.includes('promotor')) });
    expect(ef).not.toContain('vendedor');
    for (const app of APPS) {
      const v = visao(app, 'promotor', ef);
      expect(v.pagina('novo-pedido'), app).toBeNull();
      expect(v.extensoes('pedido.criar_em_nome'), app).toEqual([]);
    }
  });

  it('mutação controlada: o mesmo item SEM a acao chegaria ao promotor na Gestão — é a acao pedido.criar_em_nome que barra', () => {
    const semAcao = { slot: 'pedido.criar_em_nome', id: 'novo-pedido-em-nome', apps: ['gestao' as const], payload: { rotulo: 'x' } };
    const shell = criarShell<string>('gestao', [{ manifesto: core }, { manifesto: catalogo }, { manifesto: vendedor, extensoes: [semAcao] }, { manifesto: promotor }]);
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: ['core', 'catalogo', 'vendedor', 'promotor'] }).extensoes('pedido.criar_em_nome').map((e) => e.id)).toEqual(['novo-pedido-em-nome']);
    expect(visao('gestao', 'promotor', ['core', 'catalogo', 'vendedor', 'promotor']).extensoes('pedido.criar_em_nome')).toEqual([]);
  });

  it('controle positivo: supervisor e gerente na Gestão recebem a página novo-pedido e o "Fazer pedido em nome" (e não o "Adicionar ao pedido", que é do Campo)', () => {
    for (const perfil of ['supervisor', 'gerente'] as const) {
      const v = visao('gestao', perfil);
      expect(v.pagina('novo-pedido'), perfil).toMatchObject({ id: 'novo-pedido', acao: 'pedido.criar' });
      expect(v.extensoes('pedido.criar_em_nome').map((e) => `${e.modulo}/${e.id}`), perfil).toEqual(['vendedor/novo-pedido-em-nome']);
      expect(v.pode('pedido.criar_em_nome'), perfil).toBe(true);
      expect(v.extensoes('produto.acoes'), perfil).toEqual([]);
      // a página não vira aba: o Gestão continua só com a aba Pedidos do Vendedor
      expect(v.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo), perfil).toEqual(['Pedidos']);
    }
  });

  it('o pedido em nome é só de supervisor e gerente na Gestão: nem o vendedor (nem o analista) recebe o item; no Campo ninguém recebe', () => {
    for (const perfil of ['vendedor', 'analista', 'assistente', 'admin'] as const) expect(visao('gestao', perfil).extensoes('pedido.criar_em_nome'), perfil).toEqual([]);
    for (const perfil of ['vendedor', 'supervisor', 'gerente', 'promotor'] as const) expect(visao('campo', perfil).extensoes('pedido.criar_em_nome'), perfil).toEqual([]);
    // o vendedor continua com o novo pedido do Campo
    expect(visao('campo', 'vendedor').pagina('novo-pedido')).not.toBeNull();
  });

  it('módulo desativado: sem o Vendedor ativo a Gestão do supervisor não tem novo-pedido nem pedido em nome (RN-CORE-03)', () => {
    const v = visao('gestao', 'supervisor', ['core', 'catalogo', 'promotor', 'gestor']);
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.extensoes('pedido.criar_em_nome')).toEqual([]);
  });

  it('a ficha do Gestor só desenha o pedido em nome a partir do slot (useExtensoes) e não cita ação de pedido própria', () => {
    const ficha = ler('modules/gestor/app/screens/ficha-screen.tsx');
    expect(ficha).toMatch(/useExtensoes<AcaoPedidoEmNome>\('pedido\.criar_em_nome'\)/);
    const semComentarios = ficha.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(semComentarios).not.toMatch(/@macuxi\/vendedor\/app/);
    expect(semComentarios).not.toMatch(/['"]pedido\.(criar|editar|cancelar|excluir)['"]/);
  });
});
