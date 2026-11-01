import { describe, expect, it } from 'vitest';
import { ClientePayload, EstoquePayload, PrecoPayload, ProdutoPayload, RotaPayload, TituloPayload } from '../contracts';
import { calcularResultadoLote, classificarErroZod, ehReprocessavel, erroFalhaProcessamento, erroReferenciaAusente } from './erros';

const base = { external_id: 'C1', alterado_em: '2026-10-31T10:00:00Z' };
const erros = (schema: { safeParse: (x: unknown) => { success: boolean; error?: import('zod').ZodError } }, dado: unknown) => {
  const r = schema.safeParse(dado);
  if (r.success || !r.error) throw new Error('esperava falha');
  return classificarErroZod(r.error, { indice: 3, external_id: 'C1' });
};

describe('RN-INT-03: classificar erro de linha a partir do ZodError', () => {
  it('RN-INT-03: campo ausente ou nulo vira campo_obrigatorio com o nome do campo, não reprocessável', () => {
    const [e] = erros(ClientePayload, { ...base });
    expect(e).toMatchObject({ indice: 3, external_id: 'C1', codigo: 'campo_obrigatorio', campo: 'razao_social', reprocessavel: false });
    expect(e?.mensagem).toMatch(/razao_social/);
    expect(erros(ClientePayload, { ...base, razao_social: null })[0]?.codigo).toBe('campo_obrigatorio');
    expect(erros(ClientePayload, { ...base, razao_social: '  ' })[0]?.codigo).toBe('campo_obrigatorio');
  });

  it('RN-INT-03: tipo, formato, faixa e valor não permitido têm códigos próprios', () => {
    const t = { ...base, cliente_external_id: 'C1', numero: 'T1', vencimento: '2026-11-30', valor_cents: 100, saldo_cents: 100, situacao: 'aberto' };
    expect(erros(TituloPayload, { ...t, valor_cents: 'abc' })[0]?.codigo).toBe('tipo_invalido');
    expect(erros(TituloPayload, { ...t, valor_cents: 10.5 })[0]).toMatchObject({ codigo: 'tipo_invalido', campo: 'valor_cents' });
    expect(erros(TituloPayload, { ...t, vencimento: '30/11/2026' })[0]?.codigo).toBe('formato_invalido');
    expect(erros(TituloPayload, { ...t, alterado_em: '2026-10-31T10:00:00-04:00' })[0]?.codigo).toBe('formato_invalido');
    expect(erros(TituloPayload, { ...t, valor_cents: -5 })[0]?.codigo).toBe('valor_fora_da_faixa');
    expect(erros(TituloPayload, { ...t, situacao: 'perdido' })[0]?.codigo).toBe('valor_nao_permitido');
    expect(erros(ProdutoPayload, { ...base, sku: 'P', nome: 'n', unidade: 'UN', ean: '123' })[0]?.codigo).toBe('formato_invalido');
  });

  it('RN-INT-03: erro dentro de lista indica o caminho com índice', () => {
    const [e] = erros(RotaPayload, { ...base, nome: 'Seg', vendedor_external_id: 'V1', paradas: [{ ordem: 1, cliente_external_id: 'C1' }, { ordem: 2 }] });
    expect(e).toMatchObject({ codigo: 'campo_obrigatorio', campo: 'paradas[1].cliente_external_id' });
  });

  it('RN-INT-03/09: problema no external_id vira external_id_invalido (uma vez só)', () => {
    const r = erros(ProdutoPayload, { alterado_em: base.alterado_em, sku: 'P', nome: 'n', unidade: 'UN' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ codigo: 'external_id_invalido', campo: 'external_id' });
  });

  it('RN-INT-03: regra do schema (refine) vira regra_invalida com a mensagem do contrato', () => {
    const preco = { ...base, tabela_external_id: 'T', tabela_nome: 'Atacado', vigencia_inicio: '2026-11-10', vigencia_fim: '2026-11-01', produto_external_id: 'P1', preco_cents: 990 };
    expect(erros(PrecoPayload, preco)[0]).toMatchObject({ codigo: 'regra_invalida', campo: 'vigencia_fim', reprocessavel: false });
    expect(erros(RotaPayload, { ...base, nome: 'x', vendedor_external_id: 'V', paradas: 'nao-lista' })[0]?.codigo).toBe('tipo_invalido');
  });

  it('RN-INT-03: registro que não é objeto vira registro_invalido', () => {
    const r = ClientePayload.safeParse('texto');
    if (r.success) throw new Error('x');
    const [e] = classificarErroZod(r.error, { indice: 0, external_id: null });
    expect(e).toMatchObject({ codigo: 'registro_invalido', campo: null, external_id: null });
  });

  it('RN-INT-03: a mensagem nunca carrega o valor recebido (dado pessoal)', () => {
    const segredos = ['123.456.789-00', 'maria@exemplo.com', 'PERDIDO-XYZ'];
    const r = ClientePayload.safeParse({ ...base, razao_social: 'ok', documento: segredos[0], email: 12345, vendedor_external_id: 99, latitude: 'maria@exemplo.com', bloqueado: 'PERDIDO-XYZ' });
    if (r.success) throw new Error('x');
    const texto = JSON.stringify(classificarErroZod(r.error, { indice: 0, external_id: 'C1' }));
    for (const s of segredos) expect(texto).not.toContain(s);
    const e = erros(EstoquePayload, { ...base, deposito_external_id: 'D', produto_external_id: 'P', saldo: 'PERDIDO-XYZ' });
    expect(JSON.stringify(e)).not.toContain('PERDIDO-XYZ');
  });

  it('RN-INT-03/04: só referencia_ausente e falha_processamento são reprocessáveis', () => {
    expect(ehReprocessavel('referencia_ausente')).toBe(true);
    expect(ehReprocessavel('falha_processamento')).toBe(true);
    for (const c of ['campo_obrigatorio', 'tipo_invalido', 'formato_invalido', 'valor_fora_da_faixa', 'valor_nao_permitido', 'regra_invalida', 'registro_invalido', 'external_id_invalido'] as const) {
      expect(ehReprocessavel(c)).toBe(false);
    }
    expect(erroReferenciaAusente(2, 'T1', 'cliente_external_id', 'cliente')).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'cliente_external_id' });
    expect(erroFalhaProcessamento(2, 'T1').reprocessavel).toBe(true);
  });
});

describe('RN-INT-03: resultado do lote', () => {
  const cont = { novas: 0, atualizadas: 0, inalteradas: 0 };
  const err = (indice: number) => erroFalhaProcessamento(indice, `X${indice}`);

  it('RN-INT-03: sem erro de linha o lote é concluido', () => {
    const r = calcularResultadoLote({ recebidas: 3, duplicadas_no_lote: 0, erros: [], ...cont, novas: 3 });
    expect(r.status).toBe('concluido');
    expect(r.contagens).toMatchObject({ recebidas: 3, com_erro: 0, novas: 3 });
  });

  it('RN-INT-03: parte das linhas com erro é concluido_com_erros e várias falhas na mesma linha contam uma vez', () => {
    const r = calcularResultadoLote({ recebidas: 3, duplicadas_no_lote: 0, erros: [err(1), err(1)], ...cont, novas: 2 });
    expect(r.status).toBe('concluido_com_erros');
    expect(r.contagens.com_erro).toBe(1);
  });

  it('RN-INT-03: todas as linhas com erro é falhou', () => {
    expect(calcularResultadoLote({ recebidas: 2, duplicadas_no_lote: 0, erros: [err(0), err(1)], ...cont }).status).toBe('falhou');
  });

  it('RN-INT-02/03: duplicadas no lote não são erro nem contam como linhas efetivas', () => {
    const r = calcularResultadoLote({ recebidas: 3, duplicadas_no_lote: 1, erros: [err(2)], ...cont, novas: 1 });
    expect(r.status).toBe('concluido_com_erros');
    const todas = calcularResultadoLote({ recebidas: 3, duplicadas_no_lote: 1, erros: [err(1), err(2)], ...cont });
    expect(todas.status).toBe('falhou');
  });

  it('RN-INT-03: falha de processamento do lote inteiro é falhou mesmo sem erro por linha', () => {
    expect(calcularResultadoLote({ recebidas: 2, duplicadas_no_lote: 0, erros: [], ...cont, falhaProcessamento: true }).status).toBe('falhou');
  });
});

describe('RN-INT-03/01 (T-0025): resultado do lote com linhas inválidas do Conector', () => {
  const base = { recebidas: 10, duplicadas_no_lote: 0, erros: [], novas: 10, atualizadas: 0, inalteradas: 0 };

  it('RN-INT-03: linhas inválidas do Conector contam como recebidas e com erro → concluido_com_erros, e a conta fecha', () => {
    const r = calcularResultadoLote({ ...base, recebidas: 8, novas: 8, invalidas_conector: 2 });
    expect(r.status).toBe('concluido_com_erros');
    expect(r.contagens).toMatchObject({ recebidas: 10, com_erro: 2, novas: 8 });
    const c = r.contagens;
    expect(c.novas + c.atualizadas + c.inalteradas + c.duplicadas_no_lote + c.com_erro).toBe(c.recebidas);
  });

  it('RN-INT-03: erros do Hub e do Conector somam sem colidir os índices (índice do Conector é a posição em linhas_invalidas)', () => {
    const hub = [erroFalhaProcessamento(0, 'C1')];
    const r = calcularResultadoLote({ ...base, recebidas: 5, novas: 4, erros: hub, invalidas_conector: 3 });
    expect(r.contagens.com_erro).toBe(4);
    expect(r.contagens.recebidas).toBe(8);
  });

  it('RN-INT-01 (exceção): lote SÓ com linhas inválidas do Conector termina concluido_com_erros — o Conector não pode bloquear a entidade por falhou', () => {
    const r = calcularResultadoLote({ recebidas: 0, duplicadas_no_lote: 0, erros: [], novas: 0, atualizadas: 0, inalteradas: 0, invalidas_conector: 7 });
    expect(r.status).toBe('concluido_com_erros');
    expect(r.contagens).toMatchObject({ recebidas: 7, com_erro: 7 });
  });

  it('RN-INT-06: linhas obsoletas contam no resumo (fecham a conta das recebidas), não viram erro e não mudam o status', () => {
    const r = calcularResultadoLote({ ...base, recebidas: 10, novas: 6, atualizadas: 1, inalteradas: 1, obsoletas: 2 });
    const c = r.contagens;
    expect(c.obsoletas).toBe(2);
    expect(r.status).toBe('concluido');
    expect(c.novas + c.atualizadas + c.inalteradas + c.obsoletas + c.duplicadas_no_lote + c.com_erro).toBe(c.recebidas);
  });

  it('RN-INT-06: sem obsoletas informadas o contador é 0', () => {
    expect(calcularResultadoLote(base).contagens.obsoletas).toBe(0);
  });

  it('RN-INT-03: todas as linhas do Hub com erro e nenhuma do Conector continua falhou; falha de processamento sempre falhou', () => {
    const erros = [erroFalhaProcessamento(0, 'C1'), erroFalhaProcessamento(1, 'C2')];
    expect(calcularResultadoLote({ ...base, recebidas: 2, novas: 0, erros }).status).toBe('falhou');
    expect(calcularResultadoLote({ ...base, invalidas_conector: 1, falhaProcessamento: true }).status).toBe('falhou');
  });

  it('RN-INT-03: sem invalidas_conector o comportamento anterior é o mesmo', () => {
    expect(calcularResultadoLote(base).status).toBe('concluido');
  });
});
