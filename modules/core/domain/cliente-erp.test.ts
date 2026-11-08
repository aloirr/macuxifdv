import { describe, expect, it } from 'vitest';
import { completarCnpj } from '@macuxi/comum/documento';
import { planejarClienteDoErp, type EventoClienteAtualizado } from './cliente-erp';
import { CAMPOS_CADASTRO_PADRAO } from './cadastro';

const CNPJ = completarCnpj('112223330001');
const base = { external_id: 'C-1', ocorrido_em: '2026-10-31T12:00:00Z' };
const registro = {
  external_id: 'C-1',
  alterado_em: '2026-10-31T11:00:00Z',
  ativo: true,
  razao_social: ' Mercado Boa Vista ',
  nome_fantasia: 'Boa Vista',
  documento: CNPJ,
  inscricao_estadual: 'ISENTO',
  observacao: 'Entregar pela manhã',
  telefone: '95999990000',
  email: null,
  latitude: 2.8,
  longitude: -60.6,
  endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Boa Vista', uf: 'rr', cep: '69301-000' },
};
const evento = (r: Record<string, unknown> = {}, acao: EventoClienteAtualizado['acao'] = 'atualizado'): EventoClienteAtualizado =>
  ({ ...base, acao, registro: { ...registro, ...r } }) as EventoClienteAtualizado;

describe('RN-CORE-16/17: cliente do ERP vira core.cliente com o cadastro mínimo calculado', () => {
  it('RN-CORE-16: cadastro completo grava cadastro_incompleto=false e lista vazia', () => {
    const p = planejarClienteDoErp(evento(), CAMPOS_CADASTRO_PADRAO);
    expect(p).toMatchObject({ tipo: 'upsert', linha: { cadastro_incompleto: false, cadastro_campos_faltantes: [], uf: 'RR', cep: '69301000', documento: CNPJ } });
  });

  it('RN-CORE-16: sem CEP o cliente entra incompleto, com o campo na lista, e a razão social é aparada', () => {
    const p = planejarClienteDoErp(evento({ endereco: { ...registro.endereco, cep: null } }), CAMPOS_CADASTRO_PADRAO);
    expect(p).toMatchObject({ tipo: 'upsert', linha: { razao_social: 'Mercado Boa Vista', cadastro_incompleto: true, cadastro_campos_faltantes: ['cep'] } });
  });

  it('RN-CORE-16: sem CNPJ/CPF, ou com dígitos que não formam documento, grava documento nulo e aponta o campo', () => {
    for (const documento of [null, '123']) {
      const p = planejarClienteDoErp(evento({ documento }), CAMPOS_CADASTRO_PADRAO);
      expect(p).toMatchObject({ tipo: 'upsert', linha: { documento: null, cadastro_incompleto: true } });
      if (p.tipo === 'upsert') expect(p.linha.cadastro_campos_faltantes).toContain('documento');
    }
  });

  it('RN-CORE-16: a lista do tenant é respeitada (só exige o que o tenant pediu, mais documento e razão social)', () => {
    const p = planejarClienteDoErp(evento({ endereco: null, inscricao_estadual: null }), ['razao_social', 'documento']);
    expect(p).toMatchObject({ tipo: 'upsert', linha: { cadastro_incompleto: false, cadastro_campos_faltantes: [] } });
  });

  it('RN-CORE-17: a observação do ERP é gravada intacta, sem a linha automática', () => {
    const p = planejarClienteDoErp(evento({ documento: null }), CAMPOS_CADASTRO_PADRAO);
    expect(p).toMatchObject({ tipo: 'upsert', linha: { observacao: 'Entregar pela manhã' } });
  });

  it('RN-INT-06: inativado só desativa; registro com ativo=false também; nunca apaga', () => {
    expect(planejarClienteDoErp({ ...base, acao: 'inativado' } as EventoClienteAtualizado, CAMPOS_CADASTRO_PADRAO)).toEqual({ tipo: 'inativar', external_id: 'C-1', alterado_em: null });
    // RN-INT-02: o ocorrido_em é o relógio do Hub; só o alterado_em do registro (relógio do ERP) entra na ordem
    expect(planejarClienteDoErp({ ...base, acao: 'inativado', registro: evento().registro } as EventoClienteAtualizado, CAMPOS_CADASTRO_PADRAO)).toMatchObject({ tipo: 'inativar', alterado_em: evento().registro!.alterado_em });
    expect(planejarClienteDoErp(evento({ ativo: false }), CAMPOS_CADASTRO_PADRAO)).toMatchObject({ tipo: 'upsert', linha: { ativo: false } });
  });

  it('RN-INT-05: evento mais antigo que o aplicado não sobrescreve; sem registro é ignorado', () => {
    expect(planejarClienteDoErp(evento(), CAMPOS_CADASTRO_PADRAO, '2026-10-31T13:00:00Z')).toEqual({ tipo: 'ignorar', motivo: 'mais_antigo_que_o_aplicado' });
    expect(planejarClienteDoErp({ ...base, acao: 'criado' } as EventoClienteAtualizado, CAMPOS_CADASTRO_PADRAO)).toEqual({ tipo: 'ignorar', motivo: 'sem_registro' });
  });

  it('RN-INT-02: reentrega do mesmo evento dá o mesmo plano (idempotente)', () => {
    expect(planejarClienteDoErp(evento(), CAMPOS_CADASTRO_PADRAO)).toEqual(planejarClienteDoErp(evento(), CAMPOS_CADASTRO_PADRAO));
  });
});
