/** "Hoje" (AAAA-MM-DD) no fuso IANA do tenant (RN-CORE-11); fuso inválido cai em UTC. */
export function hojeNoFuso(agora: Date, fuso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  } catch {
    return agora.toISOString().slice(0, 10);
  }
}
