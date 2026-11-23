import { describe, expect, it } from 'vitest';
import { MARCADOR_DADO_PESSOAL } from '@macuxi/comum';
import {
  camposAlteradosPreCadastro,
  canonicalPreCadastro,
  decidirConflitoUnicidade,
  decidirDocumentoDuplicado,
  decidirReenvioPreCadastro,
  errosRecusaSeguros,
  motivoRecusaCortado,
  perfilVeRecusa,
  situacaoDoRecusado,
} from './cliente-pre-cadastro';

describe('motivoRecusaCortado', () => {
  it('RN-CORE-78: o motivo do ERP é guardado até 500 caracteres e vazio vira nulo', () => {
    expect(motivoRecusaCortado('x'.repeat(600))).toHaveLength(500);
    expect(motivoRecusaCortado('  ')).toBeNull();
    expect(motivoRecusaCortado(undefined)).toBeNull();
    expect(motivoRecusaCortado(' CNPJ inativo ')).toBe('CNPJ inativo');
  });
});

describe('decidirDocumentoDuplicado', () => {
  it('RN-CORE-78: documento de cliente pendente ou aprovado bloqueia o novo pré-cadastro', () => {
    expect(decidirDocumentoDuplicado([{ id: 'a', status_cadastro: 'pendente' }])).toEqual({ bloqueia: true, remover: [], substituir: null });
    expect(decidirDocumentoDuplicado([{ id: 'a', status_cadastro: 'aprovado' }, { id: 'b', status_cadastro: 'recusado' }])).toEqual({ bloqueia: true, remover: [], substituir: null });
    expect(decidirDocumentoDuplicado([{ id: 'a', status_cadastro: null }])).toEqual({ bloqueia: true, remover: [], substituir: null });
  });
  it('RN-CORE-78: id novo do APK v1.0.28 com o documento de um recusado substitui o recusado e herda a revisão dele', () => {
    expect(decidirDocumentoDuplicado([{ id: 'a', status_cadastro: 'recusado', revisao_cadastro: 2 }])).toEqual({ bloqueia: false, remover: ['a'], substituir: { id: 'a', revisao: 2 } });
    expect(decidirDocumentoDuplicado([{ id: 'a', status_cadastro: 'recusado' }])).toEqual({ bloqueia: false, remover: ['a'], substituir: { id: 'a', revisao: 1 } });
    expect(decidirDocumentoDuplicado([])).toEqual({ bloqueia: false, remover: [], substituir: null });
  });
  it('RN-CORE-78: legado com mais de um recusado vivo: substitui o de maior revisão e remove todos', () => {
    const r = decidirDocumentoDuplicado([{ id: 'a', status_cadastro: 'recusado', revisao_cadastro: 1 }, { id: 'b', status_cadastro: 'recusado', revisao_cadastro: 3 }]);
    expect(r).toEqual({ bloqueia: false, remover: ['a', 'b'], substituir: { id: 'b', revisao: 3 } });
  });
});

describe('perfilVeRecusa', () => {
  it('RN-CORE-78: só o vendedor vê o motivo e os erros por campo da recusa do ERP', () => {
    expect(perfilVeRecusa('vendedor')).toBe(true);
    for (const p of ['promotor', 'supervisor', 'gerente', 'analista', 'admin']) expect(perfilVeRecusa(p)).toBe(false);
  });
});

const ID = '11111111-1111-4111-8111-111111111111';
const FILIAL = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

describe('canonicalPreCadastro (hash v1)', () => {
  it('RN-CORE-78: chaves fixas, todas presentes, em ordem lexicográfica, sem espaços', () => {
    expect(canonicalPreCadastro({ razao_social: 'Mercado X', documento: '12345678000195' })).toBe(
      '{"bairro":null,"cep":null,"cidade":null,"documento":"12345678000195","email":null,"filial_id":null,"inscricao_estadual":null,"latitude":null,"logradouro":null,"longitude":null,"nome_fantasia":null,"numero":null,"razao_social":"Mercado X","telefone":null,"uf":null}',
    );
  });
  it('RN-CORE-78: normaliza texto (trim, vazio nulo, dígitos, caixa da UF, do e-mail e da IE), coordenadas e filial', () => {
    const c = JSON.parse(
      canonicalPreCadastro({
        razao_social: '  Mercado Ação ',
        documento: '12.345.678/0001-95',
        cep: '69000-000',
        telefone: '(92) 99999-0000',
        uf: ' am ',
        email: ' Loja@Exemplo.COM ',
        inscricao_estadual: 'isento',
        nome_fantasia: '   ',
        bairro: undefined,
        latitude: -3.1234567,
        longitude: '-60.0000004',
        filial_id: FILIAL,
      }),
    ) as Record<string, unknown>;
    expect(c).toMatchObject({ razao_social: 'Mercado Ação', documento: '12345678000195', cep: '69000000', telefone: '92999990000', uf: 'AM', email: 'loja@exemplo.com', inscricao_estadual: 'ISENTO', nome_fantasia: null, bairro: null, latitude: -3.123457, longitude: -60, filial_id: FILIAL.toLowerCase() });
  });
  it('RN-CORE-78 (ADR 0069 §2): a coordenada arredonda em 6 casas como o numeric(9, 6) do Postgres, o meio para longe do zero', () => {
    const coord = (v: unknown) => (JSON.parse(canonicalPreCadastro({ latitude: v as number })) as { latitude: number | null }).latitude;
    expect(coord(-3.1234565)).toBe(-3.123457);
    expect(coord(3.1234565)).toBe(3.123457);
    expect(coord('-60.0000005')).toBe(-60.000001);
    expect(coord(-0.0000004)).toBe(0);
    expect(coord(-3.1234564999)).toBe(-3.123456);
    expect(coord(-3.12)).toBe(-3.12);
    expect(coord(1e-7)).toBe(0);
    expect(coord('abc')).toBeNull();
  });
  it('RN-CORE-78: fica fora do hash o que não é dado do cliente (id, origem, revisao_base)', () => {
    const d = { razao_social: 'X', documento: '12345678901' };
    expect(canonicalPreCadastro({ ...d, id: ID, origem: 'campo', revisao_base: 2 })).toBe(canonicalPreCadastro(d));
  });
});

describe('camposAlteradosPreCadastro', () => {
  it('RN-CORE-78: compara pelos valores canônicos e devolve só os nomes, na ordem canônica', () => {
    const antes = { razao_social: 'X', documento: '12.345.678/0001-95', uf: 'am', telefone: '92 99999-0000' };
    expect(camposAlteradosPreCadastro(antes, { razao_social: 'X ', documento: '12345678000195', uf: 'AM', telefone: '92999990000' })).toEqual([]);
    expect(camposAlteradosPreCadastro(antes, { ...antes, uf: 'RR', cep: '69300000', razao_social: 'Y' })).toEqual(['cep', 'razao_social', 'uf']);
  });
});

describe('decidirReenvioPreCadastro', () => {
  const H1 = '1'.repeat(64);
  const H2 = '2'.repeat(64);
  it('RN-CORE-78: recusado com revisao_base igual à atual vira revisão nova', () => {
    expect(decidirReenvioPreCadastro({ status_cadastro: 'recusado', revisao_cadastro: 2, hash_atual: H1 }, { revisao_base: 2, hash: H2 })).toEqual({ acao: 'nova_revisao', revisao: 3 });
  });
  it('RN-CORE-78: reenviar sem mudar nada também é revisão nova (o ERP pode ter resolvido do lado dele)', () => {
    expect(decidirReenvioPreCadastro({ status_cadastro: 'recusado', revisao_cadastro: 1, hash_atual: H1 }, { revisao_base: 1, hash: H1 })).toEqual({ acao: 'nova_revisao', revisao: 2 });
  });
  it('RN-CORE-78: a revisão anterior com o mesmo hash da atual é repetição idempotente', () => {
    expect(decidirReenvioPreCadastro({ status_cadastro: 'pendente', revisao_cadastro: 2, hash_atual: H2 }, { revisao_base: 1, hash: H2 })).toEqual({ acao: 'repetido' });
  });
  it('RN-CORE-78: qualquer outra revisão base é REVISAO_DESATUALIZADA (409)', () => {
    const r = { acao: 'recusar', http: 409, codigo: 'REVISAO_DESATUALIZADA' };
    expect(decidirReenvioPreCadastro({ status_cadastro: 'pendente', revisao_cadastro: 2, hash_atual: H2 }, { revisao_base: 1, hash: H1 })).toEqual(r);
    expect(decidirReenvioPreCadastro({ status_cadastro: 'recusado', revisao_cadastro: 3, hash_atual: H2 }, { revisao_base: 1, hash: H2 })).toEqual(r);
    expect(decidirReenvioPreCadastro({ status_cadastro: 'recusado', revisao_cadastro: 2, hash_atual: H2 }, { revisao_base: 5, hash: H2 })).toEqual(r);
  });
  it('RN-CORE-78: pendente, aprovado ou sem situação na revisão atual é CADASTRO_NAO_RECUSADO (422)', () => {
    const r = { acao: 'recusar', http: 422, codigo: 'CADASTRO_NAO_RECUSADO' };
    for (const status_cadastro of ['pendente', 'aprovado', null] as const) expect(decidirReenvioPreCadastro({ status_cadastro, revisao_cadastro: 1, hash_atual: H1 }, { revisao_base: 1, hash: H2 })).toEqual(r);
  });
  it('RN-CORE-78: cliente inexistente (ou de outro tenant) é NAO_ENCONTRADO (404)', () => {
    expect(decidirReenvioPreCadastro(null, { revisao_base: 1, hash: H1 })).toEqual({ acao: 'recusar', http: 404, codigo: 'NAO_ENCONTRADO' });
  });
});

describe('decidirConflitoUnicidade (23505)', () => {
  it('RN-CORE-78: cliente_pkey com o id vivo no tenant é a idempotência (ja_existia)', () => {
    expect(decidirConflitoUnicidade({ restricao: 'cliente_pkey', id: ID, porId: { status_cadastro: 'pendente', apagado: false }, porDocumento: null })).toEqual({ resposta: 'ja_existia', status_cadastro: 'pendente' });
    expect(decidirConflitoUnicidade({ restricao: 'cliente_pkey', id: ID, porId: { status_cadastro: null, apagado: false }, porDocumento: null })).toEqual({ resposta: 'ja_existia', status_cadastro: 'aprovado' });
  });
  it('RN-CORE-78: cliente_pkey com o id apagado ou de outro tenant é CADASTRO_INDISPONIVEL', () => {
    const r = { resposta: 'erro', codigo: 'CADASTRO_INDISPONIVEL' };
    expect(decidirConflitoUnicidade({ restricao: 'cliente_pkey', id: ID, porId: { status_cadastro: 'pendente', apagado: true }, porDocumento: null })).toEqual(r);
    expect(decidirConflitoUnicidade({ restricao: 'cliente_pkey', id: ID, porId: null, porDocumento: null })).toEqual(r);
  });
  it('RN-CORE-78: cliente_documento_uk do mesmo id é ja_existia; de outro id é DOCUMENTO_JA_CADASTRADO', () => {
    expect(decidirConflitoUnicidade({ restricao: 'cliente_documento_uk', id: ID, porId: { status_cadastro: 'pendente', apagado: false }, porDocumento: { id: ID } })).toEqual({ resposta: 'ja_existia', status_cadastro: 'pendente' });
    expect(decidirConflitoUnicidade({ restricao: 'cliente_documento_uk', id: ID, porId: null, porDocumento: { id: 'outro' } })).toEqual({ resposta: 'erro', codigo: 'DOCUMENTO_JA_CADASTRADO' });
    expect(decidirConflitoUnicidade({ restricao: 'cliente_documento_uk', id: ID, porId: null, porDocumento: null })).toEqual({ resposta: 'erro', codigo: 'DOCUMENTO_JA_CADASTRADO' });
  });
  it('RN-CORE-78: outra restrição (ou sem nome) relança', () => {
    expect(decidirConflitoUnicidade({ restricao: 'outra_uk', id: ID, porId: null, porDocumento: null })).toEqual({ resposta: 'relancar' });
    expect(decidirConflitoUnicidade({ restricao: undefined, id: ID, porId: null, porDocumento: null })).toEqual({ resposta: 'relancar' });
  });
});

describe('situacaoDoRecusado (lista do BKO)', () => {
  it('RN-CORE-78: recusado, reenviado (pendente depois de corrigido) e aceito', () => {
    expect(situacaoDoRecusado({ status_cadastro: 'recusado', revisao_cadastro: 1 })).toBe('recusado');
    expect(situacaoDoRecusado({ status_cadastro: 'pendente', revisao_cadastro: 2 })).toBe('reenviado');
    expect(situacaoDoRecusado({ status_cadastro: 'aprovado', revisao_cadastro: 3 })).toBe('aceito');
  });
  it('RN-CORE-78: pendente da primeira revisão ou cliente sem situação não entra na lista', () => {
    expect(situacaoDoRecusado({ status_cadastro: 'pendente', revisao_cadastro: 1 })).toBeNull();
    expect(situacaoDoRecusado({ status_cadastro: null, revisao_cadastro: null })).toBeNull();
  });
});

describe('errosRecusaSeguros', () => {
  it('RN-CORE-78: guarda só itens válidos, até 50, mensagem até 300 caracteres e sem dado pessoal', () => {
    const r = errosRecusaSeguros([
      { campo: ' email ', codigo: 'INVALIDO', mensagem: 'E-mail loja@exemplo.com não aceito' },
      { campo: '', codigo: 'X', mensagem: 'sem campo' },
      'lixo',
      { campo: 'obs', codigo: 'LONGO', mensagem: 'y'.repeat(400) },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ campo: 'email', codigo: 'INVALIDO' });
    expect(r[0]!.mensagem).not.toContain('loja@exemplo.com');
    expect(r[0]!.mensagem).toContain(MARCADOR_DADO_PESSOAL.email);
    expect(r[1]!.mensagem).toHaveLength(300);
    expect(errosRecusaSeguros(Array.from({ length: 60 }, () => ({ campo: 'c', codigo: 'k', mensagem: 'm' })))).toHaveLength(50);
  });
  it('RN-CORE-78 e RN-INT-22: campo, código e mensagem saem sem dado pessoal', () => {
    const [e] = errosRecusaSeguros([{ campo: ' fulano@x.com.br ', codigo: '123.456.789-09', mensagem: 'Fone (92) 99123-4567 inválido' }]);
    expect(e).toEqual({ campo: MARCADOR_DADO_PESSOAL.email, codigo: MARCADOR_DADO_PESSOAL.cpf, mensagem: `Fone ${MARCADOR_DADO_PESSOAL.telefone} inválido` });
  });
  it('RN-CORE-78: entrada que não é lista vira lista vazia', () => {
    expect(errosRecusaSeguros(null)).toEqual([]);
    expect(errosRecusaSeguros({ campo: 'c' })).toEqual([]);
  });
});
