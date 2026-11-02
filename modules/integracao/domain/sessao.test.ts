import { describe, expect, it } from 'vitest';
import { calcularResultadoLote, erroReferenciaAusente } from './erros';
import { validarLinhas } from './idempotencia';
import { tratarLinhasInvalidasConector } from './linhas-invalidas';
import { calcularInativacao, idsDaSessaoNoLote, novaSessao, registrarParte, situacaoSessao } from './sessao';

const t0 = '2026-10-31T10:00:00Z';
const base = () => novaSessao('s1', 'cliente', t0);

describe('RN-INT-06: sessão de carga completa', () => {
  it('RN-INT-06: só está completa depois do último lote, com todas as partes 1..n concluídas', () => {
    let s = registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 3, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta'); // falta a parte 2
    s = registrarParte(s, { parte: 2, ultimo: false, status: 'concluido_com_erros' });
    expect(situacaoSessao(s, t0)).toBe('completa');
  });

  it('RN-INT-06: parte falhou ou ainda processando mantém a sessão aberta; reenvio da parte conserta', () => {
    let s = registrarParte(base(), { parte: 1, ultimo: true, status: 'falhou' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'processando' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('completa');
  });

  it('RN-INT-06: parte além da última declarada torna a sessão inconsistente (não completa)', () => {
    let s = registrarParte(base(), { parte: 2, ultimo: false, status: 'concluido' });
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
  });

  it('RN-INT-06: sessão sem fechar expira depois do TTL parametrizável (24 h por padrão)', () => {
    const s = registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });
    expect(situacaoSessao(s, '2026-11-01T09:59:59Z')).toBe('aberta');
    expect(situacaoSessao(s, '2026-11-01T10:00:01Z')).toBe('expirada');
    expect(situacaoSessao(s, '2026-10-31T10:11:00Z', { ttlMin: 10 })).toBe('expirada');
  });

  it('RN-INT-06: sessão completa não expira depois de fechada', () => {
    const s = registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, '2027-01-01T00:00:00Z')).toBe('completa');
  });

  it('RN-INT-06: registrarParte não altera a sessão original (imutável)', () => {
    const s = base();
    registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(s.partes).toEqual({});
  });
});

describe('RN-INT-06: inativação da carga completa', () => {
  const completa = () => registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });
  const aberta = () => registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });

  it('RN-INT-06: com a sessão completa, inativa os ativos ausentes da carga (nunca apaga)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B', 'C', 'D'], recebidosNaSessao: ['A', 'C'], limitePct: 100 });
    expect(r).toEqual({ permitido: true, inativar: ['B', 'D'], motivo: null });
  });

  it('RN-INT-06: sessão incompleta não inativa nada', () => {
    const r = calcularInativacao({ sessao: aberta(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'] });
    expect(r.permitido).toBe(false);
    expect(r.inativar).toEqual([]);
    expect(r.motivo).toBe('sessao_incompleta');
  });

  it('RN-INT-06: sessão expirada não inativa nada', () => {
    const r = calcularInativacao({ sessao: aberta(), agora: '2026-12-01T00:00:00Z', ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'] });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'sessao_incompleta' });
  });

  it('RN-INT-06: linha sem external_id legível na sessão bloqueia a inativação (não dá para saber o que faltou)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], linhasSemExternalId: 1 });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'linhas_sem_external_id' });
  });

  it('RN-INT-06: sessão completa sem nenhum registro recebido não inativa (proteção contra carga vazia)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A'], recebidosNaSessao: [] });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'carga_vazia' });
  });

  it('RN-INT-06: registro com erro de validação mas presente na carga não é inativado (basta estar em recebidosNaSessao)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A', 'B'] });
    expect(r.inativar).toEqual([]);
    expect(r.permitido).toBe(true);
  });

  it('RN-INT-06: inativação em massa acima do limite (padrão 30%) exige confirmação do operador', () => {
    const ativos = Array.from({ length: 10 }, (_, i) => `A${i}`);
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ['A0', 'A1', 'A2'] });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'excede_limite_inativacao' });
    expect(r.candidatos).toHaveLength(7);
  });

  it('RN-INT-06: com confirmação do operador a inativação em massa é liberada', () => {
    const ativos = Array.from({ length: 10 }, (_, i) => `A${i}`);
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ['A0', 'A1', 'A2'], confirmado: true });
    expect(r.permitido).toBe(true);
    expect(r.inativar).toHaveLength(7);
  });

  it('RN-INT-06: exatamente no limite (30%) ainda inativa sem confirmação', () => {
    const ativos = Array.from({ length: 10 }, (_, i) => `A${i}`);
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ativos, recebidosNaSessao: ativos.slice(0, 7) });
    expect(r.permitido).toBe(true);
    expect(r.inativar).toHaveLength(3);
  });
});

describe('RN-INT-06 (T-0025): linhas inválidas do Conector e a inativação da carga completa', () => {
  const completa = () => registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });

  it('RN-INT-06: linhas inválidas omitidas (sem detalhe) impedem a inativação — não dá para saber quais registros elas representam', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], linhasInvalidasOmitidas: 3 });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'linhas_invalidas_omitidas' });
  });

  it('RN-INT-06: linha inválida COM external_id conta como recebida (o registro continua no ERP e não é inativado)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A', 'B'], limitePct: 100 });
    expect(r).toMatchObject({ permitido: true, inativar: [] });
  });

  it('RN-INT-06: zero omitidas não muda nada', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], limitePct: 100, linhasInvalidasOmitidas: 0 });
    expect(r.inativar).toEqual(['B']);
  });
});

describe('RN-INT-06 (T-0027 🔴): registro que veio como inválido NUNCA é inativado', () => {
  const ativos10 = Array.from({ length: 10 }, (_, i) => `C${i}`);
  /** Sessão de 2 partes, as duas concluídas (a 2ª só com linhas inválidas do Conector, exceção da RN-INT-01). */
  const sessao2 = () =>
    registrarParte(registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' }), { parte: 2, ultimo: true, status: 'concluido_com_erros' });

  it('RN-INT-06: carga completa com 1 linha inválida — 9 aceitas + C9 inválida no Conector: nada é inativado', () => {
    const lote = tratarLinhasInvalidasConector({ linhas_invalidas: [{ external_id: 'C9', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor' }] });
    const ids = idsDaSessaoNoLote({ aceitas: ativos10.slice(0, 9).map((external_id) => ({ external_id })), errosHub: [], invalidasConector: lote });
    expect(ids).toEqual({ aceitos: ativos10.slice(0, 9), invalidos: ['C9'], semIdentificacao: 0 });
    const r = calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ativos10, recebidosNaSessao: ids.aceitos, invalidosNaSessao: ids.invalidos, linhasSemExternalId: ids.semIdentificacao });
    expect(r).toMatchObject({ permitido: true, inativar: [], motivo: null });
  });

  it('RN-INT-06: mesmo com a confirmação do operador (inativação em massa) o inválido fica de fora; só o ausente de verdade sai', () => {
    const r = calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ativos10, recebidosNaSessao: ['C0', 'C1'], invalidosNaSessao: ['C2'], confirmado: true });
    expect(r.permitido).toBe(true);
    expect(r.inativar).not.toContain('C2');
    expect(r.inativar).toEqual(ativos10.slice(3));
  });

  it('RN-INT-06: na trava dos 30% o inválido também não aparece entre os candidatos da pendência', () => {
    const r = calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ativos10, recebidosNaSessao: ['C0'], invalidosNaSessao: ['C1', 'C2'] });
    expect(r.motivo).toBe('excede_limite_inativacao');
    expect(r.candidatos).toEqual(ativos10.slice(3));
  });

  it('RN-INT-06: sessão só com linhas inválidas (nenhuma aceita) não é "carga vazia" — os inválidos protegem e os ausentes saem', () => {
    const r = calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: [], invalidosNaSessao: ['A'], limitePct: 100 });
    expect(r).toMatchObject({ permitido: true, inativar: ['B'] });
    expect(calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ['A'], recebidosNaSessao: [], invalidosNaSessao: [] }).motivo).toBe('carga_vazia');
  });

  it('RN-INT-06: erros do Hub (validação, referência ausente) também protegem; linha do Hub sem id legível conta como sem identificação', () => {
    const { validas, erros } = validarLinhas('cliente', [
      { external_id: 'C0', alterado_em: '2026-10-31T09:00:00Z', razao_social: 'Ok' },
      { external_id: 'C1', alterado_em: '2026-10-31T09:00:00Z' },
      { alterado_em: '2026-10-31T09:00:00Z', razao_social: 'Sem id' },
    ]);
    const ref = erroReferenciaAusente(3, 'C3', 'vendedor_external_id', 'vendedor');
    const ids = idsDaSessaoNoLote({ aceitas: validas, errosHub: [...erros, ref], invalidasConector: tratarLinhasInvalidasConector({ linhas_invalidas: [{ external_id: null, codigo: 'registro_invalido', mensagem: 'x' }] }) });
    expect(ids.aceitos).toEqual(['C0']);
    expect(ids.invalidos.sort()).toEqual(['C1', 'C3']);
    expect(ids.semIdentificacao).toBe(2);
    const r = calcularInativacao({ sessao: sessao2(), agora: t0, ativosNoMacuxi: ['C0', 'C1', 'C3', 'C4'], recebidosNaSessao: ids.aceitos, invalidosNaSessao: ids.invalidos, linhasSemExternalId: ids.semIdentificacao });
    expect(r).toMatchObject({ permitido: false, motivo: 'linhas_sem_external_id' });
  });

  it('RN-INT-06: id aceito e inválido no mesmo lote (duplicado) fica só em aceitos; ids aparados', () => {
    const ids = idsDaSessaoNoLote({ aceitas: [{ external_id: ' C1 ' }], errosHub: [{ indice: 4, external_id: 'C1' }], invalidasConector: { externalIds: ['  C2'], semIdentificacao: 0 } });
    expect(ids).toEqual({ aceitos: ['C1'], invalidos: ['C2'], semIdentificacao: 0 });
  });

  it('RN-INT-01/03 (P-1): a 2ª parte só com linhas inválidas termina concluido_com_erros e fecha a sessão', () => {
    const lote = tratarLinhasInvalidasConector({ linhas_invalidas: [{ external_id: 'C9', codigo: 'tipo_invalido', mensagem: 'tipo inválido' }] });
    const res = calcularResultadoLote({ recebidas: 0, duplicadas_no_lote: 0, erros: [], novas: 0, atualizadas: 0, inalteradas: 0, invalidas_conector: lote.totalComErro });
    expect(res.status).toBe('concluido_com_erros');
    const s = registrarParte(registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' }), { parte: 2, ultimo: true, status: res.status });
    expect(situacaoSessao(s, t0)).toBe('completa');
  });
});

describe('RN-INT-06 (T-0025 🟡 2): candidatos = ativos elegíveis; denominador dos 30% = total de ativos', () => {
  const completa = () => registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });
  const total = Array.from({ length: 10 }, (_, i) => `A${i}`);

  it('RN-INT-06: ativo que chegou pelo delta durante a carga (não elegível) não é candidato, mesmo ausente da sessão', () => {
    // 10 ativos; A8 e A9 foram vistos depois do início da sessão (delta) e não estão na carga; A0..A5 vieram na carga
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: total, ativosElegiveis: total.slice(0, 8), recebidosNaSessao: total.slice(0, 6), limitePct: 100 });
    expect(r).toMatchObject({ permitido: true, inativar: ['A6', 'A7'] });
  });

  it('RN-INT-06: o percentual usa o TOTAL de ativos (2 de 10 = 20%, não 2 de 8 = 25%): passa no limite de 20%', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: total, ativosElegiveis: total.slice(0, 8), recebidosNaSessao: total.slice(0, 6), limitePct: 20 });
    expect(r.permitido).toBe(true);
    const acima = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: total, ativosElegiveis: total.slice(0, 8), recebidosNaSessao: total.slice(0, 6), limitePct: 19 });
    expect(acima).toMatchObject({ permitido: false, motivo: 'excede_limite_inativacao', candidatos: ['A6', 'A7'] });
  });

  it('RN-INT-06: sem ativosElegiveis o comportamento é o de antes (todos os ativos são elegíveis)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: total, recebidosNaSessao: total.slice(0, 6), limitePct: 100 });
    expect(r.inativar).toEqual(['A6', 'A7', 'A8', 'A9']);
  });

  it('RN-INT-06: o inválido continua protegido mesmo sendo elegível', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: total, ativosElegiveis: total.slice(0, 8), recebidosNaSessao: total.slice(0, 6), invalidosNaSessao: ['A6'], limitePct: 100 });
    expect(r.inativar).toEqual(['A7']);
  });
});

describe('RN-INT-06 (R-155028 🟡 1): external_id acima de 200 caracteres no erro do Hub conta como sem identificação', () => {
  const longo = 'X'.repeat(201);
  it('RN-INT-06: erro do Hub com id de 201 caracteres vai para semIdentificacao e não para sessao_carga_recebido', () => {
    const r = idsDaSessaoNoLote({ aceitas: [], errosHub: [{ indice: 0, external_id: longo }, { indice: 1, external_id: 'C1' }], invalidasConector: { externalIds: [], semIdentificacao: 0 } });
    expect(r).toEqual({ aceitos: [], invalidos: ['C1'], semIdentificacao: 1 });
  });
  it('RN-INT-06: 200 caracteres ainda vale (o limite é EXTERNAL_ID_MAX)', () => {
    const limite = 'Y'.repeat(200);
    const r = idsDaSessaoNoLote({ aceitas: [], errosHub: [{ indice: 0, external_id: limite }], invalidasConector: { externalIds: [], semIdentificacao: 0 } });
    expect(r.invalidos).toEqual([limite]);
  });
});

describe('RN-INT-03/06 (T-0025 🟢 5): parte que terminou falhou só fecha a sessão depois do reprocessamento', () => {
  it('RN-INT-06: parte com todas as linhas em referencia_ausente termina falhou e a sessão não fecha; reprocessar regrava o estado da parte e fecha', () => {
    const falhou = registrarParte(base(), { parte: 1, ultimo: true, status: 'falhou' });
    expect(situacaoSessao(falhou, t0)).toBe('aberta');
    expect(calcularInativacao({ sessao: falhou, agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], limitePct: 100 })).toMatchObject({ permitido: false, motivo: 'sessao_incompleta' });
    // o reprocessamento (dependência chegou) recalcula o lote e a API chama registrarParte de novo com o estado novo
    const reprocessada = registrarParte(falhou, { parte: 1, ultimo: true, status: 'concluido_com_erros' });
    expect(situacaoSessao(reprocessada, t0)).toBe('completa');
    expect(calcularInativacao({ sessao: reprocessada, agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], limitePct: 100 })).toMatchObject({ permitido: true, inativar: ['B'] });
  });
});
