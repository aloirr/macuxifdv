/**
 * T-0111 (ADR 0033, RN-CORE-35): textos e montagem da página "Perfis de acesso" do BKO e do campo "Perfis" do formulário de
 * usuário. Puro (roda em Node nos testes). Spec: docs/design/perfis-de-acesso.md.
 *
 * A REGRA (o que pode, o que está travado, o que a empresa deixaria de ter) é do SDK e do domain do Core: `travaDaChave`,
 * `validarPerfil`, `validarAcessoDoTenant`. Aqui só há texto e arrumação do que a tela já decidiu. A mensagem do cadeado das
 * travas do SDK (RN-CORE-33, RN-PRO-01) é a `mensagem` do próprio `travaDaChave`; as daqui cobrem as travas que a tela mostra e
 * que não são de uma chave (Core sempre ligado, escopo acima da base, autogestão, alvo admin, base imutável, perfil padrão).
 */
import { ORDEM_PERFIL_PADRAO, ROTULO_PERFIL_CURTO, type PerfilPadrao } from '../comum/perfis';

export * from '../comum/perfis';

/**
 * Rótulo de cada perfil base (o código de fábrica é o próprio perfil base). RD-0014: é o nome CURTO fixado em
 * `../comum/perfis` (o mesmo do login, do portal e do app); aqui só o apelido que a página Perfis e a tela Usuários já usam.
 */
export const ROTULO_PERFIL_BASE = ROTULO_PERFIL_CURTO;

/** Ordem dos perfis base no seletor "Perfil base" e na lista (os padrão primeiro, nesta ordem). */
export const ORDEM_PERFIL_BASE: readonly PerfilPadrao[] = ORDEM_PERFIL_PADRAO;

/** As 12 seções da edição, na ordem aprovada (R-20261107-195349), e o bloco final "Outras permissões". */
export const SECOES_DO_PERFIL = [
  { id: 'identificacao', titulo: 'Identificação' },
  { id: 'onde-entra', titulo: 'Onde entra' },
  { id: 'escopo', titulo: 'Escopo de dados' },
  { id: 'modulos', titulo: 'Módulos' },
  { id: 'usuarios', titulo: 'Usuários e senhas' },
  { id: 'clientes', titulo: 'Clientes' },
  { id: 'pedidos', titulo: 'Pedidos' },
  { id: 'catalogo', titulo: 'Catálogo' },
  { id: 'trade', titulo: 'Trade (Promotor)' },
  { id: 'pesquisa-treinamento', titulo: 'Pesquisa e Treinamento' },
  { id: 'metas', titulo: 'Metas e remuneração' },
  { id: 'integracao', titulo: 'Integração (BKO)' },
  { id: 'outras', titulo: 'Outras permissões' },
] as const;
export type SecaoDoPerfil = (typeof SECOES_DO_PERFIL)[number]['id'];

/**
 * Textos dos cadeados que não vêm do `travaDaChave` do SDK. Sem código interno (RN-, RF-, T-, ADR, RD-) no texto visível
 * (R-20261124-094002): a regra fica só neste comentário. escopoAcimaDaBase: RN-CORE-04; autogestao, senhaDeAdmin,
 * baseImutavel e padraoNaoDesativa: RN-CORE-35; senhaSempreComRegra: RN-CORE-32.
 */
export const CADEADO = {
  coreSempreLigado: 'O Core é a base do sistema e fica sempre ligado.',
  escopoAcimaDaBase: (base: PerfilPadrao) => `Acima do perfil base ${ROTULO_PERFIL_BASE[base]}.`,
  autogestao: 'Você não pode tirar isto de si mesmo. Peça a outro admin.',
  senhaDeAdmin: 'A senha de um admin não é redefinida por aqui.',
  baseImutavel: 'O perfil base não muda depois de criado.',
  padraoNaoDesativa: 'Os perfis padrão não são apagados nem desativados.',
  senhaSempreComRegra: 'Toda senha segue a regra de segurança.',
} as const;

/** Rótulo falado do botão do cadeado (o texto da regra vai na descrição). */
export const ROTULO_CADEADO = 'Travado';

/** Texto do interruptor (cor nunca sozinha). */
export const TEXTO_INTERRUPTOR = { sim: 'Sim', nao: 'Não', misto: 'Em parte', desligada: 'Desligada' } as const;

/** Opção "todos" da lista de perfis-alvo da redefinição de senha (valor `*` do motor). */
export const ALVO_TODOS_PERFIS = '*';
export const ROTULO_ALVO_TODOS = 'Todos os perfis, menos admin (inclusive os criados depois)';

/**
 * Resumo curto dos perfis-alvo da redefinição de senha, para a lista, o resumo "o que mudou" e a auditoria.
 * `rotulos` = código → nome do perfil no tenant (os que não estiverem lá aparecem pelo código).
 */
export function resumoDosAlvos(alvos: readonly string[] | null | undefined, rotulos: Readonly<Record<string, string>>): string {
  if (!alvos || alvos.length === 0) return 'Nenhum perfil';
  if (alvos.includes(ALVO_TODOS_PERFIS)) return 'Todos, menos admin';
  return alvos.map((c) => rotulos[c] ?? c).join(', ');
}

/** Marca ou desmarca `valor` numa seleção múltipla, sem repetir e mantendo a ordem de `ordem` (a ordem das opções na tela). */
export function alternarMarcado(marcados: readonly string[], valor: string, ordem: readonly string[]): string[] {
  const set = new Set(marcados);
  if (set.has(valor)) set.delete(valor);
  else set.add(valor);
  if (valor === ALVO_TODOS_PERFIS && set.has(ALVO_TODOS_PERFIS)) return [ALVO_TODOS_PERFIS];
  const pos = (v: string) => (ordem.indexOf(v) < 0 ? Number.MAX_SAFE_INTEGER : ordem.indexOf(v));
  return [...set].sort((a, b) => pos(a) - pos(b));
}

// ---------------------------------------------------------------- resumo "o que mudou"

/** Uma linha do resumo antes de salvar e do histórico: a tela monta `antes` e `depois` já em texto ("Equipe", "Não"). */
export interface MudancaDePermissao {
  secao: SecaoDoPerfil;
  /** Rótulo da linha como aparece na seção ("Cancelar pedido"). */
  rotulo: string;
  antes: string;
  depois: string;
}

/** Contagem do rodapé fixo da edição: "Nenhuma mudança" ou "3 mudanças não salvas". */
export function contagemNaoSalva(n: number): string {
  if (n <= 0) return 'Nenhuma mudança';
  return n === 1 ? '1 mudança não salva' : `${n} mudanças não salvas`;
}
