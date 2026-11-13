/**
 * Chamadas de Parâmetros › Calendário (desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2, §6.5 e §8): os
 * feriados do tenant (`metas.feriados`) e o almoço da Produtividade (`produtividade.almoco_corte` e
 * `produtividade.almoco_janela`), na ação `parametro.inicio`, no mesmo molde de `GET|PUT /v1/core/parametros/inicio`.
 * `chamar` é o `api` do platform-sdk; os testes passam a API simulada.
 *
 * PENDENTE DE CONTRATO: a N-A não trouxe o contrato destes parâmetros nem a rota. O formato abaixo segue o desenho e entra em
 * `contracts/` (com a rota) na N-D; até lá fica aqui, sem `.strict()`, para campo novo da API não quebrar a tela.
 */
import { api } from '@macuxi/platform-sdk/web';
import { ehDataCivil } from '@macuxi/comum/calendar';
import { z } from 'zod';

const Minuto = z.number().int().min(0).max(1439);

export const FeriadoDoTenantSchema = z.object({ data: z.string().refine(ehDataCivil), nome: z.string() });
export type FeriadoDoTenant = z.infer<typeof FeriadoDoTenantSchema>;

export const ParametrosCalendarioSchema = z.object({
  feriados: z.array(FeriadoDoTenantSchema),
  /** Minuto do dia; padrão 12:00 (720). */
  almoco_corte: Minuto,
  /** [início, fim] em minuto do dia; padrão 11:00–15:00 ([660, 900]). */
  almoco_janela: z.tuple([Minuto, Minuto]),
});
export type ParametrosCalendario = z.infer<typeof ParametrosCalendarioSchema>;

export const CHAVE_CALENDARIO = ['core', 'parametros', 'calendario'] as const;
const CAMINHO = '/core/parametros/calendario';

export function criarApiCalendario(chamar: typeof api = api) {
  return {
    ler: async (): Promise<ParametrosCalendario> => ParametrosCalendarioSchema.parse(await chamar<unknown>(CAMINHO)),
    gravar: async (p: ParametrosCalendario): Promise<void> => {
      await chamar<unknown>(CAMINHO, { method: 'PUT', body: ParametrosCalendarioSchema.parse(p) });
    },
  };
}
export type ApiCalendario = ReturnType<typeof criarApiCalendario>;
