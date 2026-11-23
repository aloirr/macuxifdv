/**
 * `GET /v1/integracao/monitor/detalhes` (só o super-admin, `superAdmin: 'exige'`; ADR 0029, desenho `empresa-zerar.md` §6.4): o
 * detalhe do Hub por entidade e por Conector para a aba Integração da empresa no portal `config.`, onde ficam "Reprocessar" e
 * "Zerar dados" de cada entidade. Só códigos, contagens, ids e instantes: nenhum valor de linha (pode ter CPF/CNPJ).
 */
import { z } from 'zod';
import { DataHoraUtc, Uuid } from './base';
import { AtualizacaoConector, SinalConector } from './conector';
import { ConectorIdentificador } from './hub';
import { Entidade } from './entidades';
import { CodigoErroLinha } from './lote';
import { EstadoLoteBko, SaudeConector, TipoConector } from './bko';

/** Relativa a `/v1`. */
export const ROTA_MONITOR_DETALHES = '/integracao/monitor/detalhes';

const Contagem = z.number().int().nonnegative();

/** Classe do erro por linha (RN-INT-03): `reprocessavel` = basta reprocessar; `corrigir_no_erp` = só o reenvio corrigido resolve. */
export const CLASSES_ERRO_LINHA = ['reprocessavel', 'corrigir_no_erp'] as const;
export const ClasseErroLinha = z.enum(CLASSES_ERRO_LINHA);
export type ClasseErroLinha = z.infer<typeof ClasseErroLinha>;

/** Cursor do delta guardado no Hub por (Conector, entidade). O Conector com estado local não o lê: o reenvio é `conector carga-completa`. */
export const CursorDetalhe = z.object({
  conector_id: ConectorIdentificador,
  alterado_em: DataHoraUtc.nullable(),
  external_id: z.string().nullable(),
  atualizado_em: DataHoraUtc,
});
export type CursorDetalhe = z.infer<typeof CursorDetalhe>;

export const ErroPorCodigo = z.object({
  codigo: CodigoErroLinha,
  classe: ClasseErroLinha,
  /** Linhas com erro ainda não resolvidas nos lotes recentes da entidade. */
  linhas: Contagem,
});
export type ErroPorCodigo = z.infer<typeof ErroPorCodigo>;

export const UltimoLoteDetalhe = z.object({
  lote_id: Uuid,
  conector_id: ConectorIdentificador,
  modo: z.enum(['completo', 'delta']),
  status: EstadoLoteBko,
  recebido_em: DataHoraUtc,
  concluido_em: DataHoraUtc.nullable(),
});
export type UltimoLoteDetalhe = z.infer<typeof UltimoLoteDetalhe>;

export const EntidadeDetalhe = z.object({
  entidade: Entidade,
  cursores: z.array(CursorDetalhe),
  /** Linhas em `registro_atual` (RN-INT-06): ativas e inativadas. */
  registros: z.object({ ativos: Contagem, inativos: Contagem }),
  ultimo_lote: UltimoLoteDetalhe.nullable(),
  erros: z.array(ErroPorCodigo),
  /** Lotes que "Reprocessar" reenfileira (RN-INT-15, com o conteúdo ainda no staging), do mais antigo para o mais recente. */
  lotes_reprocessaveis: z.array(Uuid),
});
export type EntidadeDetalhe = z.infer<typeof EntidadeDetalhe>;

/** O que o Conector informou no último sinal de vida (`sinal_resumo`); ausente quando nunca mandou ou fora do formato. */
export const SinalResumoDetalhe = z.object({
  fila: SinalConector.shape.fila,
  entidades: SinalConector.shape.entidades,
  atualizacao: AtualizacaoConector.nullish(),
});
export type SinalResumoDetalhe = z.infer<typeof SinalResumoDetalhe>;

export const ConectorDetalhe = z.object({
  conector_id: ConectorIdentificador,
  tipo: TipoConector,
  ativo: z.boolean(),
  entidades: z.array(Entidade),
  versao_conector: z.string().nullable(),
  ultimo_sinal_em: DataHoraUtc.nullable(),
  saude: SaudeConector,
  sinal: SinalResumoDetalhe.nullable(),
});
export type ConectorDetalhe = z.infer<typeof ConectorDetalhe>;

export const MonitorDetalhes = z.object({
  gerado_em: DataHoraUtc,
  /** Na ordem de carga (RN-INT-04): as entidades de algum Conector ativo e as que têm dado no Hub. */
  entidades: z.array(EntidadeDetalhe),
  conectores: z.array(ConectorDetalhe),
});
export type MonitorDetalhes = z.infer<typeof MonitorDetalhes>;
