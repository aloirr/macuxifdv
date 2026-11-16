/**
 * "Equipe agora" na aba Equipe (T-0073, RN-CORE-26): aplica a regra de "parado" com o relógio do aparelho sobre o painel
 * do dia que está no cache e ordena como o desenho manda (parado, sem check-in, em rota, em visita, rota concluída; por
 * nome dentro de cada status). Só apresentação: a regra mora no domain (`statusAgora`).
 */
import { duracaoCurta } from '@macuxi/core/contracts';
import type { TomEstado } from '@macuxi/ui/mobile/puro';
import type { MembroComPainel, VisaoEquipe } from '../../contracts';
import { ORDEM_STATUS_AGORA, statusAgora, type StatusAgora } from '../../domain/agora-status';

/** Padrão do tenant quando a visão não traz `parado_min` (doc 03: `inicio.parado_min` = 60). */
export const PARADO_MIN_PADRAO = 60;

export const STATUS_AGORA_ROTULO: Readonly<Record<StatusAgora, { label: string; tom: TomEstado }>> = {
  parado: { label: 'Parado', tom: 'aviso' },
  sem_checkin: { label: 'Sem check-in', tom: 'aviso' },
  em_rota: { label: 'Em rota', tom: 'destaque' },
  em_visita: { label: 'Em visita', tom: 'sucesso' },
  rota_concluida: { label: 'Rota concluída', tom: 'sucesso' },
};


export interface LinhaAgora {
  m: MembroComPainel;
  status: StatusAgora;
  label: string;
  tom: TomEstado;
}

export function linhasAgora(visao: Pick<VisaoEquipe, 'membros' | 'parado_min'>, agora: string): LinhaAgora[] {
  const parado_min = visao.parado_min ?? PARADO_MIN_PADRAO;
  const linhas = visao.membros.map((m): LinhaAgora => {
    const p = m.painel;
    const r = statusAgora({
      status_dia: p.status_dia,
      paradas_planejadas: p.paradas_planejadas,
      paradas_pendentes: p.paradas_pendentes,
      ultimo_checkout_em: p.ultimo_checkout_em,
      parado_min,
      agora,
    });
    const rot = STATUS_AGORA_ROTULO[r.status];
    // RD-0208: o tempo vai na tag ("Parado 1 h 40 min", `duracaoCurta` do Core, RD-1862); sem 3ª linha repetindo "Sem check-in"
    const label = r.status === 'parado' && r.minutos_sem_atividade !== null ? `${rot.label} ${duracaoCurta(r.minutos_sem_atividade)}` : rot.label;
    return { m, status: r.status, label, tom: rot.tom };
  });
  return linhas.sort((a, b) => ORDEM_STATUS_AGORA[a.status] - ORDEM_STATUS_AGORA[b.status] || a.m.membro.nome.localeCompare(b.m.membro.nome, 'pt-BR'));
}

export function contarParados(linhas: readonly LinhaAgora[]): number {
  return linhas.filter((l) => l.status === 'parado').length;
}
