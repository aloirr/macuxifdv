/** Datas civis (AAAA-MM-DD) para seeds e fixtures com datas relativas a "hoje" no fuso do tenant. */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje (AAAA-MM-DD) no fuso IANA dado (ex.: America/Manaus). */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

function validar(data: string): void {
  if (!DATA.test(data)) throw new Error(`data inválida (esperado AAAA-MM-DD): ${data}`);
}

/** data + n dias (n pode ser negativo). */
export function somarDias(data: string, n: number): string {
  validar(data);
  const [y, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** AAAA-MM do mês de `data` deslocado de n meses (n negativo = meses atrás). */
export function anoMes(data: string, n = 0): string {
  validar(data);
  const [y, m] = data.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Instante UTC ISO (`AAAA-MM-DDTHH:MM:00Z`) para a data civil e a hora UTC dadas. */
export function instante(data: string, horaUtc: string): string {
  validar(data);
  if (!/^\d{2}:\d{2}$/.test(horaUtc)) throw new Error(`hora inválida (esperado HH:MM): ${horaUtc}`);
  return `${data}T${horaUtc}:00Z`;
}

/** Menor de duas datas civis. */
export function menorData(x: string, y: string): string {
  return x <= y ? x : y;
}
