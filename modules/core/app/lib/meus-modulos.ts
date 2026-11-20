/**
 * Regras de apresentação da tela "Meus módulos" (RF-CORE-02; RN-CORE-02). Funções puras, testadas em Node.
 * A lista vem do que o aparelho já tem (módulos efetivos gravados no último sync): funciona sem sinal.
 */
import type { ItemOutbox, ModuloId } from '@macuxi/platform-sdk';
import { modulosListaveis } from '../../domain/licencas';

export interface LinhaMeusModulos {
  modulo: ModuloId;
  versao: string;
}

export const VERSAO_DESCONHECIDA = '—';

/** Uma linha por módulo liberado, na ordem recebida (ordem de dependência). O core é módulo interno e não entra na tabela. */
export function linhasMeusModulos(ativos: readonly ModuloId[], versoes: Readonly<Partial<Record<ModuloId, string>>>): LinhaMeusModulos[] {
  return modulosListaveis(ativos).map((modulo) => ({ modulo, versao: versoes[modulo] ?? VERSAO_DESCONHECIDA }));
}

/** Itens da fila rejeitados porque o módulo foi desativado (RN-CORE-02): aparecem como "Não enviado — módulo desativado". */
export function itensNaoEnviadosPorModulo(fila: readonly ItemOutbox[]): ItemOutbox[] {
  return fila.filter((i) => i.situacao === 'modulo_inativo');
}

/** O botão "Entendi" só aparece quando o módulo saiu E há item não enviado esperando confirmação (nada some em silêncio). */
export function podeConfirmarLimpeza(modulo: ModuloId, limpezaPendente: readonly ModuloId[], fila: readonly ItemOutbox[]): boolean {
  if (!limpezaPendente.includes(modulo)) return false;
  // com item ainda por tentar (pendente) o motor ainda vai enviar; só libera quando todos já foram rejeitados/falharam
  return !fila.some((i) => i.modulo === modulo && i.situacao === 'pendente');
}

export const CHAVE_VERSOES = 'meus-modulos:versoes';

/** Lê as versões do corpo de `GET /v1/me/modulos` sem depender do tipo completo (tolerante a lixo). */
export function versoesDaResposta(corpo: unknown): Partial<Record<ModuloId, string>> {
  const modulos = (corpo as { modulos?: Array<{ id?: unknown; versao?: unknown }> } | null)?.modulos;
  const saida: Partial<Record<ModuloId, string>> = {};
  if (!Array.isArray(modulos)) return saida;
  for (const m of modulos) if (typeof m?.id === 'string' && typeof m.versao === 'string') saida[m.id as ModuloId] = m.versao;
  return saida;
}
