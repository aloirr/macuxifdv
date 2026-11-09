/**
 * Mapeamento puro dos registros do ERP (`integracao.<entidade>.atualizado@1`) para o modelo do Core (T-0066; RN-INT-02/04/06).
 * Sem acesso a banco: os consumidores de `api/consumidores-erp*.ts` só executam o que sai daqui.
 */
import { ehEmail } from '@macuxi/comum/email';
import { somarDiasCivis } from '@macuxi/comum/relogio';

export type SituacaoTituloCore = 'aberto' | 'liquidado' | 'cancelado';

/** Situação do título no Hub (`baixado`) → coluna `core.titulo.situacao` (`liquidado`). */
export function situacaoTituloDoErp(s: 'aberto' | 'baixado' | 'cancelado'): SituacaoTituloCore {
  return s === 'baixado' ? 'liquidado' : s;
}

/**
 * E-mail do usuário vendedor vindo do ERP. `core.usuario.email` é obrigatório e único: sem e-mail válido, usa um
 * provisório estável (derivado do `external_id`, domínio `.invalid`); o convite/ativação pelo BKO troca por um real.
 */
export function emailDoVendedorErp(email: string | null | undefined, externalId: string): { email: string; provisorio: boolean } {
  const limpo = (email ?? '').trim().toLowerCase();
  if (ehEmail(limpo)) return { email: limpo, provisorio: false };
  const hex = [...new TextEncoder().encode(externalId)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { email: `erp-${hex}@sem-email.invalid`, provisorio: true };
}

/**
 * Datas (AAAA-MM-DD, calendário do tenant) em que a rota do ERP é materializada em `core.rota`: as próximas `semanas`
 * ocorrências do `dia_semana` (0=domingo..6=sábado), a partir de `hoje` inclusive. Sem dia fixo: só hoje.
 */
export function datasDaRotaErp(diaSemana: number | null | undefined, hoje: string, semanas = 4): string[] {
  if (diaSemana === null || diaSemana === undefined) return [hoje];
  const atual = new Date(`${hoje}T00:00:00Z`).getUTCDay();
  const primeira = somarDiasCivis(hoje, (diaSemana - atual + 7) % 7);
  return Array.from({ length: Math.max(1, semanas) }, (_, i) => somarDiasCivis(primeira, i * 7));
}

export interface ParadaErp {
  ordem: number;
  cliente_external_id: string;
}

/** Paradas por `ordem`, um cliente por rota (vale a última citação, como o `duplicado_no_lote`) e sequência 1..n. */
export function planejarParadasErp(paradas: readonly ParadaErp[]): Array<{ sequencia: number; cliente_external_id: string }> {
  const ultima = new Map<string, number>();
  paradas.forEach((p, i) => ultima.set(p.cliente_external_id, i));
  return paradas
    .filter((p, i) => ultima.get(p.cliente_external_id) === i)
    .sort((a, b) => a.ordem - b.ordem)
    .map((p, i) => ({ sequencia: i + 1, cliente_external_id: p.cliente_external_id }));
}
