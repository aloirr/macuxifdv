/**
 * T-0076 — Início pela referência aprovada e Cliente 360 sem "Ver catálogo": montagem REAL dos módulos no `criarShell` do
 * platform-sdk (sem banco; roda local). Complementa o teste de componente do shell (apps/mobile/src/components/inicio-tela.test.tsx,
 * que copia os itens à mão): aqui os itens dos slots saem do que os módulos DECLARAM.
 * - Vendedor: as telas importam React Native (não roda no Node), então as extensões são LIDAS DO FONTE de
 *   modules/vendedor/app/index.ts (slot, id, ação, apps, ordem, destaque), como em promotor-sem-pedido.test.ts;
 * - Gestor e Pesquisa: os registros são genéricos no componente (`extensoesDoInicio`, `montarModuloApp`) e entram de verdade;
 * - Catálogo: o fonte não declara mais `cliente.acoes` e o manifesto não usa o slot (o shell recusaria a contribuição).
 * Critérios: 2 (cards somem com o módulo desativado), 4 (promotor, RN-PRO-01), 5 (Cliente 360: [Visitado] + [+ Novo pedido],
 * "Última compra" uma vez) e 3 (o Início entra na varredura de timers do CI, RN-CORE-23 / ADR 0018).
 * Matriz: docs/testes/T-0076.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { criarShell, modulosEfetivos, type ItemExtensaoShell, type Manifesto, type ModuloId, type ModuloShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MANIFESTOS_INSTALADOS } from '../../apps/mobile/src/lib/instalados';
import { acoesDoRodapeCliente } from '../../modules/core/domain/rodape-cliente';
import { extensoesDoInicio } from '../../modules/gestor/app/registro-inicio';
import { montarModuloApp as montarPesquisa } from '../../modules/pesquisa/app/registro';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'];

interface ExtensaoLida {
  slot: string;
  id: string;
  acao?: string;
  apps?: Array<'campo' | 'gestao'>;
  ordem?: number;
  destaque: boolean;
}

/** Extensões (`slot: ...` até o próximo `slot:`) declaradas no `moduloApp` do fonte. */
function extensoesDoFonte(fonte: string): ExtensaoLida[] {
  const ext = fonte.slice(fonte.indexOf('extensoes:'));
  return ext
    .split(/slot: /)
    .slice(1)
    .map((bloco) => {
      const ordem = /\bordem: (\d+)/.exec(bloco)?.[1];
      const apps = /\bapps: \[([^\]]*)\]/.exec(bloco)?.[1]?.match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) as ExtensaoLida['apps'];
      return {
        slot: /^'([^']+)'/.exec(bloco)![1]!,
        id: /\bid: '([^']+)'/.exec(bloco)?.[1] ?? '?',
        acao: /\bacao: '([^']+)'/.exec(bloco)?.[1],
        ...(apps ? { apps } : {}),
        ...(ordem ? { ordem: Number(ordem) } : {}),
        destaque: /\bdestaque: true/.test(bloco),
      };
    });
}

const FONTE_VENDEDOR = ler('modules/vendedor/app/index.ts');
const extVendedor = extensoesDoFonte(FONTE_VENDEDOR);
const itensVendedor: ItemExtensaoShell[] = extVendedor.map((e) => ({
  slot: e.slot,
  id: e.id,
  ...(e.acao ? { acao: e.acao } : {}),
  ...(e.apps ? { apps: e.apps } : {}),
  payload: { rotulo: e.id, destaque: e.destaque, ...(e.ordem !== undefined ? { ordem: e.ordem } : {}) },
}));
const porId = new Map(MANIFESTOS_INSTALADOS.map((m) => [m.id, m] as const));
const pesquisa = montarPesquisa<string>({ pesquisas: 'P', responder: 'R', abaCliente: 'A', etapaCheckout: 'E', cardInicio: 'CardPesquisas' }, () => true);
const MODULOS: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) =>
  m.id === 'vendedor'
    ? { manifesto: m, extensoes: itensVendedor }
    : m.id === 'gestor'
      ? { manifesto: m, extensoes: extensoesDoInicio<string>('CardAprovacoes') }
      : m.id === 'pesquisa'
        ? { ...pesquisa, manifesto: m }
        : { manifesto: m },
);

/** Módulos efetivos: ligados no tenant e no perfil (o perfil só recebe o que o manifesto aceita), com dependências (RN-CORE-03). */
const efetivos = (ativos: ModuloId[], perfil: Perfil) =>
  modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS as Manifesto[], ativosNoTenant: ativos, doPerfil: ativos.filter((id) => porId.get(id)!.perfis.includes(perfil)) });
const visao = (variante: 'campo' | 'gestao', perfil: Perfil, ativos: ModuloId[]) => criarShell(variante, MODULOS).montar({ perfil, modulosAtivos: efetivos(ativos, perfil) });
const slot = (variante: 'campo' | 'gestao', perfil: Perfil, ativos: ModuloId[], s: string) => visao(variante, perfil, ativos).extensoes(s).map((e) => `${e.modulo}/${e.id}`);
const cards = (variante: 'campo' | 'gestao', perfil: Perfil, ativos: ModuloId[]) => slot(variante, perfil, ativos, 'inicio.cards');
const semPesquisa = (l: string[]) => l.filter((x) => !x.startsWith('pesquisa/'));

describe('T-0076 — leitura do fonte (sanidade do teste)', () => {
  it('o Vendedor declara o card pedidos-resumo no inicio.cards: ação pedido.criar, só no Campo, ordem 20', () => {
    expect(extVendedor.find((e) => e.slot === 'inicio.cards')).toEqual({ slot: 'inicio.cards', id: 'pedidos-resumo', acao: 'pedido.criar', apps: ['campo'], ordem: 20, destaque: false });
    expect(extVendedor.find((e) => e.slot === 'cliente.acoes')).toMatchObject({ id: 'novo-pedido', acao: 'pedido.criar', apps: ['campo'], destaque: true });
    // o manifesto do Vendedor aceita o slot (senão o criarShell lançaria "Shell campo inconsistente")
    expect(porId.get('vendedor')!.usaExtensoes).toContain('inicio.cards');
  });

  it('os shells das duas variantes montam com os 8 módulos sem inconsistência', () => {
    expect(() => criarShell('campo', MODULOS)).not.toThrow();
    expect(() => criarShell('gestao', MODULOS)).not.toThrow();
  });
});

describe('Critério 2 — cards do Início somem com o módulo desativado (RN-CORE-02/03)', () => {
  it('Campo, vendedor COM o Vendedor: Orçamentos e A faturar (pedidos-resumo) entram no inicio.cards', () => {
    expect(cards('campo', 'vendedor', ['core', 'catalogo', 'vendedor'])).toEqual(['vendedor/pedidos-resumo']);
    // com todos os módulos, o card do Vendedor convive com os demais e o Gestor nunca aparece no Campo
    const todos = cards('campo', 'vendedor', TODOS);
    expect(todos).toContain('vendedor/pedidos-resumo');
    expect(todos.some((c) => c.startsWith('gestor/'))).toBe(false);
  });

  it('Campo, vendedor SEM o Vendedor (licença desligada) ou sem o Catálogo (dependência): nada de Orçamentos e A faturar, sem erro', () => {
    for (const ativos of [['core', 'catalogo'], ['core', 'vendedor'], ['core'], ['core', 'catalogo', 'promotor', 'pesquisa', 'treinamento']] as ModuloId[][]) {
      expect(cards('campo', 'vendedor', ativos), ativos.join(',')).not.toContain('vendedor/pedidos-resumo');
    }
    expect(semPesquisa(cards('campo', 'vendedor', ['core', 'catalogo']))).toEqual([]);
  });

  it('Gestão, supervisor e gerente COM o Gestor: "Pedidos para aprovar" (gestor/aprovacoes); o card do Vendedor é só do Campo', () => {
    for (const perfil of ['supervisor', 'gerente'] as Perfil[]) {
      expect(semPesquisa(cards('gestao', perfil, ['core', 'catalogo', 'vendedor', 'gestor'])), perfil).toEqual(['gestor/aprovacoes']);
      expect(semPesquisa(cards('gestao', perfil, TODOS)), perfil).toEqual(['gestor/aprovacoes']);
    }
  });

  it('Gestão SEM o Gestor: nada de "Pedidos para aprovar" (e nenhum card de pedido do Vendedor)', () => {
    for (const perfil of ['supervisor', 'gerente'] as Perfil[]) {
      expect(semPesquisa(cards('gestao', perfil, ['core', 'catalogo', 'vendedor'])), perfil).toEqual([]);
      expect(semPesquisa(cards('gestao', perfil, TODOS.filter((m) => m !== 'gestor'))), perfil).toEqual([]);
    }
  });

  it('ordem: "Pedidos para aprovar" (10) antes dos demais; pedidos-resumo (20) antes dos cards sem ordem (100)', () => {
    const v = visao('campo', 'vendedor', TODOS).extensoes<{ ordem?: number }>('inicio.cards');
    const resumo = v.find((e) => e.id === 'pedidos-resumo')!;
    expect(resumo.payload.ordem).toBe(20);
    const g = visao('gestao', 'supervisor', TODOS).extensoes<{ ordem?: number }>('inicio.cards');
    expect(g.find((e) => e.id === 'aprovacoes')!.payload.ordem).toBe(10);
  });
});

describe('Critério 4 — promotor (RN-PRO-01): sem Orçamentos, A faturar e Pedidos para aprovar', () => {
  // Pior caso, como em promotor-sem-pedido.test.ts: o Vendedor chega ATIVO ao shell do promotor (O-3: o promotor lê pedidos
  // com pedido.ver quando o tenant liga), sem passar pelo filtro de perfil do manifesto. Quem esconde é a ação pedido.criar.
  const doPromotor = (s: string) => criarShell('campo', MODULOS).montar({ perfil: 'promotor', modulosAtivos: TODOS }).extensoes(s).map((e) => `${e.modulo}/${e.id}`);

  it('promotor com o Vendedor ativo (pior caso): nenhum card de pedido no Início do Campo', () => {
    const v = criarShell('campo', MODULOS).montar({ perfil: 'promotor', modulosAtivos: TODOS });
    expect(v.pode('pedido.ver')).toBe(true); // o Vendedor está mesmo ativo para ele
    expect(v.pode('pedido.criar')).toBe(false);
    const c = doPromotor('inicio.cards');
    expect(c).not.toContain('vendedor/pedidos-resumo');
    expect(c.some((x) => x.startsWith('gestor/'))).toBe(false);
    // e pelo caminho normal (efetivos por perfil) também não
    expect(cards('campo', 'promotor', TODOS)).not.toContain('vendedor/pedidos-resumo');
  });

  it('promotor também não recebe o "+ Novo pedido" do rodapé do Cliente 360 (cliente.acoes vazio)', () => {
    expect(doPromotor('cliente.acoes')).toEqual([]);
    expect(slot('campo', 'promotor', TODOS, 'cliente.acoes')).toEqual([]);
  });
});

describe('Critério 5 — Cliente 360 sem "Ver catálogo": rodapé [Visitado] + [+ Novo pedido]', () => {
  it('o Catálogo não contribui mais com cliente.acoes: nem no fonte do app nem no manifesto', () => {
    const fonte = ler('modules/catalogo/app/index.ts');
    expect(fonte).not.toMatch(/slot:\s*'cliente\.acoes'/);
    expect(fonte).not.toContain('ver-catalogo');
    expect(catalogo.usaExtensoes).not.toContain('cliente.acoes');
  });

  it('se alguém devolver o "Ver catálogo" sem mexer no manifesto, o shell recusa (o atalho não volta por engano)', () => {
    const comAtalho = MODULOS.map((m) =>
      m.manifesto.id === 'catalogo' ? { ...m, extensoes: [{ slot: 'cliente.acoes', id: 'ver-catalogo', acao: 'produto.consultar', payload: { rotulo: 'Ver catálogo' } }] } : m,
    );
    expect(() => criarShell('campo', comAtalho)).toThrow(/catalogo\/ver-catalogo: slot cliente\.acoes não está em usaExtensoes/);
  });

  it('em nenhuma variante, perfil ou combinação de módulos aparece ver-catalogo no cliente.acoes', () => {
    for (const variante of ['campo', 'gestao'] as const)
      for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente'] as Perfil[]) {
        const acoes = slot(variante, perfil, TODOS, 'cliente.acoes');
        expect(acoes.filter((a) => a.endsWith('/ver-catalogo')), `${variante}/${perfil}`).toEqual([]);
      }
  });

  it('vendedor no Campo: o rodapé fica com a ação de destaque do Vendedor (+ Novo pedido), ao lado do botão de visita', () => {
    const acoes = visao('campo', 'vendedor', TODOS).extensoes<{ destaque?: boolean }>('cliente.acoes');
    expect(acoes.map((a) => `${a.modulo}/${a.id}`)).toEqual(['vendedor/novo-pedido']);
    expect(acoesDoRodapeCliente(acoes).map((a) => a.id)).toEqual(['novo-pedido']);
    // sem o Vendedor: só o botão de visita (nenhuma ação no rodapé)
    expect(acoesDoRodapeCliente(visao('campo', 'vendedor', ['core', 'catalogo']).extensoes<{ destaque?: boolean }>('cliente.acoes'))).toEqual([]);
  });

  it('a tela monta o rodapé com o botão Check-in/Visitado/Checkout e acoesDoRodapeCliente (sem outras ações)', () => {
    const tela = ler('modules/core/app/telas/cliente.tsx');
    expect(tela).toContain("visited ? 'Visitado' : 'Check-in'");
    const rodape = tela.slice(tela.indexOf('<View style={styles.footer}>'), tela.indexOf('<CheckinSheet'));
    expect(rodape).toContain('label={visitLabel}');
    expect(rodape).toContain('acoesDoRodapeCliente(acoes).map(');
    expect(rodape.match(/<Button\b/g)).toHaveLength(2);
  });

  it('"Última compra" uma vez só: a tela passa os cartões à grade do Cliente 360, que então não repete o seu', () => {
    const tela = ler('modules/core/app/telas/cliente.tsx');
    expect(tela.match(/label="Última compra"/g)).toHaveLength(1);
    expect(tela).toMatch(/<SecoesCliente360 ficha=\{ficha\} indicadoresIniciais=\{indicadoresDoCliente\} \/>/);
    const c360 = ler('modules/core/app/components/cliente360.tsx');
    expect(c360.match(/label="Última compra"/g)).toHaveLength(1);
    expect(c360).toMatch(/\{indicadoresIniciais \? null : <Stat label="Última compra"/);
  });
});

describe('Critério 3 — o Início não cria timer automático < 15 min (RN-CORE-23, ADR 0018)', () => {
  type Violacao = { arquivo: string; linha: number; tipo: string; atraso: string; motivo: string };
  type Varredura = { pastasAlvo(raiz: string): string[]; varrer(raiz?: string): Violacao[]; varrerTexto(texto: string, arquivo: string): Violacao[] };
  const carregar = async () => (await import(pathToFileURL(join(RAIZ, 'scripts', 'ci', 'timers-sync.mjs')).href)) as Varredura;
  const ARQUIVOS_DO_INICIO = [
    'apps/mobile/src/app/(tabs)/index.tsx',
    'apps/mobile/src/components/inicio.tsx',
    'apps/mobile/src/lib/inicio.ts',
    'modules/core/app/lib/usar-inicio.ts',
    'modules/core/app/lib/inicio-local.ts',
    'modules/vendedor/app/components/cards-inicio.tsx',
    'modules/vendedor/app/state/use-resumo-inicio.ts',
    'modules/gestor/app/components/card-aprovacoes.tsx',
    'packages/ui/src/mobile/sincronizacao.tsx',
  ];

  it('os arquivos do Início (shell, Core, Vendedor, Gestor e o kit Sincronizar) estão nas pastas que o `pnpm timers` varre', async () => {
    const pastas = (await carregar()).pastasAlvo(RAIZ);
    for (const a of ARQUIVOS_DO_INICIO) {
      expect(() => readFileSync(join(RAIZ, a)), a).not.toThrow();
      expect(pastas.some((p) => a.startsWith(`${p}/`)), a).toBe(true);
    }
  });

  // Lê todos os .ts/.tsx do app e do BKO (as constantes exportadas resolvem os atrasos): 10 a 27 s com a máquina carregada
  // de agentes (medido em 10/11 na árvore e no origin/main). Prazo próprio para não depender do testTimeout do
  // tests/vitest.config.ts (60 s): rodado sem o config (`npx vitest run tests/...` da raiz), o padrão de 5 s estourava.
  it('a varredura do repositório não acha timer < 15 min em nenhum arquivo do Início', async () => {
    const v = (await carregar()).varrer(RAIZ);
    expect(v.filter((x) => ARQUIVOS_DO_INICIO.includes(x.arquivo))).toEqual([]);
  }, 120_000);

  it('nenhum setInterval/refetchInterval nos arquivos do Início (atualização só pelo agendador do shell e pelo botão Sincronizar)', () => {
    for (const a of ARQUIVOS_DO_INICIO) expect(ler(a), a).not.toMatch(/setInterval\(|refetchInterval/);
    // o Início usa o agendador único do shell (intervalo do parâmetro sync_auto_min, mínimo 15 min)
    expect(ler('apps/mobile/src/app/(tabs)/index.tsx')).toContain('useAtualizacaoAutomatica(');
  });

  it('controle: um setInterval de 60 s no Início seria pego pela varredura', async () => {
    const v = (await carregar()).varrerTexto('setInterval(() => sincronizar(), 60_000);\n', 'apps/mobile/src/components/inicio.tsx');
    expect(v).toHaveLength(1);
  });
});
