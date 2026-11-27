/**
 * T-0111 (ADR 0033, RN-CORE-35): textos e montagem da página "Perfis de acesso" do BKO e do campo "Perfis" do formulário de
 * usuário. Puro (roda em Node nos testes). Spec: docs/design/perfis-de-acesso.md.
 *
 * A REGRA (o que pode, o que está travado, o que a empresa deixaria de ter) é do SDK e do domain do Core: `travaDaChave`,
 * `validarPerfil`, `validarAcessoDoTenant`. Aqui só há texto e arrumação do que a tela já decidiu.
 */
export * from '../comum/perfis';

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

/** Contagem do rodapé fixo da edição: "Nenhuma mudança" ou "3 mudanças não salvas". */
export function contagemNaoSalva(n: number): string {
  if (n <= 0) return 'Nenhuma mudança';
  return n === 1 ? '1 mudança não salva' : `${n} mudanças não salvas`;
}
