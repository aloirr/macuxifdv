/**
 * Reprocesso único dos eventos parados da outbox de UMA empresa (workflow producao-reprocessar-outbox.yml; desenho
 * docs/desenho/outbox-parada-v1014.md, §7). Sem banco: a seleção, a regra de "não tentar de novo", a classe do erro (a mesma
 * do producao-diagnostico-outbox.yml, sem texto livre) e o resumo por classe. O caminho no banco está em
 * reprocessar-outbox.banco.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { classeDoErro, resumirPorClasse, selecionarParados, TETO_REPROCESSO, type EventoParadoLido } from '../src/reprocessar-outbox';

const AM = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const NO = 'integracao.catalogo_no.atualizado@1';
const PRODUTO = 'integracao.produto.atualizado@1';
const MAX = 10;

let n = 0;
function ev(p: Partial<EventoParadoLido> = {}): EventoParadoLido {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    tenant_id: AM,
    nome: PRODUTO,
    tentativas: MAX,
    publicado_em: null,
    deleted_at: null,
    ocorrido_em: new Date(Date.UTC(2026, 10, 15, 4, 58, 0, n)),
    ultimo_erro: 'catalogo: ReferenciaAusenteErp: referencia_ausente: 1 registro(s) de catalogo_no ainda não chegaram',
    ...p,
  };
}

const sel = (linhas: EventoParadoLido[]) => selecionarParados(linhas, { tenantId: AM, nomes: [NO, PRODUTO], maxTentativas: MAX });

describe('selecionarParados: só os parados da empresa, uma vez só', () => {
  it('pega só evento parado (tentativas = máximo, sem publicado_em) da empresa pedida', () => {
    const parado = ev();
    const r = sel([
      parado,
      ev({ tenant_id: OUTRA }), // outra empresa
      ev({ publicado_em: new Date('2026-11-15T05:00:00Z') }), // já publicado
      ev({ tentativas: 3 }), // ainda em nova tentativa: é do despachante, não do reprocesso
      ev({ tentativas: 0 }),
      ev({ deleted_at: new Date('2026-11-16T05:00:00Z') }), // apagado
      ev({ nome: 'core.notificacao.criada@1' }), // sem consumidor instalado
    ]);
    expect(r.reprocessar.map((e) => e.id)).toEqual([parado.id]);
    expect(r.jaTentados).toEqual([]);
  });

  it('não tenta de novo: o que passou do máximo (já reprocessado e parado outra vez) fica fora e é contado à parte', () => {
    const jaTentado = ev({ tentativas: MAX + 1 });
    const parado = ev();
    const r = sel([jaTentado, parado]);
    expect(r.reprocessar.map((e) => e.id)).toEqual([parado.id]);
    expect(r.jaTentados.map((e) => e.id)).toEqual([jaTentado.id]);
  });

  it('ordem do despachante: do mais antigo para o mais novo (os nós antes dos produtos), desempate pelo id', () => {
    const produto = ev({ nome: PRODUTO, ocorrido_em: new Date('2026-11-15T04:58:00Z') });
    const no2 = ev({ nome: NO, ocorrido_em: new Date('2026-11-15T04:47:00Z'), id: '00000000-0000-4000-8000-0000000000b2' });
    const no1 = ev({ nome: NO, ocorrido_em: new Date('2026-11-15T04:47:00Z'), id: '00000000-0000-4000-8000-0000000000b1' });
    expect(sel([produto, no2, no1]).reprocessar.map((e) => e.id)).toEqual([no1.id, no2.id, produto.id]);
  });

  it('teto de segurança: a CLI recusa mais do que o teto (o escopo é a empresa, não a outbox inteira)', () => {
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
