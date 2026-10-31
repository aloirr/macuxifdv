/** Relógio injetável (testes controlam o tempo). */
export interface Relogio {
  agora(): number;
}
export const relogioReal: Relogio = { agora: () => Date.now() };

export const iso = (ms: number) => new Date(ms).toISOString();
