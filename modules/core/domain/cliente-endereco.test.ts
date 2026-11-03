import { describe, expect, it } from 'vitest';
import { enderecoPadrao, enderecosDeEntrega, formatarCep, listarEnderecosDoCliente, planejarEnderecoDoErp, resumoDoEndereco, type EventoEnderecoAtualizado } from './cliente-endereco';

const base = { external_id: 'E-1', ocorrido_em: '2026-11-02T12:00:00Z' };
const registro: NonNullable<EventoEnderecoAtualizado['registro']> = {
  external_id: 'E-1', alterado_em: '2026-11-02T11:00:00Z', ativo: true, cliente_external_id: 'C-1', tipo: 'entrega', descricao: ' Depósito ', logradouro: ' Rua A ', numero: '10',
  complemento: null, bairro: 'Centro', cidade: 'Boa Vista', uf: 'rr', cep: '69300-000', latitude: 2.82, longitude: -60.67, principal: false,
};
const ev = (r: Partial<NonNullable<EventoEnderecoAtualizado['registro']>> = {}, o: Partial<EventoEnderecoAtualizado> = {}): EventoEnderecoAtualizado => ({ ...base, acao: 'atualizado', registro: { ...registro, ...r }, ...o });

describe('RN-VEN-17: endereço de entrega do cliente vindo do ERP (integracao.cliente_endereco.atualizado@1)', () => {
  it('RN-VEN-17: criado e atualizado fazem upsert por external_id, com texto, UF e CEP normalizados', () => {
    for (const acao of ['criado', 'atualizado'] as const) {
      expect(planejarEnderecoDoErp(ev({}, { acao }))).toEqual({
        tipo: 'upsert',
        linha: {
          external_id: 'E-1', cliente_external_id: 'C-1', tipo: 'entrega', descricao: 'Depósito', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro',
          cidade: 'Boa Vista', uf: 'RR', cep: '69300000', latitude: 2.82, longitude: -60.67, principal: false, ativo: true,
        },
        desmarcar_outros_principais: false,
      });
    }
  });

  it('RN-VEN-17: marcar principal pede para desmarcar o principal anterior do cliente (no máximo um vivo)', () => {
    expect(planejarEnderecoDoErp(ev({ principal: true }))).toMatchObject({ linha: { principal: true }, desmarcar_outros_principais: true });
  });

  it('RN-VEN-17: tipo principal sem a marca principal vale como principal', () => {
    expect(planejarEnderecoDoErp(ev({ tipo: 'principal', principal: false }))).toMatchObject({ linha: { tipo: 'principal', principal: true }, desmarcar_outros_principais: true });
  });

  it('RN-VEN-17: endereço de cobrança nunca é o principal de entrega', () => {
    expect(planejarEnderecoDoErp(ev({ tipo: 'cobranca', principal: true }))).toMatchObject({ linha: { tipo: 'cobranca', principal: false }, desmarcar_outros_principais: false });
  });

  it('RN-VEN-17: endereço inativo libera a vaga de principal (não fica com a marca)', () => {
    expect(planejarEnderecoDoErp(ev({ principal: true, ativo: false }))).toMatchObject({ linha: { principal: false, ativo: false }, desmarcar_outros_principais: false });
  });

  it('RN-INT-06: inativado só marca ativo=false (nunca apaga) e não precisa de registro', () => {
    expect(planejarEnderecoDoErp({ ...base, acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'E-1' });
  });

  it('RN-INT-02: reentrega do mesmo evento é idempotente (mesmo plano)', () => {
    expect(planejarEnderecoDoErp(ev())).toEqual(planejarEnderecoDoErp(ev()));
  });

  it('RN-INT-02: criado/atualizado sem registro é ignorado (defeito do Hub)', () => {
    expect(planejarEnderecoDoErp({ ...base, acao: 'criado' })).toEqual({ tipo: 'ignorar', motivo: 'sem_registro' });
  });

  it('RN-VEN-17: sem logradouro ou cidade o endereço não serve para entrega e é ignorado', () => {
    expect(planejarEnderecoDoErp(ev({ logradouro: '  ' }))).toEqual({ tipo: 'ignorar', motivo: 'endereco_incompleto' });
    expect(planejarEnderecoDoErp(ev({ cidade: '' }))).toEqual({ tipo: 'ignorar', motivo: 'endereco_incompleto' });
  });

  it('RN-VEN-17: UF que não tem 2 letras é ignorada; CEP que não tem 8 dígitos entra nulo', () => {
    expect(planejarEnderecoDoErp(ev({ uf: 'RRR' }))).toEqual({ tipo: 'ignorar', motivo: 'endereco_incompleto' });
    expect(planejarEnderecoDoErp(ev({ cep: '123' }))).toMatchObject({ linha: { cep: null } });
  });

  it('RN-VEN-17: coordenada fora da faixa entra nula, sem derrubar o endereço', () => {
    expect(planejarEnderecoDoErp(ev({ latitude: 95, longitude: -200 }))).toMatchObject({ linha: { latitude: null, longitude: null } });
    expect(planejarEnderecoDoErp(ev({ latitude: null, longitude: undefined }))).toMatchObject({ linha: { latitude: null, longitude: null } });
  });
});

describe('RN-VEN-17: endereço padrão e lista de endereços do cliente (leitura pública, offline)', () => {
  const e = (o: Record<string, unknown>) =>
    ({ id: String(o.id), cliente_id: 'c1', tipo: 'entrega', descricao: null, logradouro: 'Rua B', numero: '1', complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: null, principal: false, ativo: true, deleted_at: null, ...o }) as Parameters<typeof enderecoPadrao>[0][number];

  it('RN-VEN-17: o padrão é o endereço principal ativo', () => {
    expect(enderecoPadrao([e({ id: 'a' }), e({ id: 'b', tipo: 'principal', principal: true })])?.id).toBe('b');
  });

  it('RN-VEN-17: sem principal, o padrão é o primeiro endereço de entrega ativo, em ordem estável', () => {
    expect(enderecoPadrao([e({ id: 'z', logradouro: 'Rua Z' }), e({ id: 'a', logradouro: 'Rua A' })])?.id).toBe('a');
  });

  it('RN-VEN-17: principal inativo ou removido não vale; cobrança nunca é padrão; sem opção, nulo', () => {
    expect(enderecoPadrao([e({ id: 'p', principal: true, ativo: false }), e({ id: 'e1' })])?.id).toBe('e1');
    expect(enderecoPadrao([e({ id: 'p', principal: true, deleted_at: '2026-11-01T00:00:00Z' })])).toBeNull();
    expect(enderecoPadrao([e({ id: 'c', tipo: 'cobranca', principal: true })])).toBeNull();
    expect(enderecoPadrao([])).toBeNull();
  });

  it('RN-VEN-17: lista do cliente traz só os ativos dele, o padrão primeiro e marcado', () => {
    const r = listarEnderecosDoCliente(
      [e({ id: 'b', logradouro: 'Rua B' }), e({ id: 'p', principal: true, tipo: 'principal', logradouro: 'Av. Principal', numero: '100' }), e({ id: 'x', ativo: false }), e({ id: 'o', cliente_id: 'c2' }), e({ id: 'c', tipo: 'cobranca' })],
      'c1',
    );
    expect(r.map((x) => [x.id, x.padrao])).toEqual([['p', true], ['b', false], ['c', false]]);
    expect(r[0]?.resumo).toBe('Av. Principal, 100 - Boa Vista/RR');
  });

  it('RN-VEN-17: o vendedor escolhe só entre endereços de entrega (sem cobrança), padrão primeiro', () => {
    const r = enderecosDeEntrega([e({ id: 'c', tipo: 'cobranca' }), e({ id: 'b' }), e({ id: 'p', principal: true })], 'c1');
    expect(r.map((x) => x.id)).toEqual(['p', 'b']);
  });

  it('RN-VEN-17: resumo e CEP formatados para a tela', () => {
    expect(formatarCep('69300000')).toBe('69300-000');
    expect(formatarCep(null)).toBe('');
    expect(resumoDoEndereco({ logradouro: 'Rua A', numero: '10', complemento: 'Sala 2', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69300000' })).toBe('Rua A, 10 - Sala 2 - Centro - Boa Vista/RR - CEP 69300-000');
    expect(resumoDoEndereco({ logradouro: 'Rua A', numero: null, complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: null })).toBe('Rua A - Boa Vista/RR');
  });
});
