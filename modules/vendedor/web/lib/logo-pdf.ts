import type { AmbienteAparelho } from '@macuxi/platform-sdk';

/** T-0182 (manual §7): logo da distribuidora para o PDF do BKO; sem logo, sem rede ou erro = `null` (o PDF sai com a logo padrão). */
export async function logoParaPdf(ambiente: Pick<AmbienteAparelho, 'logoDaEmpresa'>): Promise<string | null> {
  try {
    return (await ambiente.logoDaEmpresa?.()) ?? null;
  } catch {
    return null;
  }
}
