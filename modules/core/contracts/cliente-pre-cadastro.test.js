import { describe, expect, it } from 'vitest';
import { CAMPOS_PRE_CADASTRO_CONFIGURAVEIS, CAMPOS_PRE_CADASTRO_SEMPRE, CODIGOS_ERRO_PRE_CADASTRO, CodigoFdvClienteSchema, CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP, ClientePreCadastradoSchema, ClientePreCadastroParaErpSchema, ClientePreCadastroRevisadoSchema, CorrecaoPreCadastroSchema, ERROS_RECUSA_MAX, EVENTO_CLIENTE_PRE_CADASTRADO, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO, ErroCampoCadastroSchema, ErrosCampoCadastroSchema, HTTP_ERRO_PRE_CADASTRO, HashPreCadastroSchema, HistoricoPreCadastroSchema, MENSAGENS_ERRO_PRE_CADASTRO, PreCadastroAtualSchema, PreCadastroClienteSaidaSchema, RecusadosEntradaSchema, RecusadosSaidaSchema, TentativaPreCadastroSchema, ObrigatoriosPreCadastroSchema, PARAMETRO_PRE_CADASTRO_OBRIGATORIOS, ParametroPreCadastroSchema, PreCadastroClienteSchema, ROTULOS_CAMPOS_PRE_CADASTRO, obrigatoriosPreCadastroDasLinhas, } from './cliente-pre-cadastro';
import { ClienteSyncSchema } from './sync';
const id = '11111111-1111-4111-8111-111111111111';
describe('core.cliente.pre_cadastrado@1', () => {
    it('RN-CORE-78: evento só com ids e carimbo', () => {
        expect(EVENTO_CLIENTE_PRE_CADASTRADO.nome).toBe('core.cliente.pre_cadastrado@1');
        expect(ClientePreCadastradoSchema.safeParse({ cliente_id: id, recebido_em: '2026-11-23T12:00:00.000Z' }).success).toBe(true);
        expect(ClientePreCadastradoSchema.safeParse({ cliente_id: id, recebido_em: 'x' }).success).toBe(false);
    });
    it('RN-INT-22: consulta limita o lote a 500', () => {
        expect(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP.nome).toBe('core.clientes_pre_cadastro_sem_erp@1');
        expect(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP.entrada.safeParse({ limite: 501 }).success).toBe(false);
    });
});
describe('pré-cadastro', () => {
    it('RN-CORE-79: documento é sempre obrigatório e é normalizado', () => {
        const ok = PreCadastroClienteSchema.parse({ id, origem: 'campo', razao_social: ' Mercado X ', documento: '12.345.678/0001-95', uf: 'am' });
        expect(ok).toMatchObject({ razao_social: 'Mercado X', documento: '12345678000195', uf: 'AM' });
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', razao_social: 'X' }).success).toBe(false);
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', razao_social: 'X', documento: '123' }).success).toBe(false);
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'erp', razao_social: 'X', documento: '12345678901' }).success).toBe(false);
    });
    it('RN-CORE-79: todo campo tem rótulo e o parâmetro recusa repetição e chave desconhecida', () => {
        for (const c of [...CAMPOS_PRE_CADASTRO_SEMPRE, ...CAMPOS_PRE_CADASTRO_CONFIGURAVEIS])
            expect(ROTULOS_CAMPOS_PRE_CADASTRO[c]).toBeTruthy();
        expect(ObrigatoriosPreCadastroSchema.safeParse(['email', 'endereco']).success).toBe(true);
        expect(ObrigatoriosPreCadastroSchema.safeParse(['email', 'email']).success).toBe(false);
        expect(ObrigatoriosPreCadastroSchema.safeParse(['razao_social']).success).toBe(false);
        expect(ParametroPreCadastroSchema.safeParse({ obrigatorios: ['telefone'], x: 1 }).success).toBe(false);
    });
    it('RN-CORE-79: obrigatoriosPreCadastroDasLinhas usa o padrão (nenhum) sem linha viva ou com valor inválido', () => {
        const k = PARAMETRO_PRE_CADASTRO_OBRIGATORIOS;
        expect(obrigatoriosPreCadastroDasLinhas([])).toEqual([]);
        expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email', 'endereco'] }])).toEqual(['email', 'endereco']);
        expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email'], deleted_at: '2026-11-23T00:00:00Z' }])).toEqual([]);
        expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'outro', chave: k, valor: ['email'] }])).toEqual([]);
        expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email', 'email'] }])).toEqual([]);
    });
});
describe('pré-cadastro: revisão e histórico (v1.0.30, ADR 0069)', () => {
    const H = 'a'.repeat(64);
    const dados = { razao_social: 'Mercado X', documento: '12.345.678/0001-95' };
    it('RN-CORE-78: revisao_base é opcional na criação (o APK v1.0.28 não manda) e começa em 1', () => {
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', ...dados }).success).toBe(true);
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', ...dados, revisao_base: 2 }).success).toBe(true);
        expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', ...dados, revisao_base: 0 }).success).toBe(false);
    });
    it('RN-CORE-78: a correção do BKO exige revisao_base e não aceita id nem origem no corpo', () => {
        expect(CorrecaoPreCadastroSchema.parse({ ...dados, revisao_base: 1 })).toMatchObject({ documento: '12345678000195', revisao_base: 1 });
        expect(CorrecaoPreCadastroSchema.safeParse(dados).success).toBe(false);
        expect(CorrecaoPreCadastroSchema.safeParse({ ...dados, revisao_base: 1, id }).success).toBe(false);
        expect(CorrecaoPreCadastroSchema.safeParse({ ...dados, revisao_base: 1, origem: 'bko' }).success).toBe(false);
    });
    it('RN-CORE-78: a resposta traz a revisão; o hash é sha256 em hexadecimal minúsculo', () => {
        expect(PreCadastroClienteSaidaSchema.safeParse({ id, status_cadastro: 'pendente', revisao: 2, ja_existia: false }).success).toBe(true);
        expect(PreCadastroClienteSaidaSchema.safeParse({ id, status_cadastro: 'pendente', ja_existia: false }).success).toBe(false);
        expect(HashPreCadastroSchema.safeParse(H).success).toBe(true);
        expect(HashPreCadastroSchema.safeParse('A'.repeat(64)).success).toBe(false);
    });
    it('RN-CORE-78: erros por campo limitados a 50 itens e 300 caracteres na mensagem', () => {
        const e = { campo: 'cep', codigo: 'INVALIDO', mensagem: 'CEP não existe' };
        expect(ErrosCampoCadastroSchema.safeParse(Array.from({ length: ERROS_RECUSA_MAX }, () => e)).success).toBe(true);
        expect(ErrosCampoCadastroSchema.safeParse(Array.from({ length: ERROS_RECUSA_MAX + 1 }, () => e)).success).toBe(false);
        expect(ErroCampoCadastroSchema.safeParse({ ...e, mensagem: 'x'.repeat(301) }).success).toBe(false);
        expect(ErroCampoCadastroSchema.safeParse({ ...e, valor: '1' }).success).toBe(false);
    });
    it('RN-CORE-78: tentativa do histórico guarda só nomes de campo; hash nulo = tentativa anterior à v1.0.30', () => {
        const t = { revisao: 1, hash: null, origem: 'campo', corrigido_por: null, enviado_em: '2026-11-23T12:00:00.000Z', campos_alterados: [], resultado: 'recusado', respondido_em: '2026-11-23T13:00:00.000Z', motivo: 'CNPJ inativo', erros: [], cliente_id_original: null };
        expect(HistoricoPreCadastroSchema.safeParse({ cliente_id: id, revisao_atual: 2, tentativas: [t, { ...t, revisao: 2, hash: H, origem: 'bko', resultado: 'aguardando', respondido_em: null, motivo: null, campos_alterados: ['cep'] }] }).success).toBe(true);
        expect(TentativaPreCadastroSchema.safeParse({ ...t, resultado: 'pendente' }).success).toBe(false);
    });
    it('RN-CORE-78: lista de recusados do BKO filtra por situação (padrão recusado) e traz o documento mascarado', () => {
        expect(RecusadosEntradaSchema.parse({})).toEqual({ situacao: 'recusado', limite: 50 });
        expect(RecusadosEntradaSchema.parse({ situacao: 'reenviado', limite: '20' })).toMatchObject({ situacao: 'reenviado', limite: 20 });
        expect(RecusadosEntradaSchema.safeParse({ limite: 201 }).success).toBe(false);
        expect(RecusadosEntradaSchema.safeParse({ ordem: 'x' }).success).toBe(false);
        const item = { cliente_id: id, revisao: 1, documento_mascarado: '12.345.678/****-**', razao_social: 'Mercado X', vendedor: null, recusado_em: '2026-11-23T13:00:00.000Z', motivo: null, erros: [], situacao: 'recusado' };
        expect(RecusadosSaidaSchema.safeParse({ itens: [item], proximo_cursor: null }).success).toBe(true);
    });
    it('RN-CORE-78: dados atuais para o formulário de correção trazem revisão, situação, motivo e erros', () => {
        expect(PreCadastroAtualSchema.safeParse({ ...dados, id, revisao: 1, status_cadastro: 'recusado', motivo: 'CNPJ inativo', erros: [] }).success).toBe(true);
        expect(PreCadastroAtualSchema.safeParse({ ...dados, id, revisao: 1, status_cadastro: 'recusado', motivo: null }).success).toBe(false);
    });
    it('RN-CORE-78: core.cliente.pre_cadastro_revisado@1 leva só ids, revisão, origem e carimbo', () => {
        expect(EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome).toBe('core.cliente.pre_cadastro_revisado@1');
        expect(ClientePreCadastroRevisadoSchema.safeParse({ cliente_id: id, revisao: 2, origem: 'bko', revisado_em: '2026-11-23T12:00:00.000Z' }).success).toBe(true);
        expect(ClientePreCadastroRevisadoSchema.safeParse({ cliente_id: id, revisao: 2, origem: 'erp', revisado_em: '2026-11-23T12:00:00.000Z' }).success).toBe(false);
    });
    it('RN-INT-22: a consulta sem ERP aceita revisão e hash (aditivos) e o emissor antigo sem eles', () => {
        const c = { cliente_id: id, recebido_em: '2026-11-23T12:00:00.000Z', razao_social: 'X', nome_fantasia: null, documento: null, inscricao_estadual: null, telefone: null, email: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, filial_external_id: null };
        expect(ClientePreCadastroParaErpSchema.safeParse(c).success).toBe(true);
        expect(ClientePreCadastroParaErpSchema.safeParse({ ...c, revisao: 2, hash: H }).success).toBe(true);
        expect(ClientePreCadastroParaErpSchema.safeParse({ ...c, revisao: 0 }).success).toBe(false);
    });
    it('RN-CORE-78: todo código de erro tem HTTP; os de regra têm texto com a ação seguinte', () => {
        for (const c of CODIGOS_ERRO_PRE_CADASTRO)
            expect([404, 409, 422]).toContain(HTTP_ERRO_PRE_CADASTRO[c]);
        expect(HTTP_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA).toBe(409);
        expect(HTTP_ERRO_PRE_CADASTRO.CADASTRO_NAO_RECUSADO).toBe(422);
        expect(MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA).toMatch(/Recarregue/);
    });
});
describe('Código FDV do cliente (v1.0.30, ADR 0069 item 10)', () => {
    const H = 'a'.repeat(64);
    const base = { id, updated_at: '2026-11-23T12:00:00.000Z', deleted_at: null, external_id: null, documento: null, razao_social: 'X', nome_fantasia: null, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true };
    it('RN-CORE-78: o Código FDV do cliente é só dígitos, no mínimo 5 (00001...; 100000 depois de 99999)', () => {
        expect(CodigoFdvClienteSchema.safeParse('00001').success).toBe(true);
        expect(CodigoFdvClienteSchema.safeParse('100000').success).toBe(true);
        for (const v of ['0001', '0000A', ' 00001', ''])
            expect(CodigoFdvClienteSchema.safeParse(v).success).toBe(false);
    });
    it('RN-CORE-78: pull e Cliente 360 levam o codigo_fdv em todo cliente, inclusive o do ERP (aditivo: ausente = emissor antigo)', () => {
        expect(ClienteSyncSchema.safeParse(base).success).toBe(true);
        expect(ClienteSyncSchema.safeParse({ ...base, codigo_fdv: null }).success).toBe(true);
        expect(ClienteSyncSchema.parse({ ...base, codigo_fdv: '00042' }).codigo_fdv).toBe('00042');
        expect(ClienteSyncSchema.parse({ ...base, external_id: 'C-900', revisao_cadastro: null, codigo_fdv: '00043' })).toMatchObject({ external_id: 'C-900', codigo_fdv: '00043' });
        expect(ClienteSyncSchema.safeParse({ ...base, codigo_fdv: '42' }).success).toBe(false);
    });
    it('RN-CORE-78: lista de recusados, dados atuais (com o código do ERP), resposta da gravação e consulta do Hub levam o codigo_fdv', () => {
        const item = { cliente_id: id, revisao: 1, documento_mascarado: null, razao_social: 'X', vendedor: null, recusado_em: '2026-11-23T13:00:00.000Z', motivo: null, erros: [], situacao: 'recusado' };
        expect(RecusadosSaidaSchema.parse({ itens: [{ ...item, codigo_fdv: '00007' }], proximo_cursor: null }).itens[0].codigo_fdv).toBe('00007');
        expect(RecusadosSaidaSchema.safeParse({ itens: [item], proximo_cursor: null }).success).toBe(true);
        const atual = { razao_social: 'X', documento: '11222333000181', id, revisao: 1, status_cadastro: 'recusado', motivo: null, erros: [] };
        expect(PreCadastroAtualSchema.parse({ ...atual, codigo_fdv: '00007', external_id: null })).toMatchObject({ codigo_fdv: '00007', external_id: null });
        expect(PreCadastroAtualSchema.safeParse({ ...atual, codigo_fdv: 'x' }).success).toBe(false);
        expect(PreCadastroClienteSaidaSchema.safeParse({ id, status_cadastro: 'pendente', revisao: 1, ja_existia: false, codigo_fdv: '00007' }).success).toBe(true);
        const c = { cliente_id: id, recebido_em: '2026-11-23T12:00:00.000Z', razao_social: 'X', nome_fantasia: null, documento: null, inscricao_estadual: null, telefone: null, email: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, filial_external_id: null, revisao: 1, hash: H };
        expect(ClientePreCadastroParaErpSchema.safeParse({ ...c, codigo_fdv: '00007' }).success).toBe(true);
        expect(ClientePreCadastroParaErpSchema.safeParse({ ...c, codigo_fdv: '7' }).success).toBe(false);
    });
    it('RN-CORE-78: codigo_fdv no corpo da gravação passa pelo schema só para a API recusar com 422 CODIGO_FDV_SOMENTE_LEITURA', () => {
        const corpo = { id, origem: 'bko', razao_social: 'X', documento: '11222333000181', codigo_fdv: '00001' };
        expect(PreCadastroClienteSchema.safeParse(corpo).success).toBe(true);
        expect(CorrecaoPreCadastroSchema.safeParse({ razao_social: 'X', documento: '11222333000181', revisao_base: 1, codigo_fdv: '00001' }).success).toBe(true);
        expect(CODIGOS_ERRO_PRE_CADASTRO).toContain('CODIGO_FDV_SOMENTE_LEITURA');
        expect(HTTP_ERRO_PRE_CADASTRO.CODIGO_FDV_SOMENTE_LEITURA).toBe(422);
        expect(MENSAGENS_ERRO_PRE_CADASTRO.CODIGO_FDV_SOMENTE_LEITURA).toMatch(/Tire o campo/);
    });
});
