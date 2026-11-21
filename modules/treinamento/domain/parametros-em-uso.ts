import { ParametrosTreinamentoSchema } from '../contracts/parametros';
import { resolverParametros, type ParametrosTreinamento } from './parametros';

/**
 * RN-TRE-02: parâmetros em uso a partir do que o tenant cadastrou (`bruto`). Tipo errado ou valor fora da faixa em
 * qualquer chave = padrão em todas (API, app e painel mostram o mesmo). `fuso`, quando informado, prevalece sobre o
 * do cadastro; se for inválido, vale o padrão em tudo. `invalidos` traz os campos recusados na leitura (para o log).
 */
export function parametrosEmUso(bruto: unknown, fuso?: string | null): { parametros: ParametrosTreinamento; invalidos: string[] } {
  const lidos = ParametrosTreinamentoSchema.safeParse(bruto ?? {});
  const invalidos = lidos.success ? [] : lidos.error.issues.map((i) => i.path.join('.'));
  const base: Partial<ParametrosTreinamento> = lidos.success ? lidos.data : {};
  try {
    return { parametros: resolverParametros(fuso ? { ...base, fuso } : base), invalidos };
  } catch {
    return { parametros: resolverParametros(), invalidos };
  }
}
