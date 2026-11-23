import { describe, expect, it } from 'vitest';
import { decidirCadastro } from './cliente-pre-cadastro';

describe('decidirCadastro', () => {
  it('RN-CORE-78: pré-cadastro pendente do campo ou do BKO pode ser aprovado ou recusado', () => {
    expect(decidirCadastro({ origem_cadastro: 'campo', status_cadastro: 'pendente' }, 'aprovar')).toEqual({ ok: true, status: 'aprovado' });
    expect(decidirCadastro({ origem_cadastro: 'bko', status_cadastro: 'pendente' }, 'recusar')).toEqual({ ok: true, status: 'recusado' });
  });
  it('RN-CORE-78: cliente do ERP não passa pela decisão (CLIENTE_DO_ERP)', () => {
    expect(decidirCadastro({ origem_cadastro: 'erp', status_cadastro: null }, 'aprovar')).toEqual({ ok: false, codigo: 'CLIENTE_DO_ERP' });
  });
  it('RN-CORE-78: decisão só uma vez (CADASTRO_JA_DECIDIDO)', () => {
    expect(decidirCadastro({ origem_cadastro: 'campo', status_cadastro: 'aprovado' }, 'recusar')).toEqual({ ok: false, codigo: 'CADASTRO_JA_DECIDIDO' });
    expect(decidirCadastro({ origem_cadastro: 'bko', status_cadastro: 'recusado' }, 'aprovar')).toEqual({ ok: false, codigo: 'CADASTRO_JA_DECIDIDO' });
  });
});
