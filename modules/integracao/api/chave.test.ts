import { describe, expect, it } from 'vitest';
import { entradaDeIpValida, gerarChave, hashDaChave, ipPermitido, normalizarIp, pepperValido } from './chave';

const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-bytes';

describe('RN-INT-10: chave do Conector guardada só como HMAC com o pepper do .env', () => {
  it('RN-INT-10: o hash é HMAC-SHA256 em 64 hexadecimais, estável e dependente do pepper', () => {
    const h = hashDaChave(PEPPER, 'mxc_abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDaChave(PEPPER, 'mxc_abc')).toBe(h);
    expect(hashDaChave(`${PEPPER}-outro`, 'mxc_abc')).not.toBe(h);
    expect(hashDaChave(PEPPER, 'mxc_abd')).not.toBe(h);
  });

  it('RN-INT-10: pepper ausente ou com menos de 32 bytes falha fechado', () => {
    expect(pepperValido(undefined)).toBe(false);
    expect(pepperValido('curto')).toBe(false);
    expect(pepperValido('x'.repeat(31))).toBe(false);
    expect(pepperValido('x'.repeat(32))).toBe(true);
  });

  it('RN-INT-10: a chave gerada tem formato Bearer válido (16 a 512 sem espaço), prefixo de 8 e nunca repete', () => {
    const a = gerarChave();
    const b = gerarChave();
    expect(a.chave).toMatch(/^mxc_[A-Za-z0-9_-]{43}$/);
    expect(a.prefixo).toBe(a.chave.slice(0, 8));
    expect(a.prefixo).toMatch(/^[A-Za-z0-9_-]{4,12}$/);
    expect(a.chave).not.toBe(b.chave);
  });
});

describe('RN-INT-10: lista de IPs do Conector', () => {
  it('RN-INT-10: lista vazia aceita qualquer IP com chave válida', () => {
    expect(ipPermitido([], '198.51.100.7')).toBe(true);
  });

  it('RN-INT-10: IP puro (o Postgres devolve /32) e CIDR; fora da lista é negado', () => {
    expect(ipPermitido(['203.0.113.0/24'], '203.0.113.5')).toBe(true);
    expect(ipPermitido(['203.0.113.0/24'], '203.0.114.5')).toBe(false);
    expect(ipPermitido(['198.51.100.7/32'], '198.51.100.7')).toBe(true);
    expect(ipPermitido(['198.51.100.7'], '198.51.100.8')).toBe(false);
  });

  it('RN-INT-10: IPv4 mapeado em IPv6 vale como o IPv4; IP ilegível é negado quando há lista', () => {
    expect(normalizarIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(ipPermitido(['203.0.113.0/24'], '::ffff:203.0.113.5')).toBe(true);
    expect(ipPermitido(['203.0.113.0/24'], 'nao-e-ip')).toBe(false);
  });

  it('RN-INT-10: entrada ilegível na lista nunca libera nada', () => {
    expect(ipPermitido(['lixo', '10.0.0.0/99'], '10.0.0.1')).toBe(false);
  });

  it('RN-INT-10: validação do cadastro aceita IP e CIDR dentro da faixa', () => {
    for (const ok of ['203.0.113.5', '203.0.113.0/24', '2001:db8::1', '2001:db8::/32']) expect(entradaDeIpValida(ok)).toBe(true);
    for (const ruim of ['', 'x', '1.2.3.4/33', '1.2.3.4/', '1.2.3.4/1/2', '999.1.1.1']) expect(entradaDeIpValida(ruim)).toBe(false);
  });
});
