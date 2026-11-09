/** T-0115 (RN-PES-05, RN-INT-08): canal do cliente no Hub v1 (aditivo) e de-para ERP -> Macuxi. */
import { describe, expect, it } from 'vitest';
import { ClientePayload, Mapeamento } from '../contracts';
import { validarLinhas } from './index';
import { traduzirCanalDoCliente, validarMapeamento, type MapeamentoGravado } from './mapeamento';

const base = { external_id: 'C1', alterado_em: '2026-11-09T10:00:00Z', razao_social: 'Mercado Boa Vista Ltda' };
const de = (codigo_erp: string, codigo_macuxi: string, ativo = true): MapeamentoGravado => ({ id: `id-${codigo_erp}`, tipo: 'canal', codigo_erp, codigo_macuxi, ativo });

describe('RN-PES-05: canal entra aditivo no ClientePayload v1', () => {
  it('cliente sem canal continua válido e a chave não aparece (ausente = não altera)', () => {
    const r = ClientePayload.parse(base);
    expect('canal' in r).toBe(false);
  });
  it('aceita texto, null (limpa) e apara espaços', () => {
    expect(ClientePayload.parse({ ...base, canal: '  Atacado ' }).canal).toBe('Atacado');
    expect(ClientePayload.parse({ ...base, canal: null }).canal).toBeNull();
  });
  it('recusa mais de 60 caracteres com mensagem legível, linha a linha', () => {
    expect(ClientePayload.safeParse({ ...base, canal: 'x'.repeat(61) }).success).toBe(false);
    const r = validarLinhas('cliente', [{ ...base, canal: 'x'.repeat(61) }, { ...base, external_id: 'C2', canal: 'x'.repeat(60) }]);
    expect(r.erros).toHaveLength(1);
    expect(r.validas).toHaveLength(1);
  });
});

describe('RN-INT-08: de-para do canal', () => {
  it('o tipo canal é aceito no contrato do de-para', () => {
    expect(Mapeamento.parse({ tipo: 'canal', codigo_erp: 'ATC', codigo_macuxi: 'Atacado' }).ativo).toBe(true);
  });
  it('vários códigos do ERP podem apontar para o mesmo canal do Macuxi; só o código do ERP é único', () => {
    const existentes = [de('ATC', 'Atacado')];
    expect(validarMapeamento({ tipo: 'canal', codigo_erp: 'ATA', codigo_macuxi: 'Atacado', ativo: true }, existentes)).toEqual({ ok: true, acao: 'criar' });
    expect(validarMapeamento({ tipo: 'canal', codigo_erp: 'ATC', codigo_macuxi: 'Atacarejo', ativo: true }, existentes)).toEqual({ ok: true, acao: 'atualizar', id: 'id-ATC' });
  });
  it('traduz o código do ERP pelo de-para ativo, ignorando caixa e espaços', () => {
    expect(traduzirCanalDoCliente({ ...base, canal: ' atc ' }, [de('ATC', 'Atacado')]).canal).toBe('Atacado');
  });
  it('sem de-para, de-para inativo ou de outro tipo: vale o texto como veio', () => {
    expect(traduzirCanalDoCliente({ canal: 'ATC' }, []).canal).toBe('ATC');
    expect(traduzirCanalDoCliente({ canal: 'ATC' }, [de('ATC', 'Atacado', false)]).canal).toBe('ATC');
    expect(traduzirCanalDoCliente({ canal: 'ATC' }, [{ ...de('ATC', 'Atacado'), tipo: 'status' }]).canal).toBe('ATC');
  });
  it('canal ausente, null ou em branco não é tocado (a chave ausente continua ausente)', () => {
    expect('canal' in traduzirCanalDoCliente({ a: 1 }, [de('ATC', 'Atacado')])).toBe(false);
    expect(traduzirCanalDoCliente({ canal: null }, [de('ATC', 'Atacado')]).canal).toBeNull();
    expect(traduzirCanalDoCliente({ canal: '  ' }, [de('ATC', 'Atacado')]).canal).toBe('  ');
  });
  it('não altera o registro original', () => {
    const r = { canal: 'ATC' };
    traduzirCanalDoCliente(r, [de('ATC', 'Atacado')]);
    expect(r.canal).toBe('ATC');
  });
});
