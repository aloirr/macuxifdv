/**
 * Reprocesso único dos parados (desenho docs/desenho/outbox-parada-v1014.md, §7). Sem banco: a separação entre parados e
 * já tentados, a classe do erro (a mesma do producao-diagnostico-outbox.yml, sem texto livre) e o resumo por classe. A
 * seleção no banco (empresa, publicado, ordem, teto) está em reprocessar-outbox.banco.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { classeDoErro, resumirPorClasse, selecionarParados, TETO_REPROCESSO } from '../src/reprocessar-outbox';

const NO = 'integracao.catalogo_no.atualizado@1';
const PRODUTO = 'integracao.produto.atualizado@1';
const MAX = 10;

describe('selecionarParados: uma vez só', () => {
  it('o que passou do máximo (já reprocessado e parado outra vez) fica fora e é contado à parte', () => {
    const r = selecionarParados(
      [
        { id: 'a', tentativas: MAX + 1 },
        { id: 'b', tentativas: MAX },
      ],
      MAX,
    );
    expect(r.reprocessar.map((e) => e.id)).toEqual(['b']);
    expect(r.jaTentados.map((e) => e.id)).toEqual(['a']);
  });

  it('TETO_REPROCESSO cabe os 36 parados da AM2808 e fica abaixo de 200', () => {
    expect(TETO_REPROCESSO).toBeGreaterThanOrEqual(36);
    expect(TETO_REPROCESSO).toBeLessThanOrEqual(200);
  });
});

describe('classeDoErro: a mesma classe do diagnóstico, sem texto livre', () => {
  it.each([
    [null, '(sem erro)'],
    ['', '(sem erro)'],
    ['catalogo: SQLSTATE 23505, catalogo_no_codigo_uk (nome Fulano)', 'catalogo: SQLSTATE 23505, catalogo_no_codigo_uk'],
    ['catalogo: ReferenciaAusenteErp: referencia_ausente: 1 registro(s) de catalogo_no ainda não chegaram', 'catalogo: ReferenciaAusenteErp'],
    ['integracao: Error: Lote aguardando o lote anterior da mesma entidade', 'integracao: espera da mesma entidade'],
    ['integracao: Error: Lote aguardando a carga de cliente', 'integracao: espera de dependência'],
    ['core: efeito depois do commit: HTTP 403 do FCM', 'core: efeito HTTP 403'],
    ['core: ZodError: dados inválidos', 'core: ZodError'],
    ['vendedor: SQLSTATE 40001 conflito', 'vendedor: SQLSTATE 40001'],
    ['vendedor: Falhou ao gravar o pedido do cliente João', 'vendedor: outro'],
    ['Mensagem Com Nome: x', '?: outro'],
    // só a 1ª falha (antes de " | "), como no diagnóstico
    ['core: ZodError: x | catalogo: SQLSTATE 23505, catalogo_no_codigo_uk', 'core: ZodError'],
  ])('%s → %s', (erro, classe) => {
    expect(classeDoErro(erro)).toBe(classe);
  });

  it('nunca devolve o resto da mensagem (pode ter nome de cliente ou de produto)', () => {
    expect(classeDoErro('catalogo: ErroQualquer: produto KIT RELACAO do cliente Maria')).toBe('catalogo: ErroQualquer');
    expect(classeDoErro('catalogo: produto KIT RELACAO do cliente Maria')).toBe('catalogo: outro');
  });
});

describe('resumirPorClasse', () => {
  it('conta por evento e classe, na ordem de chegada da 1ª ocorrência', () => {
    expect(
      resumirPorClasse([
        { nome: NO, classe: 'catalogo: SQLSTATE 23505, catalogo_no_codigo_uk' },
        { nome: PRODUTO, classe: 'catalogo: ReferenciaAusenteErp' },
        { nome: NO, classe: 'catalogo: SQLSTATE 23505, catalogo_no_codigo_uk' },
        { nome: PRODUTO, classe: 'catalogo: ReferenciaAusenteErp' },
      ]),
    ).toEqual([
      { nome: NO, classe: 'catalogo: SQLSTATE 23505, catalogo_no_codigo_uk', eventos: 2 },
      { nome: PRODUTO, classe: 'catalogo: ReferenciaAusenteErp', eventos: 2 },
    ]);
  });
});
