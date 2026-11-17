/**
 * Horário de almoço padrão da empresa (T-0180, D5; RN-CORE-44), em Parâmetros › Calendário e na ficha do usuário.
 * Texto digitado (hh:mm) → minutos do dia, com a regra do domain (`validarHorarioAlmoco`): fim depois do início, de 15 min a 3 h.
 * Erro só ao salvar, no texto do campo.
 */
import { api } from '@macuxi/platform-sdk/web';
import { ParametrosJornadaSchema, type ParametrosJornada } from '../../../contracts';

export const CHAVE_JORNADA = ['core', 'parametros', 'jornada'] as const;
const CAMINHO = '/core/parametros/jornada';

export function criarApiJornada(chamar: typeof api = api) {
  return {
    ler: async (): Promise<ParametrosJornada> => ParametrosJornadaSchema.parse(await chamar<unknown>(CAMINHO)),
    gravar: async (p: ParametrosJornada): Promise<void> => {
      await chamar<unknown>(CAMINHO, { method: 'PUT', body: ParametrosJornadaSchema.parse(p) });
    },
  };
}
export type ApiJornada = ReturnType<typeof criarApiJornada>;

/** Rótulo do botão do painel (D-PAR-05): a ação concreta, como nos outros painéis de Parâmetros ("Salvar prazo", "Salvar farol"). */
export const rotuloSalvarAlmoco = (gravando: boolean): string => (gravando ? 'Salvando…' : 'Salvar almoço');
