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
import { ordenarPorDependencia, problemasDasConsultas } from './manifesto';
import { criarPermissoes } from './permissoes';
import { criarRegistroSync } from './sync';
import { criarRegistroExtensoes } from './extensoes';
import { validarMigracoes } from './sqlite/esquema';
import { criarRegistroConsultasAparelho } from './consultas';
/** Link interno do app: `/m/<caminho>` com caminho em minúsculas, dígitos e hífen (convenção de `PaginaShell.caminho`). */
const LINK_INTERNO = /^\/m\/[a-z0-9-]+/;
/**
 * Caminho da tela de um link interno do app (`/m/rota?x=1#y` → `rota`; `/m/pedidos/novo` → `pedidos/novo`);
 * null fora do padrão `/m/<caminho>`. Fonte única da regra (RD-0032): Início do shell e central de notificações do Core.
 */
export function caminhoDoLinkInterno(link) {
    if (!link || !LINK_INTERNO.test(link))
        return null;
    return link.slice(3).split(/[?#]/)[0] ?? null;
}
/**
 * O próprio link, se for interno (`/m/<caminho>`) e, com `telaExiste` (a `visao.pagina` do shell), a tela existir na
 * visão do usuário; senão null. Quem chama decide o destino do null (ex.: a central de notificações).
 */
export function linkInternoNavegavel(link, telaExiste) {
    const caminho = caminhoDoLinkInterno(link);
    if (!link || !caminho)
        return null;
    return !telaExiste || telaExiste(caminho) ? link : null;
}
/**
 * Grupos do menu do BKO (ADR 0050, revista pela ADR 0060; spec docs/design/menu-parametros/spec.md §2). O menu mostra
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
];
export const ROTULO_GRUPO_MENU = {
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
/** ADR 0060 (D1): grupos fora da ordem alfabética, no fim do menu, nesta ordem (Parâmetros logo acima de Sistema). */
export const GRUPOS_FIXOS_NO_FIM = ['parametros', 'sistema'];
/**
 * Comparador dos grupos do menu do BKO (ADR 0060): alfabético pelo título (`compararRotuloMenu`), com os
 * `GRUPOS_FIXOS_NO_FIM` depois de todos. Aceita grupos do shell fora do SDK (ex.: "Mais").
 */
export function compararGrupoMenu(a, b) {
    const fa = GRUPOS_FIXOS_NO_FIM.indexOf(a.id);
    const fb = GRUPOS_FIXOS_NO_FIM.indexOf(b.id);
    if (fa !== fb)
        return fa === -1 ? -1 : fb === -1 ? 1 : fa - fb;
    return compararRotuloMenu(a.titulo, b.titulo) || a.id.localeCompare(b.id);
}
/**
 * Seções da página Parâmetros do BKO (ADR 0060; `/parametros/<secao>`). A lista é fixa: seção nova entra aqui, com ADR.
 * Cada seção empilha os painéis (`PainelParametros`) que os módulos declaram para ela.
 */
export const SECOES_PARAMETROS = [
    'acesso',
    'alertas',
    'calendario',
    'clientes',
    'inicio',
    'integracao',
    'metas-e-rv',
    'pedidos',
    'pesquisa',
    'produtos',
    'trade',
    'treinamento',
    'visitas',
];
export const ROTULO_SECAO_PARAMETROS = {
    acesso: 'Acesso',
    alertas: 'Alertas',
    calendario: 'Calendário',
    clientes: 'Clientes',
    inicio: 'Início',
    integracao: 'Integração',
    'metas-e-rv': 'Metas e RV',
    pedidos: 'Pedidos',
    pesquisa: 'Pesquisa',
    produtos: 'Produtos',
    trade: 'Trade',
    treinamento: 'Treinamento',
    visitas: 'Visitas',
};
/**
 * ADR 0060 (R-20261115-113500): módulos "de vitrine". Sem a licença da EMPRESA (`ContextoShell.modulosContratados`),
 * as páginas com menu deles aparecem desativadas (`bloqueado`) e a seção de Parâmetros deles aparece com cadeado.
 * Os demais módulos somem sem licença, como antes (RN-CORE-01/03). Módulo novo nesta lista: com ADR.
 */
export const VITRINE_SEM_LICENCA = {
    pesquisa: { grupo: 'pesquisa', secao: 'pesquisa' },
    promotor: { grupo: 'trade', secao: 'trade' },
    treinamento: { grupo: 'treinamento', secao: 'treinamento' },
};
/**
 * Transição das ADRs 0050 e 0060: `<modulo>/<idDaPagina>` → grupo (ou seção de Parâmetros) do menu final. Só vale
 * enquanto a página declarar um dos grupos de `de`; quando o módulo declara o grupo final (ou tira a página e declara o
 * painel), a linha deixa de valer sozinha e sai no fim da transição (junto com 'administracao', 'comercial' e
 * 'conteudo_campo').
 */
const TRANSICAO_GRUPO = {
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
function transicaoDa(modulo, id, declarado) {
    const t = TRANSICAO_GRUPO[`${modulo}/${id}`];
    return t && t.de.includes(declarado) ? t : null;
}
/**
 * Grupo do menu do BKO da página (ADR 0050/0060): o declarado (padrão 'operacao'), passado pela tabela de transição
 * enquanto a página declarar o grupo de antes; fora da tabela, 'administracao' cai em 'sistema' e 'comercial' e
 * 'conteudo_campo' em 'cadastros'. Página que a transição leva para Parâmetros devolve 'parametros' (não vira item).
 */
export function grupoDoMenu(modulo, pagina) {
    return grupoResolvido(modulo, pagina.id, pagina.grupo ?? 'operacao');
}
function grupoResolvido(modulo, id, declarado) {
    const t = transicaoDa(modulo, id, declarado);
    if (t)
        return t.para ?? 'parametros';
    return semTransicao(declarado);
}
function semTransicao(declarado) {
    if (declarado === 'administracao')
        return 'sistema';
    if (declarado === 'comercial' || declarado === 'conteudo_campo')
        return 'cadastros';
    return declarado;
}
/** Ajuda de tipo para `modules/<m>/{web,app}/index.ts`. */
export function definirModuloShell(m) {
    const ids = new Set();
    for (const p of m.paginas ?? []) {
        if (ids.has(p.id))
            throw new Error(`Página ${m.manifesto.id}/${p.id} repetida`);
        ids.add(p.id);
        if (p.caminho.startsWith('/'))
            throw new Error(`Caminho sem barra inicial: ${p.caminho}`);
    }
    return m;
}
/** Painel visível com a âncora `<modulo>-<id>` e o testID `parametros-<modulo>-<id>` (ADR 0060). */
function painelVisivel(modulo, id, titulo, origem, componente) {
    const ancora = `${modulo}-${id}`;
    return { modulo, id, titulo, ancora, testID: `parametros-${ancora}`, origem, componente };
}
/** Caminho sem as barras do começo (`/perfis` = `perfis`). */
const semBarra = (caminho) => caminho.replace(/^\/+/, '');
/**
 * Valida o conjunto (manifestos coerentes, rótulos declarados, caminhos únicos, entidades no manifesto)
 * e devolve uma função que monta a visão do usuário. Erros de montagem estouram no início do shell.
 */
export function criarShell(app, modulos) {
    const manifestos = modulos.map((m) => m.manifesto);
    const permissoes = criarPermissoes(manifestos);
    const registroSync = criarRegistroSync(manifestos);
    const problemas = [];
    // dependências obrigatórias instaladas e sem ciclo (extensões usadas podem faltar: somem sem erro, RN-CORE-03)
    const ids = new Set(manifestos.map((m) => m.id));
    for (const m of manifestos)
        for (const d of m.depende)
            if (!ids.has(d))
                problemas.push(`${m.id} depende de ${d}, que não está instalado`);
    try {
        ordenarPorDependencia(manifestos);
    }
    catch (e) {
        problemas.push(e.message);
    }
    const caminhos = new Map();
    for (const m of modulos) {
        const declarados = app === 'web' ? (m.manifesto.apps.web?.menus ?? []) : (m.manifesto.apps[app]?.abas ?? []);
        for (const p of m.paginas ?? []) {
            if (p.apps && !p.apps.includes(app))
                continue;
            const dono = caminhos.get(p.caminho);
            if (dono)
                problemas.push(`caminho ${p.caminho} usado por ${dono} e por ${m.manifesto.id}`);
            caminhos.set(p.caminho, m.manifesto.id);
            if (p.navegacao && !declarados.includes(p.navegacao)) {
                problemas.push(`${m.manifesto.id}/${p.id}: "${p.navegacao}" não está em apps.${app}.${app === 'web' ? 'menus' : 'abas'} do manifesto`);
            }
            if (p.acao && !permissoes.conhece(p.acao))
                problemas.push(`${m.manifesto.id}/${p.id}: ação ${p.acao} não declarada em nenhum manifesto`);
        }
        // painéis de Parâmetros (ADR 0060): só no BKO; id único no módulo, seção da lista fixa, ação conhecida
        const paineis = new Set();
        for (const pp of app === 'web' ? (m.paineisParametros ?? []) : []) {
            const nome = `${m.manifesto.id}/${pp.id}`;
            if (paineis.has(pp.id))
                problemas.push(`painel de parâmetros ${nome} repetido`);
            paineis.add(pp.id);
            if (!SECOES_PARAMETROS.includes(pp.secao))
                problemas.push(`${nome}: seção ${pp.secao} fora de SECOES_PARAMETROS`);
            if (pp.acao && !permissoes.conhece(pp.acao))
                problemas.push(`${nome}: ação ${pp.acao} não declarada em nenhum manifesto`);
            for (const c of pp.caminhosAntigos ?? [])
                if (c.startsWith('/'))
                    problemas.push(`${nome}: caminho antigo sem barra inicial: ${c}`);
        }
        for (const e of m.entidadesSync ?? []) {
            try {
                registroSync.registrar(e);
            }
            catch (err) {
                problemas.push(err.message);
            }
        }
    }
    // endereços antigos (ADR 0060): cada um leva a um só painel e nunca coincide com uma página que continua página
    if (app === 'web') {
        const destinoAntigo = new Map();
        const paginaViva = new Map();
        const marcar = (caminho, destino) => {
            const c = semBarra(caminho);
            const outro = destinoAntigo.get(c);
            if (outro && outro !== destino)
                problemas.push(`caminho antigo ${c} leva a ${outro} e a ${destino}`);
            destinoAntigo.set(c, destino);
        };
        for (const m of modulos) {
            const id = m.manifesto.id;
            for (const p of m.paginas ?? []) {
                if (p.apps && !p.apps.includes(app))
                    continue;
                if (transicaoDa(id, p.id, p.grupo ?? 'operacao')?.secao)
                    marcar(p.caminho, `${id}/${p.id}`);
                else
                    paginaViva.set(p.caminho, `${id}/${p.id}`);
            }
            for (const pp of m.paineisParametros ?? []) {
                for (const c of pp.caminhosAntigos ?? [])
                    marcar(c, `${id}/${pp.id}`);
            }
        }
        for (const [c, destino] of destinoAntigo) {
            const pagina = paginaViva.get(c);
            if (pagina)
                problemas.push(`caminho antigo ${c} (${destino}) é a página ${pagina}`);
        }
    }
    // extensões de UI: slots declarados pelos donos (`ofereceExtensoes`); item de slot sem dono instalado some sem erro (RN-CORE-03)
    const extensoes = criarRegistroExtensoes();
    for (const m of manifestos)
        for (const slot of m.ofereceExtensoes)
            extensoes.declararSlot(slot, m.id);
    for (const m of modulos) {
        for (const item of m.extensoes ?? []) {
            const { slot, ...resto } = item;
            if (!m.manifesto.usaExtensoes.includes(slot) && !m.manifesto.ofereceExtensoes.includes(slot)) {
                problemas.push(`${m.manifesto.id}/${item.id}: slot ${slot} não está em usaExtensoes do manifesto`);
                continue;
            }
            if (item.acao && !permissoes.conhece(item.acao))
                problemas.push(`${m.manifesto.id}/${item.id}: ação ${item.acao} não declarada em nenhum manifesto`);
            if (!extensoes.donoDoSlot(slot))
                continue;
            // E4 (T-0029): item de outro app nem entra no registro desta variante
            if (item.apps && !item.apps.includes(app))
                continue;
            extensoes.registrar(slot, { ...resto, modulo: m.manifesto.id });
        }
    }
    // armazenamento local (T-0008 §1.4 e §2.1): migrações do próprio módulo; índice só sobre fontes do módulo ou de `depende`
    const migracoesAparelho = {};
    const indicesBusca = [];
    for (const m of modulos) {
        const id = m.manifesto.id;
        if (m.migracoesAparelho?.length) {
            try {
                validarMigracoes(id, m.migracoesAparelho);
                migracoesAparelho[id] = m.migracoesAparelho;
            }
            catch (err) {
                problemas.push(err.message);
            }
        }
        for (const i of m.indicesBusca ?? []) {
            if (i.modulo !== id)
                problemas.push(`${id}: índice ${i.id} declarado como de ${i.modulo}`);
            if (indicesBusca.some((x) => x.id === i.id))
                problemas.push(`índice de busca ${i.id} repetido`);
            if (!m.migracoesAparelho?.length)
                problemas.push(`${id}: índice ${i.id} sem migracoesAparelho (as tabelas não existiriam)`);
            for (const f of i.fontes) {
                const def = registroSync.entidade(f);
                if (!def)
                    problemas.push(`${id}: fonte ${f} do índice ${i.id} não está registrada`);
                else if (def.direcao === 'push')
                    problemas.push(`${id}: fonte ${f} do índice ${i.id} não tem pull`);
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
    if (problemas.length > 0)
        throw new Error(`Shell ${app} inconsistente: ${problemas.join('; ')}`);
    const etapas = modulos.flatMap((m) => m.etapasSync ?? []);
    return {
        app,
        manifestos,
        permissoes,
        registroSync,
        etapasSync: etapas,
        /** Para o adaptador SQLite do aparelho (`criarArmazenamentoSqlite`). */
        migracoesAparelho,
        indicesBusca: indicesBusca,
        /** Para o motor do aparelho (`criarMotorSync({ consultas })`): executa `ambiente.consultar`. */
        consultas: consultas.registro,
        /** Visão do usuário: só módulos efetivos, desta variante, do perfil e com permissão. */
        montar(ctx) {
            return montarVisao(app, modulos, permissoes, extensoes, ctx);
        },
    };
}
/** Comparador dos rótulos do menu do BKO (pt-BR, sem diferenciar maiúsculas nem acentos; ADR 0050). */
export const compararRotuloMenu = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
function montarVisao(app, modulos, permissoes, extensoes, ctx) {
    const ativos = ctx.modulosAtivos;
    const pode = (acao) => permissoes.pode(acao, { perfil: ctx.perfil, modulosAtivos: ativos, ...(ctx.perfis ? { perfis: ctx.perfis } : {}) });
    const visiveis = new Map();
    const navegacao = [];
    const posicaoModulo = new Map(ativos.map((id, i) => [id, i]));
    // Parâmetros (ADR 0060, só web): painéis por seção, com a chave de ordem; destino dos endereços antigos
    const paineis = new Map();
    const destinos = new Map();
    const secoesBloqueadas = new Set();
    let seq = 0;
    const incluirPainel = (secao, ordem, painel, antigos) => {
        const lista = paineis.get(secao) ?? [];
        lista.push({ painel, ordem, pos: posicaoModulo.get(painel.modulo) ?? 0, seq: seq++ });
        paineis.set(secao, lista);
        for (const c of antigos)
            destinos.set(semBarra(c), `/parametros/${secao}#${painel.ancora}`);
    };
    const itemNavegacao = (id, p, grupoMenu, rotulo, bloqueado) => ({
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
        if (!ctx.perfil)
            continue;
        if (!ativos.includes(id)) {
            // ADR 0060: módulo de vitrine que a EMPRESA não contratou aparece desativado (só web, só para o perfil que o módulo atende)
            const vitrine = VITRINE_SEM_LICENCA[id];
            const contratado = !ctx.modulosContratados || ctx.modulosContratados.includes(id);
            if (app !== 'web' || !vitrine || contratado || !m.manifesto.perfis.includes(ctx.perfil))
                continue;
            secoesBloqueadas.add(vitrine.secao);
            for (const p of m.paginas ?? []) {
                if (!p.navegacao || (p.apps && !p.apps.includes(app)) || (p.perfis && !p.perfis.includes(ctx.perfil)))
                    continue;
                const t = transicaoDa(id, p.id, p.grupo ?? 'operacao');
                if (t?.secao)
                    continue;
                navegacao.push(itemNavegacao(id, p, grupoResolvido(id, p.id, p.grupo ?? 'operacao'), t?.rotulo ?? p.navegacao, true));
            }
            continue;
        }
        // o perfil já entrou no cálculo dos efetivos (RN-CORE-01); `manifesto.perfis` é só o padrão do perfil
        if (app !== 'web' && !m.manifesto.apps[app])
            continue;
        const declarados = new Set(app === 'web' ? (m.paineisParametros ?? []).map((pp) => pp.id) : []);
        // endereço da página em transição cujo painel declarado (mesmo id) a substitui: vira caminho antigo do painel
        const antigosDaPagina = new Map();
        for (const p of m.paginas ?? []) {
            if (p.apps && !p.apps.includes(app))
                continue;
            const grupo = p.grupo ?? 'operacao';
            // a tabela de transição é do menu do BKO: no app os ids coincidem (core/clientes, gestor/alertas…) e a ordem das abas não muda
            const t = app === 'web' ? transicaoDa(id, p.id, grupo) : null;
            // transição (ADR 0060): a página vai para Parâmetros, sai do menu e não abre mais pelo endereço (só `destinoParametros`)
            if (t?.secao && declarados.has(p.id)) {
                antigosDaPagina.set(p.id, p.caminho);
                continue;
            }
            if (p.perfis && !p.perfis.includes(ctx.perfil))
                continue;
            if (p.acao && !pode(p.acao))
                continue;
            if (t?.secao) {
                incluirPainel(t.secao, t.ordem ?? 100, painelVisivel(id, p.id, p.titulo, 'pagina', p.componente), [p.caminho]);
                continue;
            }
            visiveis.set(p.caminho, { ...p, modulo: id });
            if (p.navegacao)
                navegacao.push(itemNavegacao(id, p, app === 'web' ? grupoResolvido(id, p.id, grupo) : semTransicao(grupo), t?.rotulo ?? p.navegacao, false));
        }
        for (const pp of app === 'web' ? (m.paineisParametros ?? []) : []) {
            if (pp.perfis && !pp.perfis.includes(ctx.perfil))
                continue;
            if (pp.acao && !pode(pp.acao))
                continue;
            const antigos = [...(pp.caminhosAntigos ?? []), ...(antigosDaPagina.has(pp.id) ? [antigosDaPagina.get(pp.id)] : [])];
            incluirPainel(pp.secao, pp.ordem ?? 100, painelVisivel(id, pp.id, pp.titulo, 'painel', pp.componente), antigos);
        }
    }
    navegacao.sort(app === 'web'
        ? (a, b) => compararGrupoMenu({ id: a.grupoMenu, titulo: a.rotuloGrupo }, { id: b.grupoMenu, titulo: b.rotuloGrupo }) ||
            compararRotuloMenu(a.rotulo, b.rotulo) ||
            a.modulo.localeCompare(b.modulo) ||
            a.id.localeCompare(b.id)
        : (a, b) => GRUPOS_MENU.indexOf(a.grupoMenu) - GRUPOS_MENU.indexOf(b.grupoMenu) ||
            (a.pagina.ordem ?? 100) - (b.pagina.ordem ?? 100) ||
            (posicaoModulo.get(a.modulo) ?? 0) - (posicaoModulo.get(b.modulo) ?? 0) ||
            a.id.localeCompare(b.id));
    const parametros = SECOES_PARAMETROS.flatMap((secao) => {
        const lista = paineis.get(secao) ?? [];
        if (lista.length === 0 && !secoesBloqueadas.has(secao))
            return [];
        lista.sort((a, b) => a.ordem - b.ordem || a.pos - b.pos || a.seq - b.seq);
        return [{ secao, rotulo: ROTULO_SECAO_PARAMETROS[secao], caminho: `parametros/${secao}`, bloqueado: lista.length === 0, paineis: lista.map((x) => x.painel) }];
    }).sort((a, b) => compararRotuloMenu(a.rotulo, b.rotulo));
    return {
        app,
        perfil: ctx.perfil,
        modulosAtivos: ativos,
        navegacao,
        parametros,
        destinoParametros: (caminho) => destinos.get(semBarra(caminho)) ?? null,
        pagina: (caminho) => visiveis.get(semBarra(caminho)) ?? null,
        pode,
        extensoes: (slot) => extensoes.listar(slot, { app, modulosAtivos: ativos, perfil: ctx.perfil ?? undefined, pode }),
    };
}
