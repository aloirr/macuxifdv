import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ID_ENVIO, ID_ENVIO_2, pedidoAcesso, pedidoNovaSenha, vazamentos } from './apoio-teste';
import { criarCifraEmail } from './cifra';
import { ErroEmail } from './erros';

const cifra = criarCifraEmail(randomBytes(32));

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

describe('cifra da carga da fila (AES-256-GCM)', () => {
  it('ida e volta, sem nenhum valor sensível no texto cifrado', () => {
    for (const p of [pedidoAcesso, pedidoNovaSenha]) {
      const c = cifra.cifrar(p, ID_ENVIO);
      expect(c).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(vazamentos(c)).toEqual([]);
      expect(cifra.decifrar(c, ID_ENVIO)).toEqual(p);
    }
  });

  it('IV aleatório: o mesmo pedido cifra diferente', () => {
    expect(cifra.cifrar(pedidoAcesso, ID_ENVIO)).not.toBe(cifra.cifrar(pedidoAcesso, ID_ENVIO));
  });

  it('adulteração do cifrado, da tag ou do IV: EMAIL_CIFRA_INVALIDA', () => {
    const c = cifra.cifrar(pedidoAcesso, ID_ENVIO);
    const [v, iv, tag, dados] = c.split('.') as [string, string, string, string];
    const virar = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    for (const ruim of [[v, iv, tag, virar(dados)], [v, iv, virar(tag), dados], [v, virar(iv), tag, dados]]) {
      expect(codigoDoErro(() => cifra.decifrar(ruim.join('.'), ID_ENVIO))).toBe('EMAIL_CIFRA_INVALIDA');
    }
  });

  it('carga de outro job (AAD = idEnvio), outra chave ou formato estranho: recusada', () => {
    const c = cifra.cifrar(pedidoAcesso, ID_ENVIO);
    expect(codigoDoErro(() => cifra.decifrar(c, ID_ENVIO_2))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => criarCifraEmail(randomBytes(32)).decifrar(c, ID_ENVIO))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar('v2.a.b.c', ID_ENVIO))).toBe('EMAIL_CIFRA_INVALIDA');
    expect(codigoDoErro(() => cifra.decifrar('lixo', ID_ENVIO))).toBe('EMAIL_CIFRA_INVALIDA');
  });

  it('decifrado que não valida (pedido inválido cifrado com a chave certa): recusado', () => {
    const invalido = { ...pedidoAcesso, destinatario: { email: 'x', nome: 'y' } } as typeof pedidoAcesso;
    expect(codigoDoErro(() => cifra.decifrar(cifra.cifrar(invalido, ID_ENVIO), ID_ENVIO))).toBe('EMAIL_CIFRA_INVALIDA');
  });

  it('chave que não tem 32 bytes: erro de configuração', () => {
    expect(() => criarCifraEmail(randomBytes(16))).toThrowError(/32 bytes/);
  });
});
