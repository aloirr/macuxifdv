/**
 * T-0059 (R-20261102-091336 e R-20261102-090919): quando a tela de carga deixa o usuário entrar e quando o shell
 * dispara uma sincronização. Funções puras (rodam em Node nos testes): a navegação depende do ESTADO do motor,
 * nunca da promessa de `sincronizar()` (que pode resolver com a tela desmontada ou o app em segundo plano).
 */
import type { EstadoMotorSync } from '@macuxi/platform-sdk';

/** Sincronização completa automática: a cada 15 min e ao voltar ao app depois disso. */
export const INTERVALO_SYNC_MS = 15 * 60_000;
/** Tentativa iniciada há menos que isto não é repetida sozinha (o erro fica na tela com "Tentar de novo"). */
export const JANELA_TENTATIVA_RECENTE_MS = 60_000;

export type EstadoCarga = Pick<EstadoMotorSync, 'sincronizando' | 'sincronizado_em' | 'erro' | 'progresso'> & {
  /** Posição da carga no motor (T-0059, ADR 0017); ausente = só o `progresso` do motor. */
  carga?: Pick<EstadoMotorSync['carga'], 'entidade' | 'concluidas' | 'total' | 'paginas' | 'retomada'>;
};

/**
 * - `entrar`: há carga completa gravada e nada em andamento (ou a carga já existia quando a tela abriu: a
 *   sincronização segue em segundo plano e o usuário não fica preso).
 * - `erro`: a última tentativa parou e não há carga para usar.
 * - `carregando`: em andamento ou ainda não começou.
 */
export type SituacaoCarga = 'entrar' | 'erro' | 'carregando';

export function situacaoDaCarga(estado: EstadoCarga, opcoes: { tinhaCarga: boolean }): SituacaoCarga {
  if (estado.sincronizado_em && (!estado.sincronizando || opcoes.tinhaCarga)) return 'entrar';
  if (estado.erro && !estado.sincronizando) return 'erro';
  return 'carregando';
}

/** Parte da fatia de uma entidade que as páginas já gravadas podem preencher (nunca a fatia toda: ela fecha ao concluir). */
const TETO_FRACAO_PAGINAS = 0.9;

/**
 * Percentual exibido (0..100), proporcional ao que já está gravado (T-0059): `progresso` do motor (entidades e etapas
 * concluídas, contando as puladas na retomada: nunca volta a 0) mais uma fração da entidade em andamento pelas páginas
 * gravadas (`paginas / (paginas + 3)`, até 90% da fatia), para a barra andar nas entidades grandes. Com a carga pronta,
 * sempre 100; carregando, no máximo 99.
 */
export function percentualDaCarga(estado: EstadoCarga, situacao: SituacaoCarga): number {
  if (situacao === 'entrar') return 100;
  let p = estado.progresso;
  const c = estado.carga;
  if (situacao === 'carregando' && estado.sincronizando && c && c.total > 0 && c.entidade && c.paginas > 0)
    p += Math.min(TETO_FRACAO_PAGINAS, c.paginas / (c.paginas + 3)) / c.total;
  const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
  return situacao === 'carregando' ? Math.min(99, pct) : pct;
}

/**
 * Por que o shell quer sincronizar:
 * - `abertura`: o app abriu com sessão e carga gravada (vai direto ao Início; sincroniza em segundo plano);
 * - `periodico`: o relógio de 15 min com o app aberto;
 * - `volta`: o app voltou do segundo plano (AppState background → active);
 * - `tela-carga`: a tela de carga montou (primeiro acesso, ou remontou no meio da carga).
 */
export type MotivoSync = 'abertura' | 'periodico' | 'volta' | 'tela-carga';

export interface ContextoDecisaoSync {
  estado: Pick<EstadoMotorSync, 'sincronizando' | 'sincronizado_em'>;
  /** Uma sincronização do shell já está em curso (inclui a fase antes do motor marcar `sincronizando`). */
  emCurso: boolean;
  /** Quando o shell iniciou a última sincronização (ms), nesta execução do app. */
  ultimoInicio: number | null;
  agora: number;
}

/**
 * R-20261102-090919 item 2: voltar do segundo plano (ou remontar a tela de carga) não reinicia a carga em andamento
 * nem a que terminou há pouco. Sem carga completa e sem tentativa recente, sincroniza: o motor retoma de onde parou.
 */
export function deveSincronizar(motivo: MotivoSync, c: ContextoDecisaoSync): boolean {
  if (c.emCurso || c.estado.sincronizando) return false;
  if (motivo === 'abertura' || motivo === 'periodico') return true;
  if (c.estado.sincronizado_em) {
    const idade = c.agora - Date.parse(c.estado.sincronizado_em);
    return !(idade >= 0 && idade < INTERVALO_SYNC_MS);
  }
  return !(c.ultimoInicio !== null && c.agora - c.ultimoInicio < JANELA_TENTATIVA_RECENTE_MS);
}
