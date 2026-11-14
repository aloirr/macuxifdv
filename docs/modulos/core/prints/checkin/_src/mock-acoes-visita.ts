// Dublê do registro do check-in: devolve o check-in das 09:12, com ou sem GPS conforme o cenário.
import { C } from './cenario';
import { VISITA_NOVA } from './mock-usar-core';

export const tentarCheckin = async () => ({ kind: 'ok', visit: VISITA_NOVA, gps: C !== 'folha-sem-gps', foraDoRaio: false, sugereCoordenada: false });
