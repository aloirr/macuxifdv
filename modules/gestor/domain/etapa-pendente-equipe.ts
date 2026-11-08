/**
 * Aviso da etapa pendente na ficha do cliente do app Gestão (T-0102; docs/design/checkout-pendencia.md §2.2; RN-CORE-12).
 * Dados só do que já chega por contrato ao aparelho do supervisor/gerente:
 *  - visitas da equipe: pull `visita` do Core (`VisitaSync`, escopo `usuarios` = equipe visível, RN-CORE-04), com
 *    `etapas_pendentes` (contagem; `visita_etapa` não vai ao aparelho, então o texto é genérico: "uma etapa");
 *  - nome de quem fez a visita: visão da equipe do Gestor (`nomesDaVisao`).
 * As visitas do PRÓPRIO usuário ficam de fora: para elas vale o Banner do §1.2, que é do Core (texto do vendedor).
 * Datas: `data_local` da visita (dia civil no fuso do tenant, gravado pelo Core). Sem ponto final. Funções puras.
 */
import type { VisitaSync } from '@macuxi/core/contracts';

/** Subconjunto de `VisitaSync` (contracts do Core) que o aviso usa. */
export type VisitaDaEquipe = Pick<VisitaSync, 'id' | 'updated_at' | 'usuario_id' | 'cliente_id' | 'data_local' | 'checkin_em' | 'deleted_at' | 'etapas_pendentes'>;

export interface AvisoEtapaPendenteEquipe {
  /** Linha forte do Banner. */
  linha1: string;
  /** Linha de orientação ao supervisor (sem botão: a fila do supervisor não tem nada a ver com isso). */
  linha2: string;
  /** Visita que originou o aviso (a mais recente entre as pendentes deste cliente). */
  visita_id: string;
  usuario_id: string;
  etapas: number;
}

/** Primeiro nome para o texto ("Rafael Souza" → "Rafael"); vazio → null. */
export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  return p.length > 0 ? p : null;
}

/** `AAAA-MM-DD` → `dd/mm`. */
function diaMes(dataLocal: string): string {
  return `${dataLocal.slice(8, 10)}/${dataLocal.slice(5, 7)}`;
}

/**
 * Visita da equipe mais recente ENTRE as que têm etapa pendente neste cliente (mesma regra do §1.2: uma visita nova sem
 * pendência não esconde a anterior, que continua real até o pull trazer 0). Exclui as do próprio usuário e as removidas.
 */
export function visitaDaEquipeComEtapaPendente(visitas: readonly VisitaDaEquipe[], o: { clienteId: string; usuarioId: string | null | undefined }): VisitaDaEquipe | null {
  let ultima: VisitaDaEquipe | null = null;
  for (const v of visitas) {
    if (v.cliente_id !== o.clienteId || v.deleted_at || (v.etapas_pendentes ?? 0) <= 0) continue;
    if (o.usuarioId && v.usuario_id === o.usuarioId) continue;
    if (!ultima || Date.parse(v.checkin_em) > Date.parse(ultima.checkin_em)) ultima = v;
  }
  return ultima;
}

/**
 * Texto do Banner do §2.2. RN-CORE-04: só supervisor e gerente (a equipe deles); outros perfis → null.
 * Sem o nome na visão do Gestor (membro fora da visão ou visão ainda não sincronizada): texto neutro, sem nome.
 */
export function avisoEtapaPendenteDaEquipe(
  visitas: readonly VisitaDaEquipe[],
  o: { clienteId: string; perfil: string | null | undefined; usuarioId: string | null | undefined; nomes: ReadonlyMap<string, string> },
): AvisoEtapaPendenteEquipe | null {
  if (o.perfil !== 'supervisor' && o.perfil !== 'gerente') return null;
  const v = visitaDaEquipeComEtapaPendente(visitas, o);
  if (!v) return null;
  const etapas = v.etapas_pendentes ?? 0;
  const nome = primeiroNome(o.nomes.get(v.usuario_id));
  const dia = diaMes(v.data_local);
  const daVisita = nome ? `da visita de ${nome} em ${dia}` : `da visita de ${dia}`;
  const linha1 = etapas === 1 ? `Uma etapa ${daVisita} ainda não chegou ao Macuxi` : `${etapas} etapas ${daVisita} ainda não chegaram ao Macuxi`;
  const linha2 = nome ? `Peça a ${nome} para abrir a fila do aparelho e sincronizar` : 'Peça a quem fez a visita para abrir a fila do aparelho e sincronizar';
  return { linha1, linha2, visita_id: v.id, usuario_id: v.usuario_id, etapas };
}
