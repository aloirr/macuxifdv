import { describe, expect, it } from 'vitest';
import type { MembroEquipe } from '../contracts';
import { avaliarAlertas, resolverRegras } from './alertas';
import { visitaContaParaCampo } from './equipe';
import { CLIENTE_A, checkin, ev, GERENTE, SUPERVISOR, u, VENDEDOR } from './fixtures';
import { montarPainelDia } from './painel';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const membro = (id: string, perfil: MembroEquipe['perfil'], superior_id: string | null): MembroEquipe => ({ id, nome: perfil, perfil, superior_id, ativo: true });
const MEMBROS = [membro(GERENTE, 'gerente', null), membro(SUPERVISOR, 'supervisor', GERENTE), membro(VENDEDOR, 'vendedor', SUPERVISOR)];
const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const DIA = '2026-10-30';
const AGORA = '2026-10-30T20:00:00Z';
const carteira = ev('core.cliente.atualizado@1', '2026-09-01T10:00:00Z', { cliente_id: CLIENTE_A, campos: ['vendedor_id'], origem: 'erp', vendedor_id: VENDEDOR, ativo: true, nome: 'Mercado A', frequencia_visita: 'semanal' });
const CTX = { modulos: new Set(['core', 'vendedor']), agora: AGORA };

describe('RN-GES-05 (T-0187, P2 A): visita de supervisor ou gerente não conta como visita de campo', () => {
  it('RN-GES-05: check-in de usuário supervisor ou gerente não conta; cadastro sem o usuário não bloqueia', () => {
    expect(visitaContaParaCampo(MEMBROS, VENDEDOR)).toBe(true);
    expect(visitaContaParaCampo(MEMBROS, SUPERVISOR)).toBe(false);
    expect(visitaContaParaCampo(MEMBROS, GERENTE)).toBe(false);
    expect(visitaContaParaCampo(MEMBROS, u(999))).toBe(true);
  });

  it('RN-GES-05: o check-in do supervisor no cliente do vendedor não entra nas visitas nem na cobertura do vendedor', () => {
    const s = montar([carteira, checkin({ visita: u(1), usuario: SUPERVISOR, cliente: CLIENTE_A, em: `${DIA}T13:00:00Z` })]);
    const v = montarPainelDia(s, { id: VENDEDOR, perfil: 'vendedor' }, DIA, CTX);
    expect(v.visitas.realizadas).toBe(0);
    expect(v.visitas.planejadas_realizadas).toBe(0);
  });

  it('RN-GES-05: a visita do supervisor não vale para a meta de visitas dele mesmo (cargo fora do campo)', () => {
    const s = montar([carteira, checkin({ visita: u(1), usuario: SUPERVISOR, cliente: CLIENTE_A, em: `${DIA}T13:00:00Z` })]);
    expect(montarPainelDia(s, { id: SUPERVISOR, perfil: 'supervisor' }, DIA, CTX).visitas.realizadas).toBe(0);
  });

  it('RN-GES-01/05: a visita do supervisor não encerra o alerta de cliente sem visita; a do vendedor encerra', () => {
    const antiga = checkin({ visita: u(1), usuario: VENDEDOR, cliente: CLIENTE_A, em: '2026-09-20T13:00:00Z' });
    const alertas = (visitante: string) =>
      avaliarAlertas({ estado: montar([carteira, antiga, checkin({ visita: u(2), usuario: visitante, cliente: CLIENTE_A, em: '2026-10-29T13:00:00Z' })]), membros: MEMBROS, agora: AGORA, modulos: new Set(['core']), regras: resolverRegras() }).filter(
        (c) => c.tipo === 'cliente_sem_visita',
      );
    expect(alertas(SUPERVISOR)).toHaveLength(1); // a última visita de campo foi há 40 dias (limite semanal: 10)
    expect(alertas(VENDEDOR)).toHaveLength(0);
  });
});
