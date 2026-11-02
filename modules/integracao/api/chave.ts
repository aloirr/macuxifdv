/**
 * Chave de API do Conector (RN-INT-10): gerada no Hub, mostrada uma vez, guardada só como HMAC-SHA256(pepper, chave) em hex.
 * O pepper vem do `.env` (`MACUXI_HUB_CHAVE_PEPPER`, ≥ 32 bytes); sem ele o Hub falha fechado (503).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export const PEPPER_MIN_BYTES = 32;

/** `true` se o pepper existe e tem o tamanho mínimo (em bytes UTF-8). */
export function pepperValido(pepper: string | undefined): pepper is string {
  return typeof pepper === 'string' && Buffer.byteLength(pepper, 'utf8') >= PEPPER_MIN_BYTES;
}

/** HMAC-SHA256(pepper, chave) em 64 hexadecimais (o que `integracao.credencial.hash_chave` guarda). */
export function hashDaChave(pepper: string, chave: string): string {
  return createHmac('sha256', pepper).update(chave, 'utf8').digest('hex');
}

/** Chave nova: `mxc_` + 32 bytes aleatórios em base64url (47 caracteres). O prefixo (8 primeiros) identifica a chave no BKO e nos logs. */
export function gerarChave(): { chave: string; prefixo: string } {
  const chave = `mxc_${randomBytes(32).toString('base64url')}`;
  return { chave, prefixo: chave.slice(0, 8) };
}

/** IPv4 mapeado em IPv6 (`::ffff:203.0.113.5`) vira o IPv4. */
export function normalizarIp(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

/** Aceita IP puro (`203.0.113.5`) ou CIDR (`203.0.113.0/24`). */
export function entradaDeIpValida(texto: string): boolean {
  const [ip, prefixo, ...resto] = texto.trim().split('/');
  if (resto.length > 0 || !ip) return false;
  const familia = isIP(ip);
  if (familia === 0) return false;
  if (prefixo === undefined) return true;
  if (!/^\d{1,3}$/.test(prefixo)) return false;
  return Number(prefixo) <= (familia === 4 ? 32 : 128);
}

/**
 * Lista de IPs/CIDRs do Conector (`inet[]::text[]`: o Postgres devolve `203.0.113.5/32` para IP puro). Lista vazia = qualquer IP com
 * chave válida. Entrada ilegível nunca libera: é ignorada (a lista continua restringindo).
 */
export function ipPermitido(lista: readonly string[], ip: string): boolean {
  if (lista.length === 0) return true;
  const alvo = normalizarIp(ip);
  const familiaAlvo = isIP(alvo);
  if (familiaAlvo === 0) return false;
  const bloqueio = new BlockList();
  for (const bruto of lista) {
    if (!entradaDeIpValida(bruto)) continue;
    const [endereco, prefixo] = bruto.trim().split('/') as [string, string | undefined];
    const familia = isIP(endereco) === 4 ? 'ipv4' : 'ipv6';
    if (prefixo === undefined) bloqueio.addAddress(endereco, familia);
    else bloqueio.addSubnet(endereco, Number(prefixo), familia);
  }
  return bloqueio.check(alvo, familiaAlvo === 4 ? 'ipv4' : 'ipv6');
}
