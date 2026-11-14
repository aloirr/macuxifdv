// Cenário do print (?c=...): checkin | checkout | bloqueado | folha-gps | folha-sem-gps | performance | gestao.
// Nomes, endereços e números são fictícios. Hora fixa pelo gerador: 14/11/2026 09:47 em Boa Vista (13:47 UTC).
export const C = new URLSearchParams(location.search).get('c') ?? 'checkin';
export const TZ = 'America/Boa_Vista';
export const EU = '00000000-0000-4000-8000-0000000000a1';
export const ANA = '00000000-0000-4000-8000-0000000000a2';
export const CLIENTE = '00000000-0000-4000-8000-0000000000c1';
export const OUTRO = '00000000-0000-4000-8000-0000000000c2';
export const CHECKIN_EM = '2026-11-14T13:12:00.000Z'; // 09:12 em Boa Vista
