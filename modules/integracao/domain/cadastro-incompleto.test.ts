import { describe, expect, it } from 'vitest';
import { avisosCadastroIncompleto, dadosParaConsultaCadastro } from './cadastro-incompleto';

describe('RN-INT-14: cliente sem campo obrigatório entra com aviso, nunca como erro de linha', () => {
  it('RN-INT-14: a consulta ao Core leva os campos do cliente do ERP e a chave é o external_id', () => {
    const d = dadosParaConsultaCadastro({
      external_id: 'CLI-1',
      razao_social: 'Padaria Boa',
      documento: '12345678000195',
      endereco: { logradouro: 'Rua A', numero: '10', cep: '69000000', uf: 'AM' },
      latitude: -3.1,
      longitude: -60,
    });
    expect(d).toMatchObject({ chave: 'CLI-1', razao_social: 'Padaria Boa', documento: '12345678000195', logradouro: 'Rua A', numero: '10', cep: '69000000', uf: 'AM', latitude: -3.1, inscricao_estadual: null, bairro: null });
  });

  it('RN-INT-14: cliente incompleto vira aviso `cadastro_incompleto` na linha, com os campos em português e SEM o valor do documento', () => {
    const avisos = avisosCadastroIncompleto(
      [
        { indice: 3, external_id: 'CLI-1' },
        { indice: 4, external_id: 'CLI-2' },
      ],
      [
        { chave: 'CLI-1', completo: false, campos_faltantes: ['documento', 'inscricao_estadual', 'cep'] },
        { chave: 'CLI-2', completo: true, campos_faltantes: [] },
      ],
    );
    expect(avisos).toEqual([{ indice: 3, external_id: 'CLI-1', codigo: 'cadastro_incompleto', mensagem: 'Cadastro incompleto: falta CNPJ/CPF, inscrição estadual, CEP. A linha foi aplicada; complete o cadastro no ERP ou no BKO.' }]);
  });

  it('RN-INT-14: resposta sem a chave da linha não gera aviso (nunca inventa)', () => {
    expect(avisosCadastroIncompleto([{ indice: 0, external_id: 'X' }], [])).toEqual([]);
  });
});
