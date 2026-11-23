/**
 * Monitor detalhado da Integração para o portal `config.` (desenho `empresa-zerar.md` §6.4; `GET /v1/integracao/monitor/detalhes`):
 * junta, por entidade e por Conector, o que a API leu do schema `integracao`. Sem I/O; nenhum valor de linha entra aqui.
 */
import {
  ORDEM_CARGA_ENTIDADES,
  SinalResumoDetalhe,
  type ClasseErroLinha,
  type CodigoErroLinha,
  type ConectorDetalhe,
  type Entidade,
  type EntidadeDetalhe,
  type EstadoLoteBko,
  type MonitorDetalhes,
  type TipoConector,
} from '../contracts';
import { avaliarSaudeConector } from './monitor';
import { podeReprocessarLote } from './status-lote';

export interface EntradaMonitorDetalhes {
  agora: string;
  conectores: ReadonlyArray<{
    conector_id: string;
    tipo: TipoConector;
    ativo: boolean;
    entidades: readonly Entidade[];
    versao_conector: string | null;
    ultimo_sinal_em: string | null;
    parado_por_versao: boolean;
    sinal_resumo: unknown;
  }>;
  cursores: ReadonlyArray<{ conector_id: string; entidade: Entidade; alterado_em: string | null; external_id: string | null; atualizado_em: string }>;
  registros: ReadonlyArray<{ entidade: Entidade; ativos: number; inativos: number }>;
  /** Lotes recentes da entidade; `tem_conteudo` = o corpo ainda está no staging. */
  lotes: ReadonlyArray<{
    lote_id: string;
    conector_id: string;
    entidade: Entidade;
    modo: 'completo' | 'delta';
    status: EstadoLoteBko;
    recebido_em: string;
    concluido_em: string | null;
    tem_conteudo: boolean;
  }>;
  erros: ReadonlyArray<{ entidade: Entidade; codigo: CodigoErroLinha; reprocessavel: boolean; linhas: number }>;
}

/** RN-INT-03: reprocessável = basta reprocessar; os demais só se resolvem com o reenvio corrigido do ERP. */
export const classeDoErroLinha = (reprocessavel: boolean): ClasseErroLinha => (reprocessavel ? 'reprocessavel' : 'corrigir_no_erp');

/** `sinal_resumo` gravado no último sinal de vida; falha fechada (ausente, antigo ou fora do formato = `null`). */
export function sinalResumoDoConector(resumo: unknown): SinalResumoDetalhe | null {
  if (typeof resumo !== 'object' || resumo === null || Array.isArray(resumo)) return null;
  const r = SinalResumoDetalhe.safeParse(resumo);
  return r.success ? { ...r.data, atualizacao: r.data.atualizacao ?? null } : null;
}

const recentePrimeiro = (a: { recebido_em: string }, b: { recebido_em: string }) => Date.parse(b.recebido_em) - Date.parse(a.recebido_em);

export function montarMonitorDetalhes(e: EntradaMonitorDetalhes): MonitorDetalhes {
  const configuradas = new Set(e.conectores.filter((c) => c.ativo).flatMap((c) => c.entidades));
  const comDado = new Set<Entidade>([...e.cursores, ...e.registros, ...e.lotes, ...e.erros].map((x) => x.entidade));

  const entidades = ORDEM_CARGA_ENTIDADES.filter((ent) => configuradas.has(ent) || comDado.has(ent)).map((entidade): EntidadeDetalhe => {
    const lotes = e.lotes.filter((l) => l.entidade === entidade).sort(recentePrimeiro);
    const ultimo = lotes[0];
    const reg = e.registros.find((r) => r.entidade === entidade);
    return {
      entidade,
      cursores: e.cursores
        .filter((c) => c.entidade === entidade)
        .map((c) => ({ conector_id: c.conector_id, alterado_em: c.alterado_em, external_id: c.external_id, atualizado_em: c.atualizado_em })),
      registros: { ativos: reg?.ativos ?? 0, inativos: reg?.inativos ?? 0 },
      ultimo_lote: ultimo
        ? { lote_id: ultimo.lote_id, conector_id: ultimo.conector_id, modo: ultimo.modo, status: ultimo.status, recebido_em: ultimo.recebido_em, concluido_em: ultimo.concluido_em }
        : null,
      erros: e.erros
        .filter((x) => x.entidade === entidade && x.linhas > 0)
        .map((x) => ({ codigo: x.codigo, classe: classeDoErroLinha(x.reprocessavel), linhas: x.linhas }))
        .sort((a, b) => b.linhas - a.linhas || a.codigo.localeCompare(b.codigo)),
      // RN-INT-15: o mais antigo primeiro (é o primeiro a perder o conteúdo no expurgo)
      lotes_reprocessaveis: lotes
        .filter((l) => podeReprocessarLote(l.status) && l.tem_conteudo)
        .map((l) => l.lote_id)
        .reverse(),
    };
  });

  const conectores = e.conectores.map(
    (c): ConectorDetalhe => ({
      conector_id: c.conector_id,
      tipo: c.tipo,
      ativo: c.ativo,
      entidades: [...c.entidades],
      versao_conector: c.versao_conector,
      ultimo_sinal_em: c.ultimo_sinal_em,
      saude: avaliarSaudeConector({ tipo: c.tipo, ativo: c.ativo, ultimo_sinal_em: c.ultimo_sinal_em, parado_por_versao: c.parado_por_versao }, e.agora),
      sinal: sinalResumoDoConector(c.sinal_resumo),
    }),
  );

  return { gerado_em: e.agora, entidades, conectores };
}
