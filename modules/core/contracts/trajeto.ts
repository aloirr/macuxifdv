/**
 * Rastreamento de localização no expediente (T-0156; ADR 0061; desenho `docs/desenho/tracking.md`). RN-CORE-13 (tracking só com
 * finalidade, aviso e termo aceito), RN-CORE-37 (permissão "o tempo todo") e RN-CORE-46 (km do dia).
 *
 * - Push (motor de sync, entidades só de envio, ADR 0009): `ponto_trajeto`, `pausa_trajeto` e `aceite_termo_rastreamento`, idempotentes
 *   pelo UUID do aparelho; o aceite vai antes dos pontos. A API revalida o portão (`podeRastrear`) e descarta o ponto fora dele sem
 *   travar a fila.
 * - Pull: `termo_rastreamento` (versão vigente do tenant) e `ausencia_usuario` (só as do próprio usuário).
 * - Parâmetro do tenant `rastreamento` (padrão DESLIGADO): ligar, expediente por dia da semana e frequência da captura.
 * - Consulta `core.trajeto_do_dia@1`: o Gestor lê os pontos do dia da equipe, com o escopo conferido pelo Core. Nenhum outro
 *   módulo lê as tabelas do trajeto.
 *
 * Minimização (§3.1): o ponto leva só id, instante, coordenada, precisão e velocidade. Sem endereço, altitude, rumo, rede, bateria.
 * Nenhuma coordenada vai para log, erro, Diagnóstico ou telemetria (§9).
 */
import { ehDataCivil } from '@macuxi/comum/calendar';
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { MinutoDoDiaSchema } from './jornada';

const Id = z.string().uuid();
const DataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(ehDataCivil, 'Data inexistente. Use AAAA-MM-DD.');
/** Instante UTC; o Postgres serializa com deslocamento (`+00:00`), por isso o offset é aceito. */
const Instante = z.string().datetime({ offset: true });
/** Coordenada com até 6 casas decimais (~11 cm), igual ao `numeric(9,6)` do banco. */
const seisCasas = (v: number): boolean => Math.abs(Math.round(v * 1e6) - v * 1e6) < 1e-6;
const Latitude = z.number().min(-90).max(90).refine(seisCasas, 'Use no máximo 6 casas decimais.');
const Longitude = z.number().min(-180).max(180).refine(seisCasas, 'Use no máximo 6 casas decimais.');

// ---- Entidades de sync ----
export const ENTIDADE_PONTO_TRAJETO = 'ponto_trajeto';
export const ENTIDADE_PAUSA_TRAJETO = 'pausa_trajeto';
export const ENTIDADE_ACEITE_TERMO_RASTREAMENTO = 'aceite_termo_rastreamento';
export const ENTIDADE_TERMO_RASTREAMENTO = 'termo_rastreamento';
export const ENTIDADE_AUSENCIA_USUARIO = 'ausencia_usuario';
/** Ordem do push: o aceite antes dos pontos (§3.4); a pausa junto dos pontos. */
export const ORDEM_PUSH_TRAJETO = [ENTIDADE_ACEITE_TERMO_RASTREAMENTO, ENTIDADE_PONTO_TRAJETO, ENTIDADE_PAUSA_TRAJETO] as const;
/** Pontos por lote de envio (§3.4). */
export const PONTOS_POR_LOTE = 500;

/** Push `ponto_trajeto` (§3.1). O aparelho vem do token (`did`); o usuário, da sessão. */
export const PontoTrajetoSchema = z
  .object({
    id: Id,
    capturado_em: Instante,
    latitude: Latitude,
    longitude: Longitude,
    precisao_m: z.number().nonnegative(),
    /** Nula quando o aparelho não informa. */
    velocidade_ms: z.number().nonnegative().nullable(),
  })
  .strict();
export type PontoTrajeto = z.infer<typeof PontoTrajetoSchema>;

/** Push `pausa_trajeto` (§4.3): só início e fim, sem motivo. `fim` nulo = pausa em curso (o aparelho reenvia com o fim; upsert pelo id). */
export const PausaTrajetoSchema = z
  .object({ id: Id, inicio: Instante, fim: Instante.nullable() })
  .strict()
  .refine((p) => p.fim === null || Date.parse(p.fim) >= Date.parse(p.inicio), { message: 'O fim da pausa vem depois do início.', path: ['fim'] });
export type PausaTrajeto = z.infer<typeof PausaTrajetoSchema>;

/** Push `aceite_termo_rastreamento` (§6): "Li e estou ciente" na versão vigente, com a hora do aparelho. A versão tem de existir no tenant. */
export const AceiteTermoRastreamentoSchema = z.object({ id: Id, termo_versao: z.number().int().min(1), aceito_em: Instante }).strict();
export type AceiteTermoRastreamento = z.infer<typeof AceiteTermoRastreamentoSchema>;

/** Pull `termo_rastreamento` e resposta do BKO: cada publicação é uma versão nova; vigente = a maior versão publicada. */
export const TermoRastreamentoSchema = z
  .object({ id: Id, versao: z.number().int().min(1), texto: z.string().min(1), publicado_em: Instante, updated_at: Instante, deleted_at: Instante.nullable(), external_id: z.string().nullable().optional() })
  .strict();
export type TermoRastreamento = z.infer<typeof TermoRastreamentoSchema>;
/** Tamanho máximo do texto do termo publicado no BKO. */
export const TERMO_TEXTO_MAX = 20_000;
/** `POST /v1/core/rastreamento/termos` (ação `rastreamento.configurar`): o admin manda o texto; a versão é a seguinte, dada pelo servidor. */
export const TermoRastreamentoPublicarSchema = z.object({ texto: z.string().trim().min(1).max(TERMO_TEXTO_MAX) }).strict();
export type TermoRastreamentoPublicar = z.infer<typeof TermoRastreamentoPublicarSchema>;

const deAteValido = (a: { de: string; ate: string }): boolean => a.de <= a.ate;
const MENSAGEM_DE_ATE = 'A data final vem no mesmo dia ou depois da inicial.';

/** `POST /v1/core/ausencias` (ação `ausencia.cadastrar`, §4.2): férias, folga ou afastamento, sem motivo (minimização). Datas no fuso do tenant. */
export const AusenciaUsuarioEntradaSchema = z
  .object({ usuario_id: Id, de: DataCivil, ate: DataCivil })
  .strict()
  .refine(deAteValido, { message: MENSAGEM_DE_ATE, path: ['ate'] });
export type AusenciaUsuarioEntrada = z.infer<typeof AusenciaUsuarioEntradaSchema>;
/** Pull `ausencia_usuario` (só as do próprio usuário) e linha da lista do BKO. */
export const AusenciaUsuarioSchema = z
  .object({ id: Id, usuario_id: Id, de: DataCivil, ate: DataCivil, updated_at: Instante, deleted_at: Instante.nullable(), external_id: z.string().nullable().optional() })
  .strict()
  .refine(deAteValido, { message: MENSAGEM_DE_ATE, path: ['ate'] });
export type AusenciaUsuario = z.infer<typeof AusenciaUsuarioSchema>;

// ---- Parâmetro do tenant ----
export const PARAMETRO_RASTREAMENTO = 'rastreamento';
/** Faixa do expediente em minutos do dia, no fuso do tenant. */
export const FaixaExpedienteSchema = z
  .object({ inicio_min: MinutoDoDiaSchema, fim_min: MinutoDoDiaSchema })
  .strict()
  .refine((f) => f.inicio_min < f.fim_min, { message: 'O fim do expediente vem depois do início.', path: ['fim_min'] });
export type FaixaExpediente = z.infer<typeof FaixaExpedienteSchema>;
const FaixasDoDiaSchema = z
  .array(FaixaExpedienteSchema)
  .max(2)
  .refine((fs) => fs.length < 2 || fs[0]!.fim_min <= fs[1]!.inicio_min, { message: 'A 2ª faixa começa depois do fim da 1ª.' });
/** Por dia da semana, '0' = domingo … '6' = sábado; dia sem faixa = sem expediente. */
export const ExpedienteSchema = z
  .object({ '0': FaixasDoDiaSchema, '1': FaixasDoDiaSchema, '2': FaixasDoDiaSchema, '3': FaixasDoDiaSchema, '4': FaixasDoDiaSchema, '5': FaixasDoDiaSchema, '6': FaixasDoDiaSchema })
  .strict();
export type Expediente = z.infer<typeof ExpedienteSchema>;

/** Frequência da captura (§3.1); sobe sem build novo se a bateria passar da meta (§3.3). */
export const FrequenciaRastreamentoSchema = z
  .object({
    distancia_m: z.number().int().min(50).max(2_000),
    intervalo_min: z.number().int().min(1).max(60),
    lote_min: z.number().int().min(1).max(60),
  })
  .strict();
export type FrequenciaRastreamento = z.infer<typeof FrequenciaRastreamentoSchema>;

/** `GET|PUT /v1/core/parametros/rastreamento` (ação `rastreamento.configurar`) e pull `parametro`. */
export const ParametrosRastreamentoSchema = z.object({ ativo: z.boolean(), expediente: ExpedienteSchema, frequencia: FrequenciaRastreamentoSchema }).strict();
export type ParametrosRastreamento = z.infer<typeof ParametrosRastreamentoSchema>;

const DIA_UTIL: FaixaExpediente[] = [{ inicio_min: 8 * 60, fim_min: 18 * 60 }];
/** Padrão de fábrica: DESLIGADO; expediente proposto no §4.1 (seg–sex 08:00–18:00, sáb 08:00–12:00, dom sem). */
export const PARAMETROS_RASTREAMENTO_PADRAO: ParametrosRastreamento = {
  ativo: false,
  expediente: { '0': [], '1': DIA_UTIL, '2': DIA_UTIL, '3': DIA_UTIL, '4': DIA_UTIL, '5': DIA_UTIL, '6': [{ inicio_min: 8 * 60, fim_min: 12 * 60 }] },
  frequencia: { distancia_m: 200, intervalo_min: 5, lote_min: 5 },
};

// ---- Portão (§2) ----
/** Motivo de o portão estar fechado (`podeRastrear`); o Diagnóstico mostra só o estado, nunca a coordenada (§9). */
export const MOTIVOS_SEM_RASTREIO = ['desligado', 'sem_termo', 'cargo', 'app', 'sem_aceite', 'fora_do_expediente', 'feriado', 'ausencia', 'pausa', 'sem_permissao'] as const;
export type MotivoSemRastreio = (typeof MOTIVOS_SEM_RASTREIO)[number];

// ---- Consultas ----
/** Ponto como sai para a tela (mapa do Gestão, "Meu trajeto"): sem velocidade nem aparelho. */
export const PontoDoTrajetoSchema = z.object({ capturado_em: Instante, latitude: Latitude, longitude: Longitude, precisao_m: z.number().nonnegative() }).strict();
export type PontoDoTrajeto = z.infer<typeof PontoDoTrajetoSchema>;
export const TrajetoDoUsuarioSchema = z
  .object({
    id: Id,
    /** Km do dia pelo `metrosDoTrajeto` (o mesmo de `core.deslocamento_dia`). */
    metros: z.number().int().nonnegative(),
    /** Em ordem de `capturado_em`. */
    pontos: z.array(PontoDoTrajetoSchema),
    pausas: z.array(z.object({ inicio: Instante, fim: Instante.nullable() }).strict()),
  })
  .strict();
export type TrajetoDoUsuario = z.infer<typeof TrajetoDoUsuarioSchema>;

/** Dias para trás que a consulta alcança (retenção, §8). */
export const TRAJETO_DIAS_MAX = 90;

/** `GET /v1/core/trajeto?usuario_id&data` ("Meu trajeto" com `core.trajeto.ver_proprio`; a equipe com `core.trajeto.ver_equipe`, no escopo). */
export const TrajetoQuerySchema = z.object({ usuario_id: Id.optional(), data: DataCivil }).strict();
export type TrajetoQuery = z.infer<typeof TrajetoQuerySchema>;
export const TrajetoRespostaSchema = z.object({ data: DataCivil, usuario: TrajetoDoUsuarioSchema }).strict();
export type TrajetoResposta = z.infer<typeof TrajetoRespostaSchema>;

/**
 * `core.trajeto_do_dia@1` (ADR 0061 §1): pontos e pausas do dia (data no fuso do tenant) dos `usuario_ids` pedidos (1 a 500), só
 * os que estão no escopo de quem consulta e com `core.trajeto.ver_equipe`; id fora do escopo, removido ou de outro tenant some
 * (não é erro). Até `TRAJETO_DIAS_MAX` dias atrás. Só leitura, na transação de quem consulta.
 */
export const TrajetoDoDiaEntradaSchema = z.object({ usuario_ids: z.array(Id).min(1).max(500), data: DataCivil }).strict();
export type TrajetoDoDiaEntrada = z.infer<typeof TrajetoDoDiaEntradaSchema>;
export const TrajetoDoDiaSaidaSchema = z.object({ data: DataCivil, usuarios: z.array(TrajetoDoUsuarioSchema) }).strict();
export type TrajetoDoDiaSaida = z.infer<typeof TrajetoDoDiaSaidaSchema>;
export const CONSULTA_TRAJETO_DO_DIA = definirConsulta({ nome: 'core.trajeto_do_dia@1', entrada: TrajetoDoDiaEntradaSchema, saida: TrajetoDoDiaSaidaSchema });
