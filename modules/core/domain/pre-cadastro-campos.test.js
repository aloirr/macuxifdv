import { describe, expect, it } from 'vitest';
import { motivoSoDeCamposFaltantes, camposObrigatoriosPreCadastro, ehSempreObrigatorio, obrigatoriosDoPreCadastro, projecaoLegadaObrigatorios, podePreCadastrarCliente, situacaoDoPreCadastro, validarPreCadastro, } from './pre-cadastro-campos';
describe('pré-cadastro: campos obrigatórios efetivos (RN-CORE-79)', () => {
    it('RN-CORE-79: efetivos = sempre obrigatórios ∪ parâmetro, na ordem canônica, sem repetir', () => {
        expect(camposObrigatoriosPreCadastro([])).toEqual(['razao_social', 'documento']);
        expect(camposObrigatoriosPreCadastro(['email', 'telefone', 'email'])).toEqual(['razao_social', 'documento', 'telefone', 'email']);
    });
    it('RN-CORE-79: razão social e documento ficam travados', () => {
        expect(ehSempreObrigatorio('documento')).toBe(true);
        expect(ehSempreObrigatorio('email')).toBe(false);
    });
});
describe('pré-cadastro: validação do formulário (RN-CORE-79)', () => {
    const base = { razao_social: 'Mercado Boa Vista', documento: '11.222.333/0001-81' };
    const obrig = camposObrigatoriosPreCadastro(['telefone', 'endereco']);
    it('RN-CORE-79: CNPJ com dígito verificador errado é recusado; CNPJ e CPF válidos passam, com ou sem máscara', () => {
        expect(validarPreCadastro({ ...base, documento: '11.222.333/0001-80' }, ['razao_social', 'documento']).erros.documento).toBe('CNPJ inválido');
        expect(validarPreCadastro({ ...base, documento: '111.111.111-11' }, ['razao_social', 'documento']).erros.documento).toBe('CPF inválido');
        expect(validarPreCadastro(base, ['razao_social', 'documento']).ok).toBe(true);
        expect(validarPreCadastro({ ...base, documento: '52998224725' }, ['razao_social', 'documento']).ok).toBe(true);
    });
    it('RN-CORE-79: obrigatório vazio ou só espaço aponta o campo; endereço vale pelo grupo todo', () => {
        const r = validarPreCadastro({ ...base, razao_social: '  ', telefone: '', logradouro: 'Rua A', numero: '1' }, obrig);
        expect(Object.keys(r.erros).sort()).toEqual(['bairro', 'cep', 'cidade', 'razao_social', 'telefone', 'uf']);
        expect(r.erros.cep).toBe('Obrigatório');
    });
    it('RN-CORE-79: opcional vazio passa; opcional preenchido e inválido (CEP, telefone, e-mail) é recusado', () => {
        expect(validarPreCadastro({ ...base, email: '', cep: '' }, ['razao_social', 'documento']).ok).toBe(true);
        const r = validarPreCadastro({ ...base, cep: '123', telefone: '9299', email: 'sem-arroba' }, ['razao_social', 'documento']);
        expect(r.erros).toEqual({ cep: 'CEP inválido', telefone: 'Telefone inválido', email: 'E-mail inválido' });
    });
});
describe('pré-cadastro: perfil e selo (RN-CORE-78)', () => {
    it('RN-CORE-78: só o vendedor pré-cadastra; promotor e gestão não', () => {
        expect(podePreCadastrarCliente('vendedor')).toBe(true);
        for (const p of ['promotor', 'supervisor', 'gerente', 'admin'])
            expect(podePreCadastrarCliente(p)).toBe(false);
    });
    it('RN-CORE-78: pendente ou sem código = aguardando o ERP', () => {
        expect(situacaoDoPreCadastro({ status_cadastro: 'pendente', external_id: null }).situacao).toBe('aguardando_erp');
        expect(situacaoDoPreCadastro({ external_id: null }).situacao).toBe('aguardando_erp');
    });
    it('RN-CORE-78: recusado mostra o motivo do ERP', () => {
        expect(situacaoDoPreCadastro({ status_cadastro: 'recusado', external_id: null, motivo_recusa: ' CNPJ duplicado ' })).toEqual({ situacao: 'recusado_erp', motivo: 'CNPJ duplicado' });
    });
    it('RN-CORE-78: com o código do ERP o cliente está aprovado (sem selo)', () => {
        expect(situacaoDoPreCadastro({ status_cadastro: 'aprovado', external_id: 'C-100' }).situacao).toBe('aprovado_erp');
        expect(situacaoDoPreCadastro({ external_id: 'C-100' }).situacao).toBe('aprovado_erp');
    });
});
describe('pré-cadastro: motivo do 422 (RN-CORE-78)', () => {
    it('RN-CORE-78: só a lista "Preencha ..." do servidor é motivo de campo; recusa do ERP e 409 ficam no topo', () => {
        expect(motivoSoDeCamposFaltantes('Preencha o telefone. Preencha o endereço.')).toBe(true);
        expect(motivoSoDeCamposFaltantes('CNPJ duplicado no ERP')).toBe(false);
        expect(motivoSoDeCamposFaltantes(null)).toBe(false);
    });
});
describe('pré-cadastro: lista única de obrigatórios (RN-CORE-16, RN-CORE-79; v1.0.30)', () => {
    it('RN-CORE-79: obrigatórios do pré-cadastro = os exigidos menos complemento e geolocalização, com os fixos sempre, na ordem canônica', () => {
        expect(obrigatoriosDoPreCadastro(['cep', 'complemento', 'geolocalizacao', 'telefone'])).toEqual(['razao_social', 'documento', 'cep', 'telefone']);
        expect(obrigatoriosDoPreCadastro([])).toEqual(['razao_social', 'documento']);
    });
    it('RN-CORE-79: com a lista única, a IE só é exigida para CNPJ e "isento" vale', () => {
        const exigidos = obrigatoriosDoPreCadastro(['inscricao_estadual']);
        expect(validarPreCadastro({ razao_social: 'Mercado', documento: '52998224725' }, exigidos).ok).toBe(true);
        expect(validarPreCadastro({ razao_social: 'Mercado', documento: '11.222.333/0001-81' }, exigidos).erros).toEqual({ inscricao_estadual: 'Obrigatório' });
        expect(validarPreCadastro({ razao_social: 'Mercado', documento: '11.222.333/0001-81', inscricao_estadual: 'isento' }, exigidos).ok).toBe(true);
    });
    it('RN-CORE-79: razão social e CPF/CNPJ são exigidos mesmo fora da lista; geolocalização e complemento nunca', () => {
        const r = validarPreCadastro({ razao_social: ' ' }, ['geolocalizacao', 'complemento']);
        expect(r.erros).toEqual({ razao_social: 'Obrigatório', documento: 'Obrigatório' });
    });
    it('RN-CORE-79: projeção legada para o APK v1.0.28 é igual ou mais exigente (endereço entra com qualquer campo de endereço)', () => {
        expect(projecaoLegadaObrigatorios(['razao_social', 'documento', 'cep'])).toEqual(['endereco']);
        expect(projecaoLegadaObrigatorios(['email', 'inscricao_estadual', 'telefone', 'nome_fantasia'])).toEqual(['nome_fantasia', 'inscricao_estadual', 'telefone', 'email']);
        expect(projecaoLegadaObrigatorios(['razao_social', 'documento', 'complemento', 'geolocalizacao'])).toEqual([]);
    });
});
