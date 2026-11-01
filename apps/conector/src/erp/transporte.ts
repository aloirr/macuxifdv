/**
 * Aviso de transporte sem criptografia para o banco do ERP. Dentro da rede do cliente o tráfego sem TLS é aceitável (o padrão do
 * Conector é `criptografar: true`); para um host FORA de localhost/LAN, a senha do ERP e os dados trafegariam em claro, então
 * `testar-conexao` e o início do serviço avisam e sugerem `criptografar: true` (PostgreSQL `ssl`, SQL Server `encrypt`, Oracle `tcps`).
 * É só um aviso: não muda o padrão nem impede a conexão.
 */
import { isIP } from 'node:net';

/** `localhost`, loopback, faixas privadas (RFC 1918/4193), link-local, nomes sem ponto (NetBIOS) e sufixos de rede interna. */
export function hostEhLocalOuLan(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const familia = isIP(h);
  if (familia === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (familia === 6) return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  if (!h.includes('.')) return true; // nome curto da rede local (ex.: SRV-ERP)
  return /\.(local|lan|intranet|internal|corp|home|localdomain)$/.test(h);
}

/** Mensagem de aviso, ou `null` se não há o que avisar (TLS ligado ou host local/LAN). */
export function avisoTransporteErp(erp: { host: string; criptografar: boolean }): string | null {
  if (erp.criptografar || hostEhLocalOuLan(erp.host)) return null;
  return 'O banco do ERP está fora de localhost/LAN e a criptografia está desligada (erp.criptografar: false): a senha do ERP e os dados trafegam em claro. Sugestão: use "criptografar": true (PostgreSQL ssl, SQL Server encrypt, Oracle tcps) ou mantenha o ERP numa rede privada/VPN.';
}
