import { describe, expect, it } from 'vitest';
import type { MembroComPainel } from '../../contracts';
import { contarParados, duracaoCurta, linhasAgora } from './equipe-agora';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = '2026-11-04T18:00:00.000Z';
const ha = (min: number) => new Date(Date.parse(AGORA) - min * 60_000).toISOString();
const visitas = { planejadas: 6, realizadas: 2, planejadas_realizadas: 2, visitas_extras: 0, tempo_total_min: 40, tempo_medio_min: 20, curtas: 0, cobertura_pct: 33 };

function membro(n: number, nome: string, painel: Record<string, unknown>): MembroComPainel {
  return {
    membro: { id: id(n), nome, perfil: 'vendedor', superior_id: null, ativo: true },
    painel: { usuario_id: id(n), perfil: 'vendedor', data: '2026-11-04', status_dia: 'em_rota', visitas, vendas: null, faturamento: null, mes: null, trade: null, pesquisa: null, treinamento: null, calculado_em: AGORA, ...painel },
  } as unknown as MembroComPainel;
}

describe('T-0073 / RN-CORE-26: Equipe agora na aba Equipe do Gestão', () => {
  it('RN-CORE-26: 60 min sem check-in depois do último checkout, com paradas pendentes → "Parado" com o tempo', () => {
    const [l] = linhasAgora({ membros: [membro(1, 'Lucas', { paradas_planejadas: 6, paradas_pendentes: 4, ultimo_checkout_em: ha(100) })] }, AGORA);
    expect(l).toMatchObject({ status: 'parado', label: 'Parado', tom: 'aviso', detalhe: 'Sem check-in há 1h40' });
  });

  it('RN-CORE-26: 59 min ainda é "Em rota"; o limite vem de inicio.parado_min da visão', () => {
    const m = membro(1, 'Lucas', { paradas_planejadas: 6, paradas_pendentes: 4, ultimo_checkout_em: ha(59) });
    expect(linhasAgora({ membros: [m] }, AGORA)[0]!.status).toBe('em_rota');
    expect(linhasAgora({ membros: [m], parado_min: 30 }, AGORA)[0]!.status).toBe('parado');
  });

  it('RN-CORE-26: ordem parado, sem check-in, em rota, em visita, rota concluída; por nome dentro do status', () => {
    const membros = [
      membro(1, 'Zeca', { status_dia: 'em_visita' }),
      membro(2, 'Bia', { status_dia: 'sem_checkin' }),
      membro(3, 'Ana', { paradas_planejadas: 2, paradas_pendentes: 0, ultimo_checkout_em: ha(10) }),
      membro(4, 'Caio', { paradas_planejadas: 6, paradas_pendentes: 3, ultimo_checkout_em: ha(10) }),
      membro(5, 'Davi', { paradas_planejadas: 6, paradas_pendentes: 3, ultimo_checkout_em: ha(90) }),
      membro(6, 'Alice', { paradas_planejadas: 6, paradas_pendentes: 3, ultimo_checkout_em: ha(70) }),
    ];
    const r = linhasAgora({ membros }, AGORA);
    expect(r.map((x) => `${x.status}:${x.m.membro.nome}`)).toEqual(['parado:Alice', 'parado:Davi', 'sem_checkin:Bia', 'em_rota:Caio', 'em_visita:Zeca', 'rota_concluida:Ana']);
    expect(contarParados(r)).toBe(2);
  });

  it('RN-CORE-26: sem check-in hoje não é "parado" (sem expediente nem GPS) e diz isso', () => {
    const [l] = linhasAgora({ membros: [membro(1, 'Bia', { status_dia: 'sem_checkin' })] }, '2026-11-04T23:00:00.000Z');
    expect(l).toMatchObject({ status: 'sem_checkin', detalhe: 'Sem check-in hoje' });
  });

  it('duração curta: minutos, horas cheias e horas com minutos', () => {
    expect([45, 60, 100, 120].map(duracaoCurta)).toEqual(['45 min', '1h', '1h40', '2h']);
  });
});
