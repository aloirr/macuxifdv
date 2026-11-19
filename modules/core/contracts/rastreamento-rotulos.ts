/**
 * Rótulos do estado do rastreamento (T-0156; desenho §9; spec `docs/design/tracking/spec.md` §2): o mesmo texto no chip do Perfil do
 * Campo e na linha do Diagnóstico do shell. Um texto por motivo do portão fechado e um para "ativa". Sem coordenada.
 */
import type { MotivoSemRastreio } from './trajeto';

export const ROTULO_ESTADO_RASTREAMENTO: Readonly<Record<'ativa' | MotivoSemRastreio, string>> = {
  ativa: 'Ativa',
  pausa: 'Pausada',
  fora_do_expediente: 'Fora do expediente',
  sem_termo: 'Sem termo',
  sem_aceite: 'Sem aceite do termo',
  desligado: 'Desligado pela empresa',
  cargo: 'Cargo não rastreado',
  app: 'App não rastreado',
  feriado: 'Feriado',
  ausencia: 'Ausência',
  sem_permissao: 'Sem permissão de localização',
};
