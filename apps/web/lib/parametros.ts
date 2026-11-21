/**
 * Página Parâmetros do BKO (ADR 0060; spec docs/design/menu-parametros/spec.md §2–§3): funções puras do shell.
 * As seções vêm de `visao.parametros` (painéis dos módulos e páginas que a transição do SDK levou para Parâmetros). Página
 * de módulo que ainda declara `grupo: 'parametros'` com o caminho `parametros/<secao>` (o de-para da Integração) entra
 * como painel `origem: 'pagina'` da seção dela, até o módulo declarar o `PainelParametros`; assim ela sai do menu e o
 * endereço continua o mesmo.
 */
import {
  compararRotuloMenu,
  ROTULO_SECAO_PARAMETROS,
  SECOES_PARAMETROS,
  type ItemNavegacao,
  type SecaoParametros,
  type SecaoParametrosVisivel,
} from '@macuxi/platform-sdk';

/** Seção da página Parâmetros servida pelo endereço `parametros/<secao>` (com ou sem barra inicial), ou null. */
export function secaoDoCaminho(caminho: string): SecaoParametros | null {
  const m = /^\/*parametros\/([^/?#]+)\/?$/.exec(caminho);
  const s = m?.[1];
  return s && (SECOES_PARAMETROS as readonly string[]).includes(s) ? (s as SecaoParametros) : null;
}

/** Seção de Parâmetros de uma página de módulo (grupo 'parametros' em `parametros/<secao>`), ou null: ela não vira item do menu. */
export const secaoDaPagina = (n: Pick<ItemNavegacao<unknown>, 'grupoMenu' | 'caminho'>): SecaoParametros | null =>
  n.grupoMenu === 'parametros' ? secaoDoCaminho(n.caminho) : null;

/** O endereço é da página Parâmetros (`/parametros` ou `/parametros/...`): nunca é endereço antigo a redirecionar. */
export const ehRotaParametros = (pathname: string): boolean => pathname === '/parametros' || pathname.startsWith('/parametros/');

/** Seções da página, em ordem alfabética do rótulo: `visao.parametros` e as páginas de módulo em `parametros/<secao>`. */
export function secoesParametros<C>(visao: {
  parametros: readonly SecaoParametrosVisivel<C>[];
  navegacao: readonly Pick<ItemNavegacao<C>, 'modulo' | 'id' | 'caminho' | 'grupoMenu' | 'bloqueado' | 'pagina'>[];
}): SecaoParametrosVisivel<C>[] {
  const secoes = new Map<SecaoParametros, SecaoParametrosVisivel<C>>(visao.parametros.map((s) => [s.secao, { ...s, paineis: [...s.paineis] }]));
  for (const n of visao.navegacao) {
    const secao = n.bloqueado ? null : secaoDaPagina(n);
    if (!secao) continue;
    const ancora = `${n.modulo}-${n.id}`;
    const painel = { modulo: n.modulo, id: n.id, titulo: n.pagina.titulo, ancora, testID: `parametros-${ancora}`, origem: 'pagina' as const, componente: n.pagina.componente };
    const atual = secoes.get(secao);
    if (atual) secoes.set(secao, { ...atual, bloqueado: false, paineis: [...atual.paineis, painel] });
    else secoes.set(secao, { secao, rotulo: ROTULO_SECAO_PARAMETROS[secao], caminho: `parametros/${secao}`, bloqueado: false, paineis: [painel] });
  }
  return [...secoes.values()].sort((a, b) => compararRotuloMenu(a.rotulo, b.rotulo));
}

/** Seção que `/parametros` abre: a primeira não bloqueada; todas bloqueadas, a primeira; sem seção, null. */
export function secaoInicialParametros<C>(secoes: readonly SecaoParametrosVisivel<C>[]): SecaoParametrosVisivel<C> | null {
  return secoes.find((s) => !s.bloqueado) ?? secoes[0] ?? null;
}
