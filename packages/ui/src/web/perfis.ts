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

/** Título da página e do item de menu (Administração). */
export const TITULO_PERFIS = 'Perfis de acesso';

/** Selo dos perfis de fábrica na lista e no cabeçalho da edição. */
export const SELO_PADRAO = 'Padrão';

/**
 * Rótulo de cada perfil base (o código de fábrica é o próprio perfil base). RD-0014: é o nome CURTO fixado em
 * `../comum/perfis` (o mesmo do login, do portal e do app); aqui só o apelido que a página Perfis e a tela Usuários já usam.
 */
export const ROTULO_PERFIL_BASE = ROTULO_PERFIL_CURTO;
export type PerfilBase = PerfilPadrao;

/** Ordem dos perfis base no seletor "Perfil base" e na lista (os padrão primeiro, nesta ordem). */
export const ORDEM_PERFIL_BASE: readonly PerfilBase[] = ORDEM_PERFIL_PADRAO;

/** Onde a pessoa entra: chips da lista, caixas da seção "Onde entra" e prévia do formulário de usuário. */
export const ROTULO_LUGAR = { campo: 'Campo', gestao: 'Gestão', bko: 'BKO', portal: 'Portal' } as const;
export type LugarDoPerfil = keyof typeof ROTULO_LUGAR;
export const ORDEM_LUGAR: readonly LugarDoPerfil[] = ['campo', 'gestao', 'bko', 'portal'];

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

export const tituloDaSecao = (id: SecaoDoPerfil): string => SECOES_DO_PERFIL.find((s) => s.id === id)?.titulo ?? id;

/**
 * Textos dos cadeados que não vêm do `travaDaChave` do SDK. Sempre com a regra entre parênteses, como o do SDK
 * ("Vendedor nunca entra no BKO (RN-CORE-33).").
 */
export const CADEADO = {
  coreSempreLigado: 'O Core é a base do sistema e fica sempre ligado.',
  escopoAcimaDaBase: (base: PerfilBase) => `Acima do perfil base ${ROTULO_PERFIL_BASE[base]} (RN-CORE-04).`,
  autogestao: 'Você não pode tirar isto de si mesmo. Peça a outro admin (RN-CORE-35).',
  senhaDeAdmin: 'A senha de um admin não é redefinida por aqui (RN-CORE-35).',
  baseImutavel: 'O perfil base não muda depois de criado (RN-CORE-35).',
  padraoNaoDesativa: 'Os perfis padrão não são apagados nem desativados (RN-CORE-35).',
  senhaSempreComRegra: 'Toda senha segue a regra de segurança (RN-CORE-32).',
} as const;

/** Rótulo falado do botão do cadeado (o texto da regra vai na descrição). */
export const ROTULO_CADEADO = 'Travado';

/** Texto do interruptor (cor nunca sozinha). */
export const TEXTO_INTERRUPTOR = { sim: 'Sim', nao: 'Não', misto: 'Em parte' } as const;

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

export interface GrupoDeMudancas {
  secao: SecaoDoPerfil;
  titulo: string;
  itens: MudancaDePermissao[];
}

/** Tira as linhas sem mudança e agrupa por seção, na ordem das seções da página (e na ordem de chegada dentro de cada uma). */
export function agruparMudancas(mudancas: readonly MudancaDePermissao[]): GrupoDeMudancas[] {
  const validas = mudancas.filter((m) => m.antes !== m.depois);
  return SECOES_DO_PERFIL.map((s) => ({ secao: s.id, titulo: s.titulo, itens: validas.filter((m) => m.secao === s.id) })).filter((g) => g.itens.length > 0);
}

/** "Nenhuma mudança", "1 mudança", "3 mudanças". */
export function contagemDeMudancas(n: number): string {
  if (n <= 0) return 'Nenhuma mudança';
  return n === 1 ? '1 mudança' : `${n} mudanças`;
}

/** Contagem do rodapé fixo da edição: "Nenhuma mudança" ou "3 mudanças não salvas". */
export function contagemNaoSalva(n: number): string {
  if (n <= 0) return 'Nenhuma mudança';
  return n === 1 ? '1 mudança não salva' : `${n} mudanças não salvas`;
}

/** Texto visível de uma mudança: "Cancelar pedido: Equipe → Próprio". */
export const textoDaMudanca = (m: MudancaDePermissao): string => `${m.rotulo}: ${m.antes} → ${m.depois}`;

/** Texto falado (o leitor de tela não lê a seta): "Cancelar pedido, de Equipe para Próprio". */
export const textoFaladoDaMudanca = (m: MudancaDePermissao): string => `${m.rotulo}, de ${m.antes} para ${m.depois}`;

/** "Afeta 12 usuários" / "Afeta 1 usuário" / "Nenhum usuário tem este perfil". */
export function textoDosAfetados(n: number): string {
  if (n <= 0) return 'Nenhum usuário tem este perfil.';
  return n === 1 ? 'Afeta 1 usuário.' : `Afeta ${n} usuários.`;
}

/** Nota fixa embaixo do resumo (efeito e auditoria; aprovado no desenho). */
export const NOTA_DO_RESUMO = 'Vale na próxima ação de quem usa este perfil, sem precisar sair e entrar de novo. Fica registrado no histórico.';

/** Linha "Padrão: X" embaixo de um controle cujo valor difere do padrão de fábrica. */
export const textoDoPadrao = (valorDeFabrica: string): string => `Padrão: ${valorDeFabrica}`;

// ---------------------------------------------------------------- campo "Perfis" do usuário

export const ROTULO_CAMPO_PERFIS = 'Perfis';
export const AJUDA_CAMPO_PERFIS = 'Marque um ou mais. Quem acumula funções, como vendedor e promotor, fica com os dois.';

/** Título e explicação da prévia dos módulos efetivos (RN-CORE-01: união dos perfis ∩ contratados − exceções). */
export const TITULO_PREVIA_MODULOS = 'Módulos que esta pessoa vai usar';
export const AJUDA_PREVIA_MODULOS = 'Soma dos módulos dos perfis marcados, só os contratados pela empresa, menos as exceções desta pessoa.';

/** "Entra em: Campo e Gestão" / "Não entra em nenhum app nem no BKO". */
export function textoOndeEntra(lugares: readonly LugarDoPerfil[]): string {
  const nomes = ORDEM_LUGAR.filter((l) => lugares.includes(l)).map((l) => ROTULO_LUGAR[l]);
  if (nomes.length === 0) return 'Não entra em nenhum app nem no BKO.';
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  return `Entra em: ${lista}.`;
}
