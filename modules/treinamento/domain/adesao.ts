/** Indicadores do painel do gestor/BKO: adesão do mês e conclusão por trilha (RF-TRE-05). */
import { localDate, parseYearMonth } from '@macuxi/comum';
import { percentual } from './numeros';
import { PARAMETROS_PADRAO } from './parametros';
import { usuarioNoPublico, type TrilhaDef } from './trilha';

export interface AdesaoDoMes {
  mes: string;
  /** Pessoas do público-alvo. */
  publico: number;
  /** Pessoas do público que concluíram ao menos uma lição no mês. */
  ativos_no_mes: number;
  /** % do público; null quando o público é vazio (sem dados). */
  adesao_pct: number | null;
}

/**
 * RF-TRE-05: adesão do mês = % do público que concluiu ao menos uma lição no mês (mês civil no fuso do
 * tenant). Quem não está no público informado não entra na conta.
 */
export function adesaoDoMes(e: {
  publico: readonly string[];
  conclusoes: readonly { usuario_id: string; concluida_em: string }[];
  mes: string;
  fuso?: string;
}): AdesaoDoMes {
  parseYearMonth(e.mes);
  const fuso = e.fuso ?? PARAMETROS_PADRAO.fuso;
  const publico = new Set(e.publico);
  const ativos = new Set(e.conclusoes.filter((c) => publico.has(c.usuario_id) && localDate(new Date(c.concluida_em), fuso).slice(0, 7) === e.mes).map((c) => c.usuario_id));
  return { mes: e.mes, publico: publico.size, ativos_no_mes: ativos.size, adesao_pct: percentual(ativos.size, publico.size) };
}

/** Pessoas ativas dentro do público-alvo da trilha. */
export function publicoDaTrilha(trilha: Pick<TrilhaDef, 'publico_alvo'>, usuarios: readonly { id: string; perfil: string; equipe_id: string | null; ativo: boolean }[]): string[] {
  return usuarios.filter((u) => u.ativo && usuarioNoPublico(trilha.publico_alvo, u)).map((u) => u.id);
}

/** RF-TRE-05: % do público da trilha que a concluiu; null com público vazio. */
export function conclusaoDaTrilha(publico: readonly string[], concluiram: readonly string[]): { publico: number; concluiram: number; conclusao_pct: number | null } {
  const alvo = new Set(publico);
  const feitos = new Set(concluiram.filter((id) => alvo.has(id)));
  return { publico: alvo.size, concluiram: feitos.size, conclusao_pct: percentual(feitos.size, alvo.size) };
}
