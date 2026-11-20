/**
 * Abas da barra inferior a partir da visão do shell (puro, roda em Node nos testes).
 * "Início" é do shell; as demais vêm das páginas com `navegacao` dos módulos EFETIVOS do usuário
 * (manifesto + licença + perfil + ação; `criarShell().montar`). O shell não inventa aba: sem página no módulo,
 * sem aba (T-0034).
 * Limite de posições por variante (`MAX_ABAS_POR_VARIANTE`: Campo 6 desde a T-0170, Gestão 6 desde a T-0187): quando os módulos efetivos
 * passam disso, no Campo as primeiras abas de módulo ficam na barra e as demais vão para "Mais" (`/mais`); no Gestão
 * (Mc161 A, R-20261119-212852) não há "Mais": a barra fica com as 6 posições e o excedente vai para o menu do Perfil.
 * testID estável: `tab-inicio`, `tab-<modulo>-<id>` (= `nav-<modulo>-<id>` do registro) e `tab-mais`;
 * na tela "Mais" cada item usa `mais-<modulo>-<id>` e, no menu do Perfil, `perfil-<modulo>-<id>`.
 */
import type { ItemNavegacao, ModuloId } from '@macuxi/platform-sdk';
import { NOMES_DE_ICONE, type IconName } from '@macuxi/ui/mobile/puro';

import type { OrigemPilha } from './historico-telas';
import type { Variante } from './variante-tipo';

export interface AbaShell {
  href: string;
  label: string;
  icon: IconName;
  testID: string;
  modulo: ModuloId | null;
}

export interface AbasDoShell {
  /** Abas na barra, em ordem (Início primeiro; "Mais" por último quando houver excedente). */
  barra: AbaShell[];
  /** Abas de módulo que não couberam na barra (listadas na tela "Mais"). Sempre vazio no Gestão. */
  mais: AbaShell[];
  /** Gestão (Mc161 A): abas de módulo que não couberam na barra, listadas no menu do Perfil. Sempre vazio no Campo. */
  perfil: AbaShell[];
}

/** Posições da barra inferior, contando o Início e o "Mais". */
export const MAX_ABAS_BARRA = 5;

/**
 * Posições da barra por variante (T-0170, imagem aprovada `2026-11-12-T0170-final-inicio.png`): o Campo tem 6 (Início, Rota,
 * Clientes, Pedidos, Performance e Mais). T-0187 (P6 A): o Gestão também tem 6 (Início, Equipe, Rota, Aprovações, Clientes e
 * Alertas).
 */
export const MAX_ABAS_POR_VARIANTE: Readonly<Record<Variante, number>> = { campo: 6, gestao: 6 };

/** Para onde vai o excedente da barra: a tela "Mais" (Campo) ou o menu do Perfil (Gestão, Mc161 A, R-20261119-212852). */
export const EXCEDENTE_POR_VARIANTE: Readonly<Record<Variante, 'mais' | 'perfil'>> = { campo: 'mais', gestao: 'perfil' };

/**
 * Páginas (`<modulo>/<id>`) que têm lugar garantido na barra da variante, nesta ordem, à frente das demais (T-0187 P6 A e
 * Mc161 A: Início · Equipe · Rota · Aprovações · Clientes · Alertas). A que não estiver na navegação do usuário (sem licença,
 * perfil ou ação) cede a vaga à próxima página pela `ordem`. O Campo segue só a `ordem` das páginas.
 */
export const PRIORIDADE_DA_BARRA: Readonly<Record<Variante, readonly string[]>> = {
  campo: [],
  gestao: ['gestor/equipe', 'core/rota-gestao', 'gestor/aprovacoes', 'core/clientes', 'gestor/alertas'],
};

export const HREF_MAIS = '/mais';

/** Nomes aceitos vêm do kit (RD-2447): ícone novo no kit vale na aba sem tocar no shell. */
const ICONES: ReadonlySet<string> = new Set<string>(NOMES_DE_ICONE);

const INICIO: AbaShell = { href: '/', label: 'Início', icon: 'home', testID: 'tab-inicio', modulo: null };
const MAIS: AbaShell = { href: HREF_MAIS, label: 'Mais', icon: 'menu', testID: 'tab-mais', modulo: null };

function abaDoItem(n: ItemNavegacao<unknown>): AbaShell {
  return {
    href: `/m/${n.caminho}`,
    label: n.rotulo,
    icon: (n.icone && ICONES.has(n.icone) ? n.icone : 'file') as IconName,
    testID: `tab-${n.modulo}-${n.id}`,
    modulo: n.modulo,
  };
}

/**
 * Barra e excedente da variante. Sem `variante`, o comportamento é o do Campo (excedente no "Mais", só a `ordem`).
 * No Gestão, as páginas de `PRIORIDADE_DA_BARRA` vêm primeiro, na ordem da lista; o excedente vai para `perfil`.
 */
export function abasDoShell(navegacao: readonly ItemNavegacao<unknown>[], max = MAX_ABAS_BARRA, variante: Variante = 'campo'): AbasDoShell {
  const prioridade = PRIORIDADE_DA_BARRA[variante];
  const posicao = (n: ItemNavegacao<unknown>) => {
    const i = prioridade.indexOf(`${n.modulo}/${n.id}`);
    return i < 0 ? prioridade.length : i;
  };
  // sort estável: fora da lista, vale a ordem da navegação do shell (`ordem` das páginas)
  const modulos = [...navegacao].sort((a, b) => posicao(a) - posicao(b)).map(abaDoItem);
  if (modulos.length + 1 <= max) return { barra: [INICIO, ...modulos], mais: [], perfil: [] };
  if (EXCEDENTE_POR_VARIANTE[variante] === 'perfil') {
    const cabem = Math.max(0, max - 1);
    return { barra: [INICIO, ...modulos.slice(0, cabem)], mais: [], perfil: modulos.slice(cabem) };
  }
  const cabem = Math.max(0, max - 2);
  return { barra: [INICIO, ...modulos.slice(0, cabem), MAIS], mais: modulos.slice(cabem), perfil: [] };
}

/** Abas da variante do build, com o limite e o destino do excedente dela (barra, "Mais" e menu do Perfil usam esta). */
export function abasDaVariante(navegacao: readonly ItemNavegacao<unknown>[], variante: Variante): AbasDoShell {
  return abasDoShell(navegacao, MAX_ABAS_POR_VARIANTE[variante], variante);
}

/** A aba está ativa no caminho atual? ("Mais" fica ativo também nas telas que estão dentro dele.) */
export function abaAtiva(aba: AbaShell, atual: string, mais: readonly AbaShell[]): boolean {
  const casa = (href: string) => atual === href || atual.startsWith(`${href}/`);
  if (aba.href === '/') return atual === '/';
  if (aba.href === HREF_MAIS) return casa(HREF_MAIS) || mais.some((m) => casa(m.href));
  return casa(aba.href);
}

/** Dona da pilha das telas de módulo (lib/historico-telas.ts): a aba e de onde a pilha foi aberta. */
export interface DonoDaPilha {
  aba: string | null;
  origem: OrigemPilha;
}

/**
 * Aba acesa na barra (T-0072, R-20261105-125027; docs/design/componentes.md §6.1 "Aba acesa = aba dona da pilha").
 * Fora das telas de módulo, pelo caminho (Início em `/`, "Mais" em `/mais`). Numa tela de módulo, pela dona da pilha,
 * não pelo caminho (o detalhe `/m/pedido` é da pilha de Pedidos): (1) aba da barra, ela acende; (2) item do "Mais",
 * acende o "Mais"; (3) pilha aberta de fora cuja raiz não é aba (ex.: cartão do Início que abre `/m/pedido`), acende a
 * tela de origem, para onde o voltar leva (o Início; o "Mais" se a pilha veio dele). Sem dona conhecida, pelo caminho.
 */
export function abaAcesa(abas: AbasDoShell, atual: string, dono: DonoDaPilha): AbaShell | null {
  const porCaminho = () => abas.barra.find((a) => abaAtiva(a, atual, abas.mais)) ?? null;
  if (!atual.startsWith('/m/') || dono.aba === null) return porCaminho();
  const naBarra = abas.barra.find((a) => a.href === dono.aba);
  if (naBarra) return naBarra;
  const mais = abas.barra.find((a) => a.href === HREF_MAIS) ?? null;
  if (mais && (dono.origem === 'mais' || abas.mais.some((a) => a.href === dono.aba))) return mais;
  return abas.barra.find((a) => a.href === INICIO.href) ?? null;
}
