import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cargaAcesso, cargaNovaSenha, ID_ENVIO, ID_ENVIO_2, TENANT, TENANT_2, vazamentos } from './apoio-teste';
import { criarCifraEmail, type AadEmail } from './cifra';
import { derivarChaveEmail } from './config';
import { ErroEmail } from './erros';

const cifra = criarCifraEmail(derivarChaveEmail('j'.repeat(40)));
const aad: AadEmail = { id: ID_ENVIO, tenant_id: TENANT, modelo: 'acesso_inicial' };

function codigoDoErro(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ErroEmail);
    expect((e as ErroEmail).retentavel).toBe(false);
    return (e as ErroEmail).codigo;
  }
  return 'sem erro';
}

describe('cifra da carga da outbox (AES-256-GCM, chave HKDF do JWT, desenho T-0094 §10)', () => {
  it('ida e volta, sem nenhum valor sensível nos bytes cifrados', () => {
    const c = cifra.cifrar(cargaAcesso, aad);
    expect(c[0]).toBe(0x01);
    expect(vazamentos(c.toString('latin1'))).toEqual([]);
    expect(cifra.decifrar(c, aad)).toEqual(cargaAcesso);
    const aadNova: AadEmail = { ...aad, modelo: 'nova_senha' };
    expect(cifra.decifrar(cifra.cifrar(cargaNovaSenha, aadNova), aadNova)).toEqual(cargaNovaSenha);
  });

  it('IV aleatório: a mesma carga cifra diferente', () => {
    expect(cifra.cifrar(cargaAcesso, aad).equals(cifra.cifrar(cargaAcesso, aad))).toBe(false);
  });

  it('adulteração de qualquer byte: EMAIL_CIFRA_INVALIDA', () => {
    const c = cifra.cifrar(cargaAcesso, aad);
    for (const i of [1, 14, 30, c.length - 1]) {
      const ruim = Buffer.from(c);
      ruim[i] = ruim[i]! ^ 0xff;
      expect(codigoDoErro(() => cifra.decifrar(ruim, aad))).toBe('EMAIL_CIFRA_INVALIDA');
    }
  });

  it('AAD = id|tenant|modelo: carga de outra linha, de outro tenant ou de outro modelo não decifra', () => {
    const c = cifra.cifrar(cargaAcesso, aad);
    expect(codigoDoErro(() => cifra.decifrar(c, { ...aad, id: ID_ENVIO_2 }))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar(c, { ...aad, tenant_id: TENANT_2 }))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar(c, { ...aad, modelo: 'nova_senha' }))).toBe('EMAIL_CIFRA_INVALIDA');
  });

  it('outro segredo do JWT ou formato estranho: recusado', () => {
    const c = cifra.cifrar(cargaAcesso, aad);
    expect(codigoDoErro(() => criarCifraEmail(derivarChaveEmail('k'.repeat(40))).decifrar(c, aad))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar(Buffer.from([0x02, ...c.subarray(1)]), aad))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar(Buffer.from('lixo'), aad))).toBe('EMAIL_CIFRA_INVALIDA');
  });

  it('decifrado que não valida (ou incoerente com o modelo): recusado', () => {
    const invalida = { ...cargaAcesso, para: 'x' };
    expect(codigoDoErro(() => cifra.decifrar(cifra.cifrar(invalida, aad), aad))).toBe('EMAIL_CIFRA_INVALIDA');
    // nova_senha sem motivo
    const aadNova: AadEmail = { ...aad, modelo: 'nova_senha' };
    expect(codigoDoErro(() => cifra.decifrar(cifra.cifrar(cargaAcesso, aadNova), aadNova))).toBe('EMAIL_CIFRA_INVALIDA');
  });

  it('chave que não tem 32 bytes: erro de configuração', () => {
    expect(() => criarCifraEmail(randomBytes(16))).toThrowError(/32 bytes/);
  });
});
