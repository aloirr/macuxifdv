/**
 * Versionamento do contrato `/integracao/v1` (RN-INT-09).
 */
import { PARAMETROS_PADRAO } from './parametros';

export type ResultadoVersao =
  | { ok: true; versao: string }
  | { ok: false; codigo: 'versao_nao_suportada'; mensagem: string; suportadas: readonly string[] };

export function validarVersaoContrato(versao: unknown, opcoes: { suportadas?: readonly string[] } = {}): ResultadoVersao {
  const suportadas = opcoes.suportadas ?? PARAMETROS_PADRAO.versoesSuportadas;
  if (typeof versao === 'string' && suportadas.includes(versao)) return { ok: true, versao };
  return {
    ok: false,
    codigo: 'versao_nao_suportada',
    mensagem: `Versão de contrato não suportada. Versões aceitas: ${suportadas.join(', ')}. Atualize o Conector ou o arquivo de carga.`,
    suportadas,
  };
}

export type MudancaContrato =
  | 'campo_opcional_adicionado'
  | 'valor_enum_adicionado'
  | 'endpoint_adicionado'
  | 'campo_obrigatorio_adicionado'
  | 'campo_tornado_obrigatorio'
  | 'campo_removido'
  | 'campo_renomeado'
  | 'tipo_alterado'
  | 'valor_enum_removido'
  | 'limite_reduzido';

const COMPATIVEIS: ReadonlySet<MudancaContrato> = new Set<MudancaContrato>(['campo_opcional_adicionado', 'valor_enum_adicionado', 'endpoint_adicionado']);

/** Campo novo opcional é compatível; qualquer outra mudança é incompatível e vira `/v2` com ADR. */
export function classificarMudancaContrato(mudanca: MudancaContrato): 'compativel' | 'incompativel' {
  return COMPATIVEIS.has(mudanca) ? 'compativel' : 'incompativel';
}

export interface SituacaoVersao {
  estado: 'ativa' | 'em_descontinuacao' | 'encerrada';
  encerraEm: string | null;
}

function somarMeses(iso: string, meses: number): string {
  const d = new Date(iso);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d.getUTCDate(), ultimoDia);
  return new Date(Date.UTC(ano, mes, dia, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}

/** A versão anterior fica ativa por [6 meses] depois que a nova a substitui. */
export function situacaoVersao(
  versao: { substituidaEm: string | null },
  agora: string,
  opcoes: { janelaMeses?: number } = {},
): SituacaoVersao {
  if (!versao.substituidaEm) return { estado: 'ativa', encerraEm: null };
  const janela = opcoes.janelaMeses ?? PARAMETROS_PADRAO.janelaVersaoAnteriorMeses;
  const encerraEm = somarMeses(versao.substituidaEm, janela);
  return { estado: Date.parse(agora) < Date.parse(encerraEm) ? 'em_descontinuacao' : 'encerrada', encerraEm };
}
