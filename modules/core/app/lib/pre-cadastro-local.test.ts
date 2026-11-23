import { describe, expect, it, vi } from 'vitest';
import type { ClienteSync } from '../../contracts';
import { situacaoDoPreCadastro } from '../../domain';
import { ROTULO_PRE_CADASTRO_NAO_ENVIADO, seloDoPreCadastro } from '@macuxi/ui/mobile/puro';
import { clienteComDocumento, correcaoDoCliente, ENTIDADE_PRE_CADASTRO, entidadePreCadastro, montarPreCadastro, obrigatoriosDasLinhas, salvarPreCadastro, sobreporPreCadastros } from './pre-cadastro-local';

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
  it('RN-CORE-79: os obrigatórios vêm da lista única sincronizada (RN-CORE-16), com os sempre obrigatórios e sem complemento nem geolocalização', () => {
    const linhas = [{ modulo: 'core', chave: 'cliente.campos_obrigatorios', valor: ['telefone', 'complemento', 'geolocalizacao'] }];
    expect(obrigatoriosDasLinhas(linhas)).toEqual(['razao_social', 'documento', 'telefone']);
    expect(obrigatoriosDasLinhas([])).toEqual(['razao_social', 'documento', 'inscricao_estadual', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep']);
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

  it('RN-CORE-78: item da fila que falhou (422, 409, CONFLITO) é "Não enviado" com o motivo do servidor, nunca "Recusado pelo ERP" nem "Aguardando ERP"', () => {
    const payload = { id: ID, origem: 'campo', razao_social: 'Mercado', documento: '11222333000181' };
    const [c] = sobreporPreCadastros([], [{ payload, situacao: 'falhou', ultimo_erro: 'Preencha o telefone.' }], '2026-11-23T10:00:00Z');
    expect(c).toMatchObject({ status_cadastro: 'pendente', motivo_recusa: 'Preencha o telefone.' });
    expect(situacaoDoPreCadastro(c!)).toEqual({ situacao: 'nao_enviado', motivo: 'Preencha o telefone.' });
    expect(seloDoPreCadastro(situacaoDoPreCadastro(c!).situacao)?.texto).toBe(ROTULO_PRE_CADASTRO_NAO_ENVIADO);
    const [sem] = sobreporPreCadastros([], [{ payload, situacao: 'falhou' }], '2026-11-23T10:00:00Z');
    // RD-2654: o sentinela não vira linha de motivo (o selo "Não enviado" já diz)
    expect(situacaoDoPreCadastro(sem!)).toEqual({ situacao: 'nao_enviado', motivo: null });
  });

  it('RN-CORE-78: item com módulo inativo também é "Não enviado"; só o pendente da fila é "Aguardando ERP"; "Recusado pelo ERP" é só do pull', () => {
    const payload = { id: ID, origem: 'campo', razao_social: 'Mercado', documento: '11222333000181' };
    const [m] = sobreporPreCadastros([], [{ payload, situacao: 'modulo_inativo' }], '2026-11-23T10:00:00Z');
    expect(situacaoDoPreCadastro(m!).situacao).toBe('nao_enviado');
    const [p] = sobreporPreCadastros([], [{ payload, situacao: 'pendente' }], '2026-11-23T10:00:00Z');
    expect(situacaoDoPreCadastro(p!).situacao).toBe('aguardando_erp');
    expect(situacaoDoPreCadastro({ status_cadastro: 'recusado', motivo_recusa: 'CNPJ duplicado' })).toEqual({ situacao: 'recusado_erp', motivo: 'CNPJ duplicado' });
  });

  it('RN-CORE-78: o pré-cadastro é editável pelo app até o ERP decidir (pendente ou recusado), e o servidor vence depois', () => {
    expect(entidadePreCadastro.conflito).toBe('app_edita_ate_status');
  });

  it('RN-CORE-79: o documento vai ao servidor só com dígitos, e o schema recusado devolve a mensagem por campo', () => {
    const ok = montarPreCadastro(ID, valores);
    expect(ok.ok && ok.payload.documento).toBe('11222333000181');
    const ruim = montarPreCadastro(ID, { ...valores, documento: '123' });
    expect(ruim).toMatchObject({ ok: false, erros: { documento: expect.any(String) } });
  });

  it('RN-CORE-78: o cliente da fila aparece na hora, sem código, como pendente', () => {
    const novo = sobreporPreCadastros([], [{ payload: { id: ID, origem: 'campo', razao_social: 'Novo', documento: '11222333000181' } }], '2026-11-23T10:00:00Z');
    expect(novo).toEqual([expect.objectContaining({ id: ID, external_id: null, status_cadastro: 'pendente', razao_social: 'Novo' })]);
  });

  it('RN-CORE-78: a correção do recusado (mesmo id) ocupa a linha dele: pendente, sem motivo nem erros, na mesma revisão até o pull', () => {
    const recusado = linhaCliente({ status_cadastro: 'recusado', motivo_recusa: 'CNPJ duplicado', revisao_cadastro: 2, erros_recusa: [{ campo: 'cep', codigo: 'CEP', mensagem: 'CEP não existe' }] });
    const payload = { id: ID, origem: 'campo', razao_social: 'Corrigido', documento: '11222333000181', revisao_base: 2 };
    expect(sobreporPreCadastros([recusado], [{ payload }], '2026-11-23T10:00:00Z')).toEqual([
      expect.objectContaining({ id: ID, status_cadastro: 'pendente', motivo_recusa: null, erros_recusa: null, revisao_cadastro: 2, razao_social: 'Corrigido' }),
    ]);
    expect(sobreporPreCadastros([recusado], [], 'x')).toEqual([recusado]);
  });

  it('RN-CORE-78: a correção do recusado pelo ERP abre preenchida, com a revisão vista e os erros por campo na coluna exata', () => {
    const recusado = linhaCliente({ status_cadastro: 'recusado', revisao_cadastro: 3, cidade: 'Manaus', uf: 'AM', latitude: '-3.1', longitude: -60, erros_recusa: [{ campo: 'cep', codigo: 'CEP', mensagem: 'CEP não existe' }, { campo: 'regime', codigo: 'X', mensagem: 'Fora do formulário' }] });
    const c = correcaoDoCliente([recusado], [], ID);
    expect(c?.valores).toMatchObject({ razao_social: 'Mercado Boa Vista', cidade: 'Manaus', uf: 'AM', email: '' });
    expect(c?.base).toEqual({ revisao_base: 3, latitude: -3.1, longitude: -60 });
    expect(c?.erros).toEqual({ cep: 'CEP não existe' });
    // linha antiga, sem revisão: o recusado é a revisão 1
    expect(correcaoDoCliente([linhaCliente({ status_cadastro: 'recusado' })], [], ID)?.base.revisao_base).toBe(1);
    expect(correcaoDoCliente([], [], ID)).toBeNull();
  });

  it('RN-CORE-78: o "Não enviado" reabre o payload da fila com a revisão dele; se o servidor tem revisão mais nova, vale a do servidor', () => {
    const payload = { id: ID, origem: 'campo', razao_social: 'Da fila', documento: '11222333000181', revisao_base: 2 };
    const doServidor = (revisao: number) => linhaCliente({ status_cadastro: 'recusado', revisao_cadastro: revisao, razao_social: 'Do servidor' });
    expect(correcaoDoCliente([doServidor(2)], [{ payload, situacao: 'falhou' }], ID)).toMatchObject({ valores: { razao_social: 'Da fila' }, base: { revisao_base: 2 }, erros: {} });
    expect(correcaoDoCliente([doServidor(3)], [{ payload, situacao: 'falhou' }], ID)).toMatchObject({ valores: { razao_social: 'Do servidor' }, base: { revisao_base: 3 } });
    // cadastro novo que não chegou ao servidor: segue sem revisão (é criação)
    const { revisao_base: _, ...criacao } = payload;
    expect(correcaoDoCliente([], [{ payload: criacao, situacao: 'falhou' }], ID)?.base.revisao_base).toBeNull();
  });

  it('RN-CORE-78: a correção vai com o mesmo id e a revisao_base; a criação vai sem revisão', async () => {
    const m = motorFalso();
    await salvarPreCadastro(m as never, { id: ID, valores, obrigatorios: ['razao_social', 'documento'], online: false, base: { revisao_base: 2, latitude: -3.1, longitude: -60 } });
    expect(m.fila.get(ID)).toMatchObject({ id: ID, revisao_base: 2, latitude: -3.1, longitude: -60 });
    const criacao = montarPreCadastro(ID, valores);
    expect(criacao.ok && 'revisao_base' in criacao.payload).toBe(false);
  });

  it('RN-CORE-79: CNPJ/CPF de cliente que já está na carteira é achado pelos dígitos (e a própria correção não conta)', () => {
    const c = linhaCliente({});
    expect(clienteComDocumento([c], '11.222.333/0001-81')?.id).toBe(ID);
    expect(clienteComDocumento([c], '11.222.333/0001-81', ID)).toBeNull();
    expect(clienteComDocumento([c], '123')).toBeNull();
  });
});
