import { describe, expect, it } from 'vitest';
import type { Transportadora } from '../../contracts';
import { buscaDosFiltrosTransportadoras, corpoDoForm, FORM_VAZIO, lerFiltrosTransportadoras, queryDosFiltrosTransportadoras, transportadorasToCsv, validarForm } from './transportadoras';

describe('T-0061 / RN-VEN-16: formulário de transportadora', () => {
  it('RN-VEN-16: nome (2+) e CNPJ válido são obrigatórios; mensagens em português', () => {
    const e = validarForm(FORM_VAZIO);
    expect(e.nome).toMatch(/Informe o nome/);
    expect(e.documento).toMatch(/14 dígitos/);
    expect(validarForm({ ...FORM_VAZIO, nome: 'Rápido Norte', documento: '11.222.333/0001-82' }).documento).toMatch(/inválido/);
    expect(validarForm({ ...FORM_VAZIO, nome: 'Rápido Norte', documento: '11.222.333/0001-81' })).toEqual({});
  });
  it('o corpo da API sai com CNPJ só em dígitos e opcionais nulos', () => {
    expect(corpoDoForm({ nome: ' Rápido Norte ', documento: '11.222.333/0001-81', inscricao_estadual: '', telefone: ' 92 3000-0000 ' })).toEqual({ nome: 'Rápido Norte', documento: '11222333000181', inscricao_estadual: null, telefone: '92 3000-0000' });
  });
});

describe('filtros na URL e CSV das transportadoras', () => {
  it('lê e grava os filtros ignorando o que não faz sentido', () => {
    expect(lerFiltrosTransportadoras('?q=rapido&ativas=1')).toEqual({ q: 'rapido', ativas: '1' });
    expect(lerFiltrosTransportadoras('?ativas=2')).toEqual({ q: '', ativas: '' });
    expect(buscaDosFiltrosTransportadoras({ q: 'rapido', ativas: '1' })).toBe('?q=rapido&ativas=1');
    expect(buscaDosFiltrosTransportadoras({ q: '', ativas: '' })).toBe('');
    expect(queryDosFiltrosTransportadoras({ q: '', ativas: '1' })).toEqual({ ativas: '1' });
  });
  it('exporta CSV com CNPJ formatado e origem', () => {
    const t: Transportadora = { id: '11111111-1111-4111-8111-111111111111', nome: 'Rápido Norte', documento: '11222333000181', inscricao_estadual: null, telefone: '92 3000-0000', ativo: true, external_id: null, updated_at: '2026-11-02T10:00:00.000000Z' };
    const csv = transportadorasToCsv([t, { ...t, nome: 'Parada', ativo: false, external_id: 'ERP-9' }]);
    expect(csv).toContain('Nome;CNPJ;Inscrição estadual;Telefone;Situação;Origem');
    expect(csv).toContain('Rápido Norte;11.222.333/0001-81;;92 3000-0000;Ativa;BKO');
    expect(csv).toContain('Parada;11.222.333/0001-81;;92 3000-0000;Inativa;ERP');
  });
});
