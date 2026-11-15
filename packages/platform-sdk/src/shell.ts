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
import type { PerfilDaRequisicao } from './permissoes-perfil';
import type { EtapaSync } from './motor-sync';
import type { DefinicaoEntidadeSync } from './sync';
import { criarRegistroSync } from './sync';
import { criarRegistroExtensoes, type ItemExtensao } from './extensoes';
import type { IndiceBusca } from './busca';
import { validarMigracoes, type MigracaoAparelho } from './sqlite/esquema';
import { criarRegistroConsultasAparelho, type ImplementacaoConsultaAparelho } from './consultas';

export type AppShell = Exclude<AppId, 'conector'>;

/** Link interno do app: `/m/<caminho>` com caminho em minúsculas, dígitos e hífen (convenção de `PaginaShell.caminho`). */
const LINK_INTERNO = /^\/m\/[a-z0-9-]+/;

/**
 * Caminho da tela de um link interno do app (`/m/rota?x=1#y` → `rota`; `/m/pedidos/novo` → `pedidos/novo`);
 * null fora do padrão `/m/<caminho>`. Fonte única da regra (RD-0032): Início do shell e central de notificações do Core.
 */
export function caminhoDoLinkInterno(link: string | null | undefined): string | null {
  if (!link || !LINK_INTERNO.test(link)) return null;
  return link.slice(3).split(/[?#]/)[0] ?? null;
}

/**
 * O próprio link, se for interno (`/m/<caminho>`) e, com `telaExiste` (a `visao.pagina` do shell), a tela existir na
 * visão do usuário; senão null. Quem chama decide o destino do null (ex.: a central de notificações).
 */
export function linkInternoNavegavel(link: string | null | undefined, telaExiste?: (caminho: string) => boolean): string | null {
  const caminho = caminhoDoLinkInterno(link);
  if (!link || !caminho) return null;
  return !telaExiste || telaExiste(caminho) ? link : null;
}

/**
 * Grupos do menu do BKO (ADR 0050, revista pela ADR 0058; spec docs/design/menu-parametros/spec.md §2). O menu mostra
 * os grupos e os itens em ordem alfabética pelo rótulo (pt-BR, sem diferenciar acento e caixa), com Parâmetros e
 * Sistema fixos no fim, nesta ordem (`GRUPOS_FIXOS_NO_FIM`, D1). Grupo com uma página só vira item direto (D9, no shell).
 */
export const GRUPOS_MENU = [
  'acesso',
  'analise',
  'cadastros',
  'comunicacao',
  'operacao',
  'parametros',
  'pesquisa',
  'produtos',
  'sistema',
  'trade',
  'treinamento',
] as const;
export type GrupoMenu = (typeof GRUPOS_MENU)[number];

export const ROTULO_GRUPO_MENU: Record<GrupoMenu, string> = {
  acesso: 'Acesso',
  analise: 'Análise',
  cadastros: 'Cadastros',
  comunicacao: 'Comunicação',
  operacao: 'Operação',
  parametros: 'Parâmetros',
  pesquisa: 'Pesquisa',
  produtos: 'Produtos',
  sistema: 'Sistema',
  trade: 'Trade',
  treinamento: 'Treinamento',
};

/** ADR 0058 (D1): grupos fora da ordem alfabética, no fim do menu, nesta ordem (Parâmetros logo acima de Sistema). */
export const GRUPOS_FIXOS_NO_FIM: readonly string[] = ['parametros', 'sistema'];

/**
 * Comparador dos grupos do menu do BKO (ADR 0058): alfabético pelo título (`compararRotuloMenu`), com os
 * `GRUPOS_FIXOS_NO_FIM` depois de todos. Aceita grupos do shell fora do SDK (ex.: "Mais").
 */
export function compararGrupoMenu(a: { id: string; titulo: string }, b: { id: string; titulo: string }): number {
  const fa = GRUPOS_FIXOS_NO_FIM.indexOf(a.id);
  const fb = GRUPOS_FIXOS_NO_FIM.indexOf(b.id);
  if (fa !== fb) return fa === -1 ? -1 : fb === -1 ? 1 : fa - fb;
  return compararRotuloMenu(a.titulo, b.titulo) || a.id.localeCompare(b.id);
}

/**
 * Seções da página Parâmetros do BKO (ADR 0058; `/parametros/<secao>`). A lista é fixa: seção nova entra aqui, com ADR.
 * Cada seção empilha os painéis (`PainelParametros`) que os módulos declaram para ela.
 */
export const SECOES_PARAMETROS = [
  'acesso',
  'alertas',
  'calendario',
  'clientes',
  'inicio',
  'metas-e-rv',
  'pedidos',
  'pesquisa',
  'produtos',
  'trade',
  'treinamento',
  'visitas',
] as const;
export type SecaoParametros = (typeof SECOES_PARAMETROS)[number];

export const ROTULO_SECAO_PARAMETROS: Record<SecaoParametros, string> = {
  acesso: 'Acesso',
  alertas: 'Alertas',
  calendario: 'Calendário',
  clientes: 'Clientes',
  inicio: 'Início',
  'metas-e-rv': 'Metas e RV',
  pedidos: 'Pedidos',
  pesquisa: 'Pesquisa',
  produtos: 'Produtos',
  trade: 'Trade',
  treinamento: 'Treinamento',
  visitas: 'Visitas',
};

/**
 * ADR 0058 (R-20261115-113500): módulos "de vitrine". Sem a licença da EMPRESA (`ContextoShell.modulosContratados`),
 * as páginas com menu deles aparecem desativadas (`bloqueado`) e a seção de Parâmetros deles aparece com cadeado.
 * Os demais módulos somem sem licença, como antes (RN-CORE-01/03). Módulo novo nesta lista: com ADR.
 */
export const VITRINE_SEM_LICENCA: Readonly<Partial<Record<ModuloId, { grupo: GrupoMenu; secao: SecaoParametros }>>> = {
  pesquisa: { grupo: 'pesquisa', secao: 'pesquisa' },
  promotor: { grupo: 'trade', secao: 'trade' },
  treinamento: { grupo: 'treinamento', secao: 'treinamento' },
};

/** Grupo aceito em `PaginaShell.grupo` durante a transição (ADR 0050 e 0058): os grupos de hoje e os que saíram. */
export type GrupoDeclarado = GrupoMenu | 'administracao' | 'comercial' | 'conteudo_campo';

interface Transicao {
  /** Grupos declarados que a linha reconhece (o de antes e o da ADR 0050). */
  de: readonly GrupoDeclarado[];
  /** Grupo do menu (ADR 0058). Ausente com `secao`: a página vira painel de Parâmetros e sai do menu. */
  para?: GrupoMenu;
  /** A página inteira vira painel desta seção de Parâmetros até o módulo declarar o `PainelParametros` (ADR 0058). */
  secao?: SecaoParametros;
  /** Ordem do painel na seção (padrão 100). */
  ordem?: number;
  /** Rótulo do item no menu até o módulo trocar a `navegacao` (D8: Trade › Cadastros e Indicadores). */
  rotulo?: string;
}

/**
 * Transição das ADRs 0050 e 0058: `<modulo>/<idDaPagina>` → grupo (ou seção de Parâmetros) do menu final. Só vale
 * enquanto a página declarar um dos grupos de `de`; quando o módulo declara o grupo final (ou tira a página e declara o
 * painel), a linha deixa de valer sozinha e sai no fim da transição (junto com 'administracao', 'comercial' e
 * 'conteudo_campo').
 */
const TRANSICAO_GRUPO: Readonly<Record<string, Transicao>> = {
  'core/aparelhos': { de: ['administracao'], para: 'acesso' },
  'core/usuarios': { de: ['administracao'], para: 'acesso' },
  'core/perfis': { de: ['administracao', 'acesso'], secao: 'acesso', ordem: 10 },
  'core/usuarios-e-modulos': { de: ['administracao', 'acesso'], secao: 'acesso', ordem: 20 },
  'core/clientes': { de: ['operacao'], para: 'cadastros' },
  'core/motivos': { de: ['cadastros'], secao: 'visitas', ordem: 10 },
  'core/fotos-pdv': { de: ['cadastros'], secao: 'visitas', ordem: 20 },
  'core/plano-rv': { de: ['cadastros', 'comercial'], secao: 'metas-e-rv', ordem: 10 },
  'core/recados': { de: ['operacao'], para: 'comunicacao' },
  'core/produtos': { de: ['cadastros'], para: 'produtos' },
  'vendedor/alcadas': { de: ['cadastros', 'comercial'], secao: 'pedidos', ordem: 10 },
  'vendedor/formas-pagamento': { de: ['administracao', 'comercial'], para: 'cadastros' },
  'vendedor/transportadoras': { de: ['comercial'], para: 'cadastros' },
  'gestor/alertas': { de: ['operacao'], para: 'comunicacao' },
  'gestor/regras-alerta': { de: ['administracao', 'comunicacao'], secao: 'alertas', ordem: 10 },
  'pesquisa/pesquisas': { de: ['cadastros', 'conteudo_campo'], para: 'pesquisa' },
  'promotor/cadastros': { de: ['cadastros', 'conteudo_campo'], para: 'trade', rotulo: 'Cadastros' },
  'promotor/trade': { de: ['analise'], para: 'trade', rotulo: 'Indicadores' },
  'treinamento/trilhas': { de: ['cadastros', 'conteudo_campo'], para: 'treinamento' },
  'catalogo/catalogo': { de: ['cadastros'], para: 'produtos' },
  'catalogo/marcas': { de: ['cadastros'], para: 'produtos' },
  'catalogo/tabelas-preco': { de: ['cadastros'], para: 'produtos' },
  'integracao/carga-arquivo': { de: ['administracao'], para: 'sistema' },
  'integracao/monitor': { de: ['administracao'], para: 'sistema' },
};

/** Linha da transição que vale para a página (a página ainda declara um dos grupos de `de`), ou null. */
function transicaoDa(modulo: string, id: string, declarado: GrupoDeclarado): Transicao | null {
  const t = TRANSICAO_GRUPO[`${modulo}/${id}`];
  return t && t.de.includes(declarado) ? t : null;
}

/**
 * Grupo do menu do BKO da página (ADR 0050/0058): o declarado (padrão 'operacao'), passado pela tabela de transição
 * enquanto a página declarar o grupo de antes; fora da tabela, 'administracao' cai em 'sistema' e 'comercial' e
 * 'conteudo_campo' em 'cadastros'. Página que a transição leva para Parâmetros devolve 'parametros' (não vira item).
 */
export function grupoDoMenu(modulo: string, pagina: { id: string; grupo?: GrupoDeclarado }): GrupoMenu {
  return grupoResolvido(modulo, pagina.id, pagina.grupo ?? 'operacao');
}

function grupoResolvido(modulo: string, id: string, declarado: GrupoDeclarado): GrupoMenu {
  const t = transicaoDa(modulo, id, declarado);
  if (t) return t.para ?? 'parametros';
  return semTransicao(declarado);
}

function semTransicao(declarado: GrupoDeclarado): GrupoMenu {
  if (declarado === 'administracao') return 'sistema';
  if (declarado === 'comercial' || declarado === 'conteudo_campo') return 'cadastros';
  return declarado;
}

/**
 * Painel de uma seção da página Parâmetros do BKO (ADR 0058). Não é página: não tem caminho próprio nem item de menu;
 * o shell monta `/parametros/<secao>` empilhando os painéis visíveis da seção, de todos os módulos.
 */
export interface PainelParametros<C> {
  /** Id único entre os painéis do módulo; âncora `#<modulo>-<id>` e testID `parametros-<modulo>-<id>`. */
  id: string;
  secao: SecaoParametros;
  /** Título do painel (o `Panel`; o nome da seção não se repete no conteúdo). */
  titulo: string;
  /** Menor aparece primeiro na seção (padrão 100); empate: ordem de dependência do módulo, depois a declaração. */
  ordem?: number;
  /** Restringe a perfis (além dos perfis do módulo). */
  perfis?: readonly Perfil[];
  /** Ação exigida para ver o painel (ex.: 'perfil.gerir'). A API revalida (RN-CORE-01). */
  acao?: string;
  /** Endereços antigos (sem barra inicial) que o shell redireciona para `/parametros/<secao>#<modulo>-<id>`. */
  caminhosAntigos?: readonly string[];
  componente: C;
}

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
  /**
   * Grupo no menu do BKO (padrão: 'operacao'; ADRs 0050 e 0058, `GRUPOS_MENU`).
   * 'administracao', 'comercial' e 'conteudo_campo' estão @deprecated (transição): viram o grupo final pela tabela do SDK
   * (ou 'sistema'/'cadastros'). Parâmetro não é página: declare um `PainelParametros` em `ModuloShell.paineisParametros`.
   */
  grupo?: GrupoDeclarado;
  /** Menor aparece primeiro na barra de abas do app (padrão 100). O BKO ignora: ordem alfabética (ADR 0050). */
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
  /** ADR 0058: painéis da página Parâmetros do BKO (só o shell web usa; o app ignora). */
  paineisParametros?: readonly PainelParametros<C>[];
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
  /**
   * ADR 0033 (T-0111): perfis de acesso já resolvidos (fábrica + o que o tenant mudou + limites travados). Presentes, o motor decide
   * as ações da visão (`pode`); ausentes, vale o manifesto pelo `perfil` (legado).
   */
  perfis?: readonly PerfilDaRequisicao[];
  /**
   * ADR 0058: módulos contratados pela EMPRESA (ativos no tenant, sem o recorte do perfil; `modulos_contratados` de
   * `GET /v1/me/modulos`). Com ele, os módulos de `VITRINE_SEM_LICENCA` fora da lista aparecem desativados no BKO.
   * Ausente: nada aparece desativado (como antes). Só exibição: a API revalida a licença (RN-CORE-01).
   */
  modulosContratados?: readonly ModuloId[];
}

export interface ItemNavegacao<C> {
  modulo: ModuloId;
  id: string;
  rotulo: string;
  caminho: string;
  icone?: string;
  /**
   * Grupo declarado pela página (padrão 'operacao').
   * @deprecated transição da ADR 0050: use `grupoMenu`/`rotuloGrupo`; no fim da transição passa a ser `GrupoMenu`.
   */
  grupo: NonNullable<PaginaShell<C>['grupo']>;
  /** Grupo do menu do BKO já com a transição da ADR 0050 (`grupoDoMenu`). */
  grupoMenu: GrupoMenu;
  /** Rótulo do grupo (`ROTULO_GRUPO_MENU`). */
  rotuloGrupo: string;
  /** testID / data-testid estável: `nav-<modulo>-<id>`. */
  testID: string;
  /**
   * ADR 0058: item de módulo de vitrine que a empresa não contratou. O shell mostra desativado (cadeado, `aria-disabled`,
   * balão "Contrate o módulo para usar") e não navega; `visao.pagina(caminho)` devolve null para ele.
   */
  bloqueado?: boolean;
  pagina: PaginaShell<C>;
}

/** Painel visível de uma seção de Parâmetros (ADR 0058). */
export interface PainelParametrosVisivel<C> {
  modulo: ModuloId;
  id: string;
  titulo: string;
  /** Âncora do painel na seção: `<modulo>-<id>`. */
  ancora: string;
  /** testID / data-testid: `parametros-<modulo>-<id>`. */
  testID: string;
  /**
   * 'painel': `PainelParametros` declarado pelo módulo (o shell põe no `Panel` com o `titulo`).
   * 'pagina': transição; a página inteira do módulo ainda não virou painel (o shell a mostra como está, sem `Panel` nem título).
   */
  origem: 'painel' | 'pagina';
  componente: C;
}

/** Seção da página Parâmetros na visão do usuário (ADR 0058). */
export interface SecaoParametrosVisivel<C> {
  secao: SecaoParametros;
  rotulo: string;
  /** Endereço da seção: `parametros/<secao>` (sem barra inicial, como `PaginaShell.caminho`). */
  caminho: string;
  /** Seção de módulo de vitrine sem a licença da empresa: cadeado na lista e só "Contrate o módulo para usar" (sem painéis). */
  bloqueado: boolean;
  /** Painéis visíveis, na ordem (`ordem`, ordem de dependência do módulo, declaração). Vazio quando bloqueada. */
  paineis: PainelParametrosVisivel<C>[];
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
    // painéis de Parâmetros (ADR 0058): só no BKO; id único no módulo, seção da lista fixa, ação conhecida
    const paineis = new Set<string>();
    for (const pp of app === 'web' ? (m.paineisParametros ?? []) : []) {
      const nome = `${m.manifesto.id}/${pp.id}`;
      if (paineis.has(pp.id)) problemas.push(`painel de parâmetros ${nome} repetido`);
      paineis.add(pp.id);
      if (!(SECOES_PARAMETROS as readonly string[]).includes(pp.secao)) problemas.push(`${nome}: seção ${pp.secao} fora de SECOES_PARAMETROS`);
      if (pp.acao && !permissoes.conhece(pp.acao)) problemas.push(`${nome}: ação ${pp.acao} não declarada em nenhum manifesto`);
      for (const c of pp.caminhosAntigos ?? []) if (c.startsWith('/')) problemas.push(`${nome}: caminho antigo sem barra inicial: ${c}`);
    }
    for (const e of m.entidadesSync ?? []) {
      try {
        registroSync.registrar(e);
      } catch (err) {
        problemas.push((err as Error).message);
      }
    }
  }
  // endereços antigos (ADR 0058): cada um leva a um só painel e nunca coincide com uma página que continua página
  if (app === 'web') {
    const destinoAntigo = new Map<string, string>();
    const paginaViva = new Map<string, string>();
    const marcar = (caminho: string, destino: string) => {
      const c = caminho.replace(/^\/+/, '');
      const outro = destinoAntigo.get(c);
      if (outro && outro !== destino) problemas.push(`caminho antigo ${c} leva a ${outro} e a ${destino}`);
      destinoAntigo.set(c, destino);
    };
    for (const m of modulos) {
      const id = m.manifesto.id;
      for (const p of m.paginas ?? []) {
        if (p.apps && !p.apps.includes(app)) continue;
        if (transicaoDa(id, p.id, p.grupo ?? 'operacao')?.secao) marcar(p.caminho, `${id}/${p.id}`);
        else paginaViva.set(p.caminho, `${id}/${p.id}`);
      }
      for (const pp of m.paineisParametros ?? []) {
        for (const c of pp.caminhosAntigos ?? []) marcar(c, `${id}/${pp.id}`);
      }
    }
    for (const [c, destino] of destinoAntigo) {
      const pagina = paginaViva.get(c);
      if (pagina) problemas.push(`caminho antigo ${c} (${destino}) é a página ${pagina}`);
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
  /**
   * Itens de menu/aba, em ordem. Web (ADRs 0050 e 0058): grupos pelo `compararGrupoMenu` (alfabético, Parâmetros e
   * Sistema no fim) e itens pelo rótulo (pt-BR, sem acento e caixa), desempate por módulo e id; `ordem` não conta; inclui
   * os itens `bloqueado` dos módulos de vitrine não contratados. Página que virou painel de Parâmetros não entra. App:
   * grupo (posição em `GRUPOS_MENU`), `ordem`, ordem de dependência do módulo, id.
   */
  navegacao: ItemNavegacao<C>[];
  /**
   * ADR 0058 (só web; vazio no app): seções da página Parâmetros, em ordem alfabética do rótulo. Seção sem painel
   * visível some, menos a de módulo de vitrine não contratado, que vem `bloqueado` e sem painéis.
   */
  parametros: SecaoParametrosVisivel<C>[];
  /**
   * ADR 0058: destino em Parâmetros de um endereço antigo (sem barra inicial): `/parametros/<secao>#<modulo>-<id>`, ou null.
   * Vale para os `caminhosAntigos` dos painéis e para as páginas que a transição levou para Parâmetros.
   */
  destinoParametros(caminho: string): string | null;
  /** Página do caminho (sem barra inicial) ou null se não existe, não é permitida, está bloqueada ou foi para Parâmetros (`destinoParametros`). */
  pagina(caminho: string): (PaginaShell<C> & { modulo: ModuloId }) | null;
  /** Permissão por ação já ligada ao usuário. */
  pode(acao: string): boolean;
  /** Itens de um slot de extensão de UI visíveis ao usuário (módulos efetivos, perfil e ação — ADR 0004). */
  extensoes<P = unknown>(slot: string): ItemExtensao<P>[];
}

/** Comparador dos rótulos do menu do BKO (pt-BR, sem diferenciar maiúsculas nem acentos; ADR 0050). */
export const compararRotuloMenu = (a: string, b: string): number => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

function montarVisao<C>(
  app: AppShell,
  modulos: readonly ModuloShell<C>[],
  permissoes: Permissoes,
  extensoes: ReturnType<typeof criarRegistroExtensoes>,
  ctx: Omit<ContextoShell, 'app'>,
): VisaoShell<C> {
  const ativos = ctx.modulosAtivos;
  const pode = (acao: string) => permissoes.pode(acao, { perfil: ctx.perfil, modulosAtivos: ativos, ...(ctx.perfis ? { perfis: ctx.perfis } : {}) });
  const visiveis = new Map<string, PaginaShell<C> & { modulo: ModuloId }>();
  const navegacao: ItemNavegacao<C>[] = [];
  const posicaoModulo = new Map(ativos.map((id, i) => [id, i] as const));
  // Parâmetros (ADR 0058, só web): painéis por seção, com a chave de ordem; destino dos endereços antigos
  const paineis = new Map<SecaoParametros, { painel: PainelParametrosVisivel<C>; ordem: number; pos: number; seq: number }[]>();
  const destinos = new Map<string, string>();
  const secoesBloqueadas = new Set<SecaoParametros>();
  let seq = 0;
  const incluirPainel = (secao: SecaoParametros, ordem: number, painel: PainelParametrosVisivel<C>, antigos: readonly string[]) => {
    const lista = paineis.get(secao) ?? [];
    lista.push({ painel, ordem, pos: posicaoModulo.get(painel.modulo) ?? 0, seq: seq++ });
    paineis.set(secao, lista);
    for (const c of antigos) destinos.set(c.replace(/^\/+/, ''), `/parametros/${secao}#${painel.ancora}`);
  };
  const itemNavegacao = (id: ModuloId, p: PaginaShell<C>, grupoMenu: GrupoMenu, rotulo: string, bloqueado: boolean): ItemNavegacao<C> => ({
    modulo: id,
    id: p.id,
    rotulo,
    caminho: p.caminho,
    icone: p.icone,
    grupo: p.grupo ?? 'operacao',
    grupoMenu,
    rotuloGrupo: ROTULO_GRUPO_MENU[grupoMenu],
    testID: `nav-${id}-${p.id}`,
    ...(bloqueado ? { bloqueado: true } : {}),
    pagina: p,
  });
  for (const m of modulos) {
    const id = m.manifesto.id;
    if (!ctx.perfil) continue;
    if (!ativos.includes(id)) {
      // ADR 0058: módulo de vitrine que a EMPRESA não contratou aparece desativado (só web, só para o perfil que o módulo atende)
      const vitrine = VITRINE_SEM_LICENCA[id];
      const contratado = !ctx.modulosContratados || ctx.modulosContratados.includes(id);
      if (app !== 'web' || !vitrine || contratado || !m.manifesto.perfis.includes(ctx.perfil)) continue;
      secoesBloqueadas.add(vitrine.secao);
      for (const p of m.paginas ?? []) {
        if (!p.navegacao || (p.apps && !p.apps.includes(app)) || (p.perfis && !p.perfis.includes(ctx.perfil))) continue;
        const t = transicaoDa(id, p.id, p.grupo ?? 'operacao');
        if (t?.secao) continue;
        navegacao.push(itemNavegacao(id, p, grupoResolvido(id, p.id, p.grupo ?? 'operacao'), t?.rotulo ?? p.navegacao, true));
      }
      continue;
    }
    // o perfil já entrou no cálculo dos efetivos (RN-CORE-01); `manifesto.perfis` é só o padrão do perfil
    if (app !== 'web' && !m.manifesto.apps[app]) continue;
    const declarados = new Set(app === 'web' ? (m.paineisParametros ?? []).map((pp) => pp.id) : []);
    // endereço da página em transição cujo painel declarado (mesmo id) a substitui: vira caminho antigo do painel
    const antigosDaPagina = new Map<string, string>();
    for (const p of m.paginas ?? []) {
      if (p.apps && !p.apps.includes(app)) continue;
      const grupo = p.grupo ?? 'operacao';
      // a tabela de transição é do menu do BKO: no app os ids coincidem (core/clientes, gestor/alertas…) e a ordem das abas não muda
      const t = app === 'web' ? transicaoDa(id, p.id, grupo) : null;
      // transição (ADR 0058): a página vai para Parâmetros, sai do menu e não abre mais pelo endereço (só `destinoParametros`)
      if (t?.secao && declarados.has(p.id)) {
        antigosDaPagina.set(p.id, p.caminho);
        continue;
      }
      if (p.perfis && !p.perfis.includes(ctx.perfil)) continue;
      if (p.acao && !pode(p.acao)) continue;
      if (t?.secao) {
        const ancora = `${id}-${p.id}`;
        incluirPainel(t.secao, t.ordem ?? 100, { modulo: id, id: p.id, titulo: p.titulo, ancora, testID: `parametros-${ancora}`, origem: 'pagina', componente: p.componente }, [p.caminho]);
        continue;
      }
      visiveis.set(p.caminho, { ...p, modulo: id });
      if (p.navegacao) navegacao.push(itemNavegacao(id, p, app === 'web' ? grupoResolvido(id, p.id, grupo) : semTransicao(grupo), t?.rotulo ?? p.navegacao, false));
    }
    for (const pp of app === 'web' ? (m.paineisParametros ?? []) : []) {
      if (pp.perfis && !pp.perfis.includes(ctx.perfil)) continue;
      if (pp.acao && !pode(pp.acao)) continue;
      const ancora = `${id}-${pp.id}`;
      const antigos = [...(pp.caminhosAntigos ?? []), ...(antigosDaPagina.has(pp.id) ? [antigosDaPagina.get(pp.id) as string] : [])];
      incluirPainel(pp.secao, pp.ordem ?? 100, { modulo: id, id: pp.id, titulo: pp.titulo, ancora, testID: `parametros-${ancora}`, origem: 'painel', componente: pp.componente }, antigos);
    }
  }
  navegacao.sort(
    app === 'web'
      ? (a, b) =>
          compararGrupoMenu({ id: a.grupoMenu, titulo: a.rotuloGrupo }, { id: b.grupoMenu, titulo: b.rotuloGrupo }) ||
          compararRotuloMenu(a.rotulo, b.rotulo) ||
          a.modulo.localeCompare(b.modulo) ||
          a.id.localeCompare(b.id)
      : (a, b) =>
          GRUPOS_MENU.indexOf(a.grupoMenu) - GRUPOS_MENU.indexOf(b.grupoMenu) ||
          (a.pagina.ordem ?? 100) - (b.pagina.ordem ?? 100) ||
          (posicaoModulo.get(a.modulo) ?? 0) - (posicaoModulo.get(b.modulo) ?? 0) ||
          a.id.localeCompare(b.id),
  );
  const parametros: SecaoParametrosVisivel<C>[] = SECOES_PARAMETROS.flatMap((secao) => {
    const lista = paineis.get(secao) ?? [];
    if (lista.length === 0 && !secoesBloqueadas.has(secao)) return [];
    lista.sort((a, b) => a.ordem - b.ordem || a.pos - b.pos || a.seq - b.seq);
    return [{ secao, rotulo: ROTULO_SECAO_PARAMETROS[secao], caminho: `parametros/${secao}`, bloqueado: lista.length === 0, paineis: lista.map((x) => x.painel) }];
  }).sort((a, b) => compararRotuloMenu(a.rotulo, b.rotulo));
  return {
    app,
    perfil: ctx.perfil,
    modulosAtivos: ativos,
    navegacao,
    parametros,
    destinoParametros: (caminho) => destinos.get(caminho.replace(/^\/+/, '')) ?? null,
    pagina: (caminho) => visiveis.get(caminho.replace(/^\/+/, '')) ?? null,
    pode,
    extensoes: <P,>(slot: string) =>
      extensoes.listar(slot, { app, modulosAtivos: ativos, perfil: ctx.perfil ?? undefined, pode }) as ItemExtensao<P>[],
  };
}
