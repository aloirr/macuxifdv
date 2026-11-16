import { empresaDosParametros, type AmbienteAparelho } from '@macuxi/platform-sdk';

/**
 * T-0182: a única regra de "de onde vêm o nome e a logo da distribuidora no PDF" (app e BKO usam as duas funções).
 * Logo: `ambiente.logoDaEmpresa`; sem a função, sem logo, erro síncrono ou assíncrono = `null` (o PDF sai com a logo padrão).
 */
export async function logoParaPdf(ambiente: Pick<AmbienteAparelho, 'logoDaEmpresa'>): Promise<string | null> {
  try {
    return (await ambiente.logoDaEmpresa?.()) ?? null;
  } catch {
    return null;
  }
}

/** Fragmento do contexto do PDF: `{ logo_src }` com logo, `{}` sem logo (RD-1744: expressão única para app e BKO). */
export async function logoSrcDoPdf(ambiente: Pick<AmbienteAparelho, 'logoDaEmpresa'>): Promise<{ logo_src?: string }> {
  const logo_src = await logoParaPdf(ambiente);
  return logo_src ? { logo_src } : {};
}

/** Nome da distribuidora no cabeçalho: o nome da empresa dos parâmetros do Core (fantasia, ou razão social se vazio); sem nome = `''` (o PDF sai sem texto, nunca "Macuxi"). */
export function nomeDaEmpresaParaPdf(parametrosCore: Readonly<Record<string, unknown>> | null | undefined): string {
  return empresaDosParametros(parametrosCore)?.nome.trim() ?? '';
}
