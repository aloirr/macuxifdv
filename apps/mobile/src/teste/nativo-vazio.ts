/**
 * Só para testes em Node: um módulo nativo "vazio" (qualquer export vira uma função/objeto inerte). Serve para carregar a API
 * pública de um módulo (`@macuxi/<m>/app`), cujo índice puxa telas com `react-native`, quando o teste usa só a regra pura.
 * Uso: `vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()))`.
 */
export function moduloVazio(): Record<string | symbol, unknown> {
  const valor = (chave: string | symbol): unknown => (chave === 'then' ? undefined : chave === Symbol.toPrimitive ? () => 0 : vazio);
  const vazio: unknown = new Proxy(() => vazio, { get: (_alvo, chave) => valor(chave) });
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (_alvo, chave) => (chave === '__esModule' ? undefined : valor(chave)),
    has: () => true,
  });
}
