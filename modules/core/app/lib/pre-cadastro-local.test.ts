import { describe, expect, it, vi } from 'vitest';
import type { ClienteSync } from '../../contracts';
import { situacaoDoPreCadastro } from '../../domain';
import { clienteComDocumento, ENTIDADE_PRE_CADASTRO, montarPreCadastro, obrigatoriosDasLinhas, salvarPreCadastro, sobreporPreCadastros, valoresDoCliente } from './pre-cadastro-local';

const ID = '3f1c2a52-3c1e-4f0a-9d49-7c4a5c0e1a11';
const valores = { documento: '11.222.333/0001-81', razao_social: 'Mercado Boa Vista', telefone: '(92) 99999-0000' };
const motorFalso = () => {
  const fila = new Map<string, unknown>();
  return {
    fila,
    enfileirar: vi.fn(async (n: { id: string; payload: unknown }) => {
      if (!fila.has(n.id)) fila.set(n.id, n.payload);
      return n as never;
    }),
    enviar: vi.fn(async () => []),
    pendentes: vi.fn(() => [...fila.keys()].map((id) => ({ id }))),
    alterar: vi.fn(async (id: string, m: { payload: unknown }) => {
      fila.set(id, m.payload);
      return true;
    }),
  };
};
const linhaCliente = (o: Partial<ClienteSync>): ClienteSync => ({
  id: ID, updated_at: '2026-11-23T00:00:00Z', deleted_at: null, external_id: null, documento: '11222333000181', razao_social: 'Mercado Boa Vista', nome_fantasia: null, segmento: null,
  telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true, ...o,
});

describe('pré-cadastro no aparelho (RN-CORE-78, RN-CORE-79)', () => {
  it('RN-CORE-79: os obrigatórios vêm do parâmetro sincronizado e os sempre obrigatórios ficam', () => {
    const linhas = [{ modulo: 'core', chave: 'cliente.pre_cadastro.obrigatorios', valor: ['telefone'] }];
    expect(obrigatoriosDasLinhas(linhas)).toEqual(['razao_social', 'documento', 'telefone']);
    expect(obrigatoriosDasLinhas([])).toEqual(['razao_social', 'documento']);
  });

  it('RN-CORE-78: enfileira o pré-cadastro com o id do aparelho, origem campo e documento só com dígitos, e dispara o envio online', async () => {
    const m = motorFalso();
    const r = await salvarPreCadastro(m as never, { id: ID, valores, obrigatorios: ['razao_social', 'documento'], online: true });
    expect(r).toEqual({ ok: true, id: ID });
    const arg = m.enfileirar.mock.calls[0]![0] as { id: string; entidade: string; payload: Record<string, unknown> };
    expect(arg.id).toBe(ID);
    expect(arg.entidade).toBe(ENTIDADE_PRE_CADASTRO);
    expect(arg.payload).toMatchObject({ id: ID, origem: 'campo', documento: '11222333000181', telefone: '92999990000' });
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-78: offline só enfileira (o envio sai quando houver sinal)', async () => {
    const m = motorFalso();
    await salvarPreCadastro(m as never, { id: ID, valores, obrigatorios: ['razao_social', 'documento'], online: false });
    expect(m.enfileirar).toHaveBeenCalledTimes(1);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('RN-CORE-79: obrigatório vazio ou CNPJ inválido não enfileira', async () => {
    const m = motorFalso();
    const r = await salvarPreCadastro(m as never, { id: ID, valores: { ...valores, documento: '11.222.333/0001-80' }, obrigatorios: ['razao_social', 'documento', 'email'], online: true });
    expect(r).toEqual({ ok: false, erros: { email: 'Obrigatório', documento: 'CNPJ inválido' } });
    expect(m.enfileirar).not.toHaveBeenCalled();
  });

  it('RN-CORE-78: reenviar a correção usa o mesmo id e não duplica o item na fila', async () => {
    const m = motorFalso();
    const o = { id: ID, obrigatorios: ['razao_social', 'documento'] as const, online: false };
    await salvarPreCadastro(m as never, { ...o, valores });
    await salvarPreCadastro(m as never, { ...o, valores: { ...valores, razao_social: 'Mercado Boa Vista Ltda' } });
    expect([...m.fila.keys()]).toEqual([ID]);
    expect(m.enfileirar).toHaveBeenCalledTimes(1);
    expect(m.alterar).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-78: item que falhou no 422 é substituído pela correção (alterar volta a pendente), não ignorado pelo enfileirar idempotente', async () => {
    const m = motorFalso();
    await salvarPreCadastro(m as never, { id: ID, valores, obrigatorios: ['razao_social', 'documento'], online: false });
    await salvarPreCadastro(m as never, { id: ID, valores: { ...valores, razao_social: 'Corrigido' }, obrigatorios: ['razao_social', 'documento'], online: true });
    expect((m.fila.get(ID) as { razao_social: string }).razao_social).toBe('Corrigido');
    expect(m.enviar).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-78: item da fila que falhou aparece como recusado, com a mensagem do 422, e não como "Aguardando ERP"', () => {
    const payload = { id: ID, origem: 'campo', razao_social: 'Mercado', documento: '11222333000181' };
    const [c] = sobreporPreCadastros([], [{ payload, situacao: 'falhou', ultimo_erro: 'Preencha o telefone.' }], '2026-11-23T10:00:00Z');
    expect(c).toMatchObject({ status_cadastro: 'recusado', motivo_recusa: 'Preencha o telefone.' });
    expect(situacaoDoPreCadastro(c!)).toEqual({ situacao: 'recusado_erp', motivo: 'Preencha o telefone.' });
    const [p] = sobreporPreCadastros([], [{ payload, situacao: 'pendente' }], '2026-11-23T10:00:00Z');
    expect(situacaoDoPreCadastro(p!).situacao).toBe('aguardando_erp');
  });

  it('RN-CORE-79: o documento vai ao servidor só com dígitos, e o schema recusado devolve a mensagem por campo', () => {
    const ok = montarPreCadastro(ID, valores);
    expect(ok.ok && ok.payload.documento).toBe('11222333000181');
    const ruim = montarPreCadastro(ID, { ...valores, documento: '123' });
    expect(ruim).toMatchObject({ ok: false, erros: { documento: expect.any(String) } });
  });

  it('RN-CORE-78: o cliente da fila aparece na hora, sem código, como pendente; o reenviado substitui o recusado', () => {
    const novo = sobreporPreCadastros([], [{ payload: { id: ID, origem: 'campo', razao_social: 'Novo', documento: '11222333000181' } }], '2026-11-23T10:00:00Z');
    expect(novo).toHaveLength(1);
    expect(novo[0]).toMatchObject({ id: ID, external_id: null, status_cadastro: 'pendente', razao_social: 'Novo' });
    const recusado = linhaCliente({ status_cadastro: 'recusado', motivo_recusa: 'CNPJ duplicado' });
    const reenviado = sobreporPreCadastros([recusado], [{ payload: { id: ID, origem: 'campo', razao_social: 'Corrigido', documento: '11222333000181' } }], '2026-11-23T10:00:00Z');
    expect(reenviado).toHaveLength(1);
    expect(reenviado[0]).toMatchObject({ status_cadastro: 'pendente', motivo_recusa: null, razao_social: 'Corrigido' });
    expect(sobreporPreCadastros([recusado], [], 'x')).toEqual([recusado]);
  });

  it('RN-CORE-78: a correção abre o formulário preenchido', () => {
    expect(valoresDoCliente(linhaCliente({ cidade: 'Manaus', uf: 'AM' }))).toMatchObject({ razao_social: 'Mercado Boa Vista', cidade: 'Manaus', uf: 'AM', email: '' });
  });

  it('RN-CORE-79: CNPJ/CPF de cliente que já está na carteira é achado pelos dígitos (e a própria correção não conta)', () => {
    const c = linhaCliente({});
    expect(clienteComDocumento([c], '11.222.333/0001-81')?.id).toBe(ID);
    expect(clienteComDocumento([c], '11.222.333/0001-81', ID)).toBeNull();
    expect(clienteComDocumento([c], '123')).toBeNull();
  });
});
