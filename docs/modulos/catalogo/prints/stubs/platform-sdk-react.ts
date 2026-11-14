// Stub de @macuxi/platform-sdk/react para o print: dados fictícios no lugar do motor e da API.
type G = { __ficha?: unknown; __acoes?: { id: string; payload: unknown }[] };
const g = globalThis as G;
const ambiente = {
  usuario: () => ({ perfil: 'vendedor', fuso: 'America/Boa_Vista' }),
  online: () => true,
  http: { get: async () => g.__ficha },
};
export const useAmbiente = () => ambiente;
export const useMotorSync = () => ({ motor: null, estado: { sincronizado_em: null } });
export const useParametros = () => ({});
export const useExtensoes = () => g.__acoes ?? [];
