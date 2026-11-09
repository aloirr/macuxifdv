/** Rota do dia e edição de rotas (desenho T-0016 §4.1). Status das paradas vem do domínio (`statusDasParadas`). */
import { ehDataCivil } from '@macuxi/comum/calendar';
import { z } from 'zod';
import { RotaParadaSyncSchema, RotaSyncSchema } from './sync';

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(ehDataCivil, 'Data inexistente no calendário. Informe uma data válida (AAAA-MM-DD).');
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const STATUS_PARADA = ['feita', 'em_atendimento', 'proxima', 'pendente'] as const;
export const StatusParadaSchema = z.enum(STATUS_PARADA);
export type StatusParada = z.infer<typeof StatusParadaSchema>;

export const RotaDiaSchema = z.object({
  rota: RotaSyncSchema.nullable(),
  paradas: z.array(
    RotaParadaSyncSchema.extend({
      status: StatusParadaSchema,
      visita_id: z.string().uuid().nullable(),
      /** Dados do cliente para o editor do BKO (mapa e lista); não vão ao aparelho (lá vêm das linhas de `cliente`). */
      cliente_nome: z.string().optional(),
      cliente_cidade: z.string().nullable().optional(),
      cliente_bairro: z.string().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    }),
  ),
  feitas: z.number().int(),
  total: z.number().int(),
});
export type RotaDia = z.infer<typeof RotaDiaSchema>;

export const PutRotaSchema = z
  .object({
    paradas: z
      .array(z.object({ cliente_id: z.string().uuid(), janela_inicio: Hora.nullable().optional(), janela_fim: Hora.nullable().optional() }).strict())
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    // o banco tem único (rota, cliente): duplicado viraria 500
    const vistos = new Set<string>();
    v.paradas.forEach((p, i) => {
      if (vistos.has(p.cliente_id)) ctx.addIssue({ code: 'custom', path: ['paradas', i, 'cliente_id'], message: 'O mesmo cliente aparece duas vezes na rota. Remova a repetição e salve de novo.' });
      vistos.add(p.cliente_id);
    });
  });
export type PutRota = z.infer<typeof PutRotaSchema>;

export const CopiarRotaSchema = z.object({ para: z.array(Data).min(1).max(31) }).strict();
export type CopiarRota = z.infer<typeof CopiarRotaSchema>;

/** `semana` = a segunda-feira da semana (ISO); outro dia da semana é erro de quem chama, não é corrigido em silêncio. */
export const ehSegundaFeira = (data: string): boolean => new Date(`${data}T12:00:00Z`).getUTCDay() === 1;
export const GerarRotasSchema = z
  .object({
    semana: Data.refine(ehSegundaFeira, 'Informe a segunda-feira da semana (AAAA-MM-DD).'),
    usuario_ids: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict();
export type GerarRotas = z.infer<typeof GerarRotasSchema>;

/** `GET rotas?usuario_id&de&ate` (BKO): sem filtro, os próximos 7 dias dos usuários visíveis. */
export const RotasQuerySchema = z.object({ usuario_id: z.string().uuid().optional(), de: Data.optional(), ate: Data.optional() }).strict();
export type RotasQuery = z.infer<typeof RotasQuerySchema>;

export const RotaDoUsuarioSchema = RotaDiaSchema.extend({ usuario_id: z.string().uuid(), usuario_nome: z.string(), data: Data });
export const RotasListaSchema = z.object({ itens: z.array(RotaDoUsuarioSchema) });
export type RotasLista = z.infer<typeof RotasListaSchema>;

export const CopiarRotaRespostaSchema = z.object({ copiadas: z.array(Data), ignoradas: z.array(Data) });
export type CopiarRotaResposta = z.infer<typeof CopiarRotaRespostaSchema>;

export const GerarRotasRespostaSchema = z.object({ criadas: z.number().int(), ignoradas: z.number().int() });
export type GerarRotasResposta = z.infer<typeof GerarRotasRespostaSchema>;

export const UsuarioDataParamsSchema = z.object({ usuarioId: z.string().uuid(), data: Data });
