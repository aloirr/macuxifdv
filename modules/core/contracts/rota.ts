/** Rota do dia e edição de rotas (desenho T-0016 §4.1). Status das paradas vem do domínio (`statusDasParadas`). */
import { ehDataCivil } from '@macuxi/comum/calendar';
import { z } from 'zod';
import { BaseNoMapaSchema, EnderecoBaseSchema } from './endereco-usuario';
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
/**
 * Calendário do tenant para a lista de dias da tela (T-0191, D3): semana útil (`metas.dias_uteis_semana`, 0 = domingo) e feriados do
 * tenant (`metas.feriados`). Os nacionais vêm de `@macuxi/comum/calendar`, no cliente e no servidor.
 */
export const CalendarioRotasSchema = z.object({ dias_uteis_semana: z.array(z.number().int().min(0).max(6)).min(1), feriados: z.array(Data) });
export type CalendarioRotas = z.infer<typeof CalendarioRotasSchema>;

export const RotasListaSchema = z.object({
  itens: z.array(RotaDoUsuarioSchema),
  /** T-0191 (RN-CORE-75): a base de cada vendedor da lista (`null` = sem base: o mapa não mostra saída e o km conta do 1º cliente). */
  bases: z.record(z.string().uuid(), BaseNoMapaSchema.nullable()).default({}),
  calendario: CalendarioRotasSchema.optional(),
});
export type RotasLista = z.infer<typeof RotasListaSchema>;

export const CopiarRotaRespostaSchema = z.object({ copiadas: z.array(Data), ignoradas: z.array(Data) });
export type CopiarRotaResposta = z.infer<typeof CopiarRotaRespostaSchema>;

export const GerarRotasRespostaSchema = z.object({ criadas: z.number().int(), ignoradas: z.number().int() });
export type GerarRotasResposta = z.infer<typeof GerarRotasRespostaSchema>;

export const UsuarioDataParamsSchema = z.object({ usuarioId: z.string().uuid(), data: Data });

// ---- T-0191 (RN-CORE-76): criar a rota do período por proximidade ----

export const MODOS_CONFLITO_ROTA = ['so_vazios', 'substituir'] as const;
export const ModoConflitoRotaSchema = z.enum(MODOS_CONFLITO_ROTA);
export type ModoConflitoRota = z.infer<typeof ModoConflitoRotaSchema>;

/** Período de até 62 dias (como `GET rotas`). */
export const PreviaRotaPedidoSchema = z
  .object({ usuario_id: z.string().uuid(), de: Data, ate: Data, modo: ModoConflitoRotaSchema.default('so_vazios') })
  .strict()
  .refine((v) => v.ate >= v.de && Date.parse(v.ate) - Date.parse(v.de) <= 62 * 86_400_000, { message: 'Escolha um período de até 62 dias, com a data final depois da inicial.', path: ['ate'] });
export type PreviaRotaPedido = z.infer<typeof PreviaRotaPedidoSchema>;

const ClienteDaPreviaSchema = z.object({
  cliente_id: z.string().uuid(),
  nome: z.string(),
  cidade: z.string().nullable(),
  bairro: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});

export const DiaDaPreviaSchema = z.object({
  data: Data,
  /** Paradas já na ordem da rota (a partir da base). */
  paradas: z.array(ClienteDaPreviaSchema),
  visitas: z.number().int(),
  /** Km a partir da base (ou do 1º cliente, sem base), sem volta. */
  km: z.number(),
});
export type DiaDaPrevia = z.infer<typeof DiaDaPreviaSchema>;

/** Cliente da carteira que ficou fora por não ter coordenada: o endereço e o CEP para a lista "Ver clientes" (T-0191, RN-CORE-77). */
export const ClienteForaSchema = z.object({
  cliente_id: z.string().uuid(),
  nome: z.string(),
  logradouro: z.string().nullable(),
  numero: z.string().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  cep: z.string().nullable(),
  /** Endereço e CEP iguais aos da última tentativa de gerar a coordenada: só muda se o cadastro mudar. */
  ja_tentado: z.boolean(),
});
export type ClienteFora = z.infer<typeof ClienteForaSchema>;

export const ClienteForaLimiteSchema = z.object({ cliente_id: z.string().uuid(), nome: z.string(), cidade: z.string().nullable() });

export const PreviaRotaRespostaSchema = z.object({
  /** Só os dias com rota na prévia, em ordem de data. */
  dias: z.array(DiaDaPreviaSchema),
  totais: z.object({ rotas: z.number().int(), visitas: z.number().int(), km: z.number() }),
  fora_sem_coordenada: z.array(ClienteForaSchema),
  fora_limite: z.array(ClienteForaLimiteSchema),
  /** Dias que já têm rota e não mudam (`so_vazios`, ou protegida: visita feita ou em atendimento, `origem = erp`). */
  mantidas: z.array(z.object({ data: Data, visitas: z.number().int(), protegida: z.boolean() })),
  /** Dias da semana útil sem rota por feriado (nacional ou do tenant). */
  feriados: z.array(Data),
  /** A base usada (RN-CORE-75); `null` = sem base. */
  base: EnderecoBaseSchema.nullable(),
});
export type PreviaRotaResposta = z.infer<typeof PreviaRotaRespostaSchema>;

/** `POST rotas/lote`: o id da rota é gerado no cliente (idempotência) e o servidor refaz a prévia para recusar o que for protegido. */
export const RotaDoLoteSchema = z
  .object({
    id: z.string().uuid(),
    data: Data,
    paradas: z.array(z.object({ cliente_id: z.string().uuid(), janela_inicio: Hora.nullable().optional(), janela_fim: Hora.nullable().optional() }).strict()).min(1).max(200),
  })
  .strict();
export const SalvarRotasLoteSchema = z
  .object({ usuario_id: z.string().uuid(), modo: ModoConflitoRotaSchema.default('so_vazios'), rotas: z.array(RotaDoLoteSchema).min(1).max(62) })
  .strict()
  .superRefine((v, ctx) => {
    const datas = new Set<string>();
    v.rotas.forEach((r, i) => {
      if (datas.has(r.data)) ctx.addIssue({ code: 'custom', path: ['rotas', i, 'data'], message: 'Duas rotas no mesmo dia. Mantenha uma só e salve de novo.' });
      datas.add(r.data);
      const vistos = new Set<string>();
      r.paradas.forEach((p, k) => {
        if (vistos.has(p.cliente_id)) ctx.addIssue({ code: 'custom', path: ['rotas', i, 'paradas', k, 'cliente_id'], message: 'O mesmo cliente aparece duas vezes na rota. Remova a repetição e salve de novo.' });
        vistos.add(p.cliente_id);
      });
    });
  });
export type SalvarRotasLote = z.infer<typeof SalvarRotasLoteSchema>;

export const SalvarRotasLoteRespostaSchema = z.object({
  /** Rotas gravadas agora (ou já gravadas por uma chamada anterior com o mesmo id). */
  salvas: z.number().int(),
  /** Já existiam com o mesmo id (repetição do mesmo lote). */
  repetidas: z.number().int(),
});
export type SalvarRotasLoteResposta = z.infer<typeof SalvarRotasLoteRespostaSchema>;

/** Códigos 422 do lote e da prévia. */
export const CODIGOS_ROTA_LOTE = ['ROTA_PROTEGIDA', 'ROTA_EXISTENTE', 'ROTA_DIA_INVALIDO'] as const;
