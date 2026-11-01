/**
 * Registro de telas dos módulos nos shells (ADR 0003; desenho T-0001 §14). Ponto de extensão da B2.
 *
 * Cada módulo exporta de `modules/<m>/web/index.ts` (BKO) ou `modules/<m>/app/index.ts` (Android) um
 * `definirModuloShell({...})` com as páginas/telas, as entidades e etapas de sync e as extensões de UI.
 * O shell junta tudo com `montarShell` e mostra só o que vale para o usuário: módulo efetivo
 * (RN-CORE-01/03), variante/app certa, perfil e permissão por ação (ADR 0004, RN-PRO-01).
 *
 * Genérico no tipo do componente (`C`): React (web) e React Native (app) usam o mesmo registro;
 * aqui não há React — os testes rodam em Node.
 */
import { ordenarPorDependencia, problemasDasConsultas, type Manifesto } from './manifesto';
import type { AppId, ModuloId, Perfil } from './nomes';
import { criarPermissoes, type Permissoes } from './permissoes';
import type { EtapaSync } from './motor-sync';
import type { DefinicaoEntidadeSync } from './sync';
import { criarRegistroSync } from './sync';
import { criarRegistroExtensoes, type ItemExtensao } from './extensoes';
import type { IndiceBusca } from './busca';
import { validarMigracoes, type MigracaoAparelho } from './sqlite/esquema';
import { criarRegistroConsultasAparelho, type ImplementacaoConsultaAparelho } from './consultas';

export type AppShell = Exclude<AppId, 'conector'>;

export interface PaginaShell<C> {
  /** Id único no módulo; vira o testID estável `nav-<modulo>-<id>` (menu/aba) e `pagina-<modulo>-<id>`. */
  id: string;
  /** Caminho sem barra inicial, único no shell: web `pedidos` → `/pedidos`; app `pedidos` → `/m/pedidos`. */
  caminho: string;
  /** Título da página (cabeçalho, título da aba do navegador). */
  titulo: string;
  /**
   * Rótulo no menu (web) ou na barra de abas (app). Precisa estar declarado no manifesto
   * (`apps.web.menus` / `apps.<campo|gestao>.abas`). Sem rótulo = página sem item de navegação.
   */
  navegacao?: string;
  /** Nome do ícone do kit de UI (`@macuxi/ui`). */
  icone?: string;
  /** Agrupamento no menu do BKO (padrão: 'operacao'). */
  grupo?: 'operacao' | 'cadastros' | 'analise' | 'administracao';
  /** Menor aparece primeiro (padrão 100). */
  ordem?: number;
  /** Só nestas variantes do app (padrão: todas as que o manifesto declara). */
  apps?: readonly AppShell[];
  /** Restringe a perfis (além dos perfis do módulo). */
  perfis?: readonly Perfil[];
  /** Ação exigida para ver a página (ex.: 'pedido.criar' na tela de novo pedido). */
  acao?: string;
  /** Componente da página (React no web, React Native no app). */
  componente: C;
}

export interface ModuloShell<C> {
  manifesto: Manifesto;
  paginas?: readonly PaginaShell<C>[];
  /** Entidades de sync deste módulo (app). Devem estar em `manifesto.sync`. */
  entidadesSync?: readonly DefinicaoEntidadeSync[];
  /** Etapas de carga próprias (app), ex.: REST da Fase M. */
  etapasSync?: readonly EtapaSync[];
  /** Itens que o módulo registra em slots de extensão de UI (o slot precisa estar em `manifesto.usaExtensoes`). */
  extensoes?: readonly ItemExtensaoShell[];
  /**
   * Esquema local do módulo no SQLite do aparelho (`modules/<m>/db/aparelho.ts`, dono banco-dados): só objetos
   * `<m>__*`, versões crescentes, só para frente (desenho T-0008 §1.4).
   */
  migracoesAparelho?: readonly MigracaoAparelho[];
  /** Índices de busca textual do módulo (`definirIndiceBusca`; tabelas criadas pelas `migracoesAparelho`). */
  indicesBusca?: readonly IndiceBusca[];
  /**
   * Consultas que o módulo responde NO APARELHO (ADR 0012), sobre as próprias linhas locais: precisam estar em
   * `ofereceConsultas`. Opcional por consulta: a que só existe na API (ex.: `core.cadastro_resumo@1`) dá
   * `ConsultaIndisponivel` no aparelho.
   */
  consultas?: readonly ImplementacaoConsultaAparelho[];
}

/** Item de extensão de UI registrado por um módulo (o `payload` é tipado pelo contrato do slot, no contracts do dono). */
export interface ItemExtensaoShell extends Omit<ItemExtensao<unknown>, 'modulo'> {
  slot: string;
}

/** Ajuda de tipo para `modules/<m>/{web,app}/index.ts`. */
export function definirModuloShell<C>(m: ModuloShell<C>): ModuloShell<C> {
  const ids = new Set<string>();
  for (const p of m.paginas ?? []) {
    if (ids.has(p.id)) throw new Error(`Página ${m.manifesto.id}/${p.id} repetida`);
    ids.add(p.id);
    if (p.caminho.startsWith('/')) throw new Error(`Caminho sem barra inicial: ${p.caminho}`);
  }
  return m;
}

export interface ContextoShell {
  app: AppShell;
  perfil: Perfil | null;
  /** Módulos efetivos do usuário, em ordem de dependência (`modulosEfetivos`). */
  modulosAtivos: readonly ModuloId[];
}

export interface ItemNavegacao<C> {
  modulo: ModuloId;
  id: string;
  rotulo: string;
  caminho: string;
  icone?: string;
  grupo: NonNullable<PaginaShell<C>['grupo']>;
  /** testID / data-testid estável: `nav-<modulo>-<id>`. */
  testID: string;
  pagina: PaginaShell<C>;
}

/**
 * Valida o conjunto (manifestos coerentes, rótulos declarados, caminhos únicos, entidades no manifesto)
 * e devolve uma função que monta a visão do usuário. Erros de montagem estouram no início do shell.
 */
export function criarShell<C>(app: AppShell, modulos: readonly ModuloShell<C>[]) {
  const manifestos = modulos.map((m) => m.manifesto);
  const permissoes = criarPermissoes(manifestos);
  const registroSync = criarRegistroSync(manifestos);
  const problemas: string[] = [];
  // dependências obrigatórias instaladas e sem ciclo (extensões usadas podem faltar: somem sem erro, RN-CORE-03)
  const ids = new Set(manifestos.map((m) => m.id));
  for (const m of manifestos) for (const d of m.depende) if (!ids.has(d)) problemas.push(`${m.id} depende de ${d}, que não está instalado`);
  try {
    ordenarPorDependencia(manifestos);
  } catch (e) {
    problemas.push((e as Error).message);
  }
  const caminhos = new Map<string, string>();
  for (const m of modulos) {
    const declarados = app === 'web' ? (m.manifesto.apps.web?.menus ?? []) : (m.manifesto.apps[app]?.abas ?? []);
    for (const p of m.paginas ?? []) {
      if (p.apps && !p.apps.includes(app)) continue;
      const dono = caminhos.get(p.caminho);
      if (dono) problemas.push(`caminho ${p.caminho} usado por ${dono} e por ${m.manifesto.id}`);
      caminhos.set(p.caminho, m.manifesto.id);
      if (p.navegacao && !declarados.includes(p.navegacao)) {
        problemas.push(`${m.manifesto.id}/${p.id}: "${p.navegacao}" não está em apps.${app}.${app === 'web' ? 'menus' : 'abas'} do manifesto`);
      }
      if (p.acao && !permissoes.conhece(p.acao)) problemas.push(`${m.manifesto.id}/${p.id}: ação ${p.acao} não declarada em nenhum manifesto`);
    }
    for (const e of m.entidadesSync ?? []) {
      try {
        registroSync.registrar(e);
      } catch (err) {
        problemas.push((err as Error).message);
      }
    }
  }
  // extensões de UI: slots declarados pelos donos (`ofereceExtensoes`); item de slot sem dono instalado some sem erro (RN-CORE-03)
  const extensoes = criarRegistroExtensoes();
  for (const m of manifestos) for (const slot of m.ofereceExtensoes) extensoes.declararSlot(slot, m.id);
  for (const m of modulos) {
    for (const item of m.extensoes ?? []) {
      const { slot, ...resto } = item;
      if (!m.manifesto.usaExtensoes.includes(slot) && !m.manifesto.ofereceExtensoes.includes(slot)) {
        problemas.push(`${m.manifesto.id}/${item.id}: slot ${slot} não está em usaExtensoes do manifesto`);
        continue;
      }
      if (item.acao && !permissoes.conhece(item.acao)) problemas.push(`${m.manifesto.id}/${item.id}: ação ${item.acao} não declarada em nenhum manifesto`);
      if (!extensoes.donoDoSlot(slot)) continue;
      // E4 (T-0029): item de outro app nem entra no registro desta variante
      if (item.apps && !item.apps.includes(app)) continue;
      extensoes.registrar(slot, { ...resto, modulo: m.manifesto.id });
    }
  }
  // armazenamento local (T-0008 §1.4 e §2.1): migrações do próprio módulo; índice só sobre fontes do módulo ou de `depende`
  const migracoesAparelho: Partial<Record<ModuloId, readonly MigracaoAparelho[]>> = {};
  const indicesBusca: IndiceBusca[] = [];
  for (const m of modulos) {
    const id = m.manifesto.id;
    if (m.migracoesAparelho?.length) {
      try {
        validarMigracoes(id, m.migracoesAparelho);
        migracoesAparelho[id] = m.migracoesAparelho;
      } catch (err) {
        problemas.push((err as Error).message);
      }
    }
    for (const i of m.indicesBusca ?? []) {
      if (i.modulo !== id) problemas.push(`${id}: índice ${i.id} declarado como de ${i.modulo}`);
      if (indicesBusca.some((x) => x.id === i.id)) problemas.push(`índice de busca ${i.id} repetido`);
      if (!m.migracoesAparelho?.length) problemas.push(`${id}: índice ${i.id} sem migracoesAparelho (as tabelas não existiriam)`);
      for (const f of i.fontes) {
        const def = registroSync.entidade(f);
        if (!def) problemas.push(`${id}: fonte ${f} do índice ${i.id} não está registrada`);
        else if (def.direcao === 'push') problemas.push(`${id}: fonte ${f} do índice ${i.id} não tem pull`);
        else if (def.modulo !== id && !m.manifesto.depende.includes(def.modulo))
          problemas.push(`${id}: fonte ${f} do índice ${i.id} é de ${def.modulo}, que não está em depende`);
      }
      indicesBusca.push(i);
    }
  }
  // consultas entre módulos (ADR 0012): usadas × oferecidas no conjunto e implementações do aparelho
  problemas.push(...problemasDasConsultas(manifestos));
  const consultas = criarRegistroConsultasAparelho(modulos);
  problemas.push(...consultas.problemas);
  if (problemas.length > 0) throw new Error(`Shell ${app} inconsistente: ${problemas.join('; ')}`);

  const etapas = modulos.flatMap((m) => m.etapasSync ?? []);

  return {
    app,
    manifestos,
    permissoes,
    registroSync,
    etapasSync: etapas,
    /** Para o adaptador SQLite do aparelho (`criarArmazenamentoSqlite`). */
    migracoesAparelho,
    indicesBusca: indicesBusca as readonly IndiceBusca[],
    /** Para o motor do aparelho (`criarMotorSync({ consultas })`): executa `ambiente.consultar`. */
    consultas: consultas.registro,
    /** Visão do usuário: só módulos efetivos, desta variante, do perfil e com permissão. */
    montar(ctx: Omit<ContextoShell, 'app'>): VisaoShell<C> {
      return montarVisao(app, modulos, permissoes, extensoes, ctx);
    },
  };
}

export type Shell<C> = ReturnType<typeof criarShell<C>>;

export interface VisaoShell<C> {
  app: AppShell;
  perfil: Perfil | null;
  modulosAtivos: readonly ModuloId[];
  /** Itens de menu/aba, em ordem (grupo, ordem, ordem de dependência do módulo). */
  navegacao: ItemNavegacao<C>[];
  /** Página do caminho (sem barra inicial) ou null se não existe ou não é permitida. */
  pagina(caminho: string): (PaginaShell<C> & { modulo: ModuloId }) | null;
  /** Permissão por ação já ligada ao usuário. */
  pode(acao: string): boolean;
  /** Itens de um slot de extensão de UI visíveis ao usuário (módulos efetivos, perfil e ação — ADR 0004). */
  extensoes<P = unknown>(slot: string): ItemExtensao<P>[];
}

const ORDEM_GRUPO = ['operacao', 'cadastros', 'analise', 'administracao'] as const;

function montarVisao<C>(
  app: AppShell,
  modulos: readonly ModuloShell<C>[],
  permissoes: Permissoes,
  extensoes: ReturnType<typeof criarRegistroExtensoes>,
  ctx: Omit<ContextoShell, 'app'>,
): VisaoShell<C> {
  const ativos = ctx.modulosAtivos;
  const pode = (acao: string) => permissoes.pode(acao, { perfil: ctx.perfil, modulosAtivos: ativos });
  const visiveis = new Map<string, PaginaShell<C> & { modulo: ModuloId }>();
  const navegacao: ItemNavegacao<C>[] = [];
  const posicaoModulo = new Map(ativos.map((id, i) => [id, i] as const));
  for (const m of modulos) {
    const id = m.manifesto.id;
    if (!ativos.includes(id)) continue;
    // o perfil já entrou no cálculo dos efetivos (RN-CORE-01); `manifesto.perfis` é só o padrão do perfil
    if (!ctx.perfil) continue;
    if (app !== 'web' && !m.manifesto.apps[app]) continue;
    for (const p of m.paginas ?? []) {
      if (p.apps && !p.apps.includes(app)) continue;
      if (p.perfis && !p.perfis.includes(ctx.perfil)) continue;
      if (p.acao && !pode(p.acao)) continue;
      visiveis.set(p.caminho, { ...p, modulo: id });
      if (p.navegacao) {
        navegacao.push({ modulo: id, id: p.id, rotulo: p.navegacao, caminho: p.caminho, icone: p.icone, grupo: p.grupo ?? 'operacao', testID: `nav-${id}-${p.id}`, pagina: p });
      }
    }
  }
  navegacao.sort(
    (a, b) =>
      ORDEM_GRUPO.indexOf(a.grupo) - ORDEM_GRUPO.indexOf(b.grupo) ||
      (a.pagina.ordem ?? 100) - (b.pagina.ordem ?? 100) ||
      (posicaoModulo.get(a.modulo) ?? 0) - (posicaoModulo.get(b.modulo) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return {
    app,
    perfil: ctx.perfil,
    modulosAtivos: ativos,
    navegacao,
    pagina: (caminho) => visiveis.get(caminho.replace(/^\/+/, '')) ?? null,
    pode,
    extensoes: <P,>(slot: string) =>
      extensoes.listar(slot, { app, modulosAtivos: ativos, perfil: ctx.perfil ?? undefined, pode }) as ItemExtensao<P>[],
  };
}
