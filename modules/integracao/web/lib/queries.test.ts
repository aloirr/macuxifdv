import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chaveDoCacheIntegracao, chavesAposMapeamento, codigoDoErro, paraAFila, qk } from './queries';

class ErroComCode extends Error {
  constructor(readonly code: string) {
    super('x');
  }
}
class ErroComCodigo extends Error {
  constructor(readonly codigo: string) {
    super('x');
  }
}

describe('consultas do monitor com o cliente do BKO ou do portal (empresa-zerar §6.4)', () => {
  it('RN-INT-16: o código do erro vem de `code` (BKO) ou de `codigo` (portal), e o erro do próprio lote não para a fila', () => {
    expect(codigoDoErro(new ErroComCode('senha_incorreta'))).toBe('senha_incorreta');
    expect(codigoDoErro(new ErroComCodigo('conteudo_expirado'))).toBe('conteudo_expirado');
    expect(codigoDoErro('texto')).toBe('');
    expect(paraAFila(new ErroComCodigo('conteudo_expirado'))).toBe(false);
    expect(paraAFila(new ErroComCodigo('http_503'))).toBe(true);
  });

  it('RF-INT-04: o cache é separado por cliente e a chave do portal cobre o monitor, os detalhes e os erros da empresa', () => {
    const prefixo = chaveDoCacheIntegracao('portal:t1');
    for (const k of [qk.monitor('portal:t1'), qk.detalhes('portal:t1'), qk.erros('portal:t1', 'l', ''), qk.autorizadores('portal:t1')]) expect(k.slice(0, 2)).toEqual([...prefixo]);
    expect(qk.monitor('bko')).not.toEqual(qk.monitor('portal:t1'));
  });
});

describe('chaves com o escopo do cliente (engenheiro-apps v1.0.31)', () => {
  const fonte = readFileSync(new URL('./queries.ts', import.meta.url), 'utf8');

  it('RN-CORE-23: o `sync_auto_min` lido de `/v1/me/modulos` fica no cache do escopo do cliente', () => {
    expect(qk.syncAutoMin('portal:t1').slice(0, 2)).toEqual([...chaveDoCacheIntegracao('portal:t1')]);
    expect(qk.syncAutoMin('bko')).not.toEqual(qk.syncAutoMin('portal:t1'));
    expect(fonte).toMatch(/queryKey: qk\.syncAutoMin\(cliente\.escopo\)/);
    expect(fonte).not.toMatch(/\['integracao', 'sync-auto-min'\]/);
  });

  it('T-0120: gravar ou apagar mapeamento invalida o de-para e o monitor do escopo do cliente, não só o do BKO', () => {
    expect(chavesAposMapeamento('portal:t1')).toEqual([qk.mapeamentos, qk.monitor('portal:t1')]);
    expect(chavesAposMapeamento('bko')[1]).toEqual(qk.monitor('bko'));
    expect(fonte).not.toMatch(/ESCOPO_BKO/);
  });
});
