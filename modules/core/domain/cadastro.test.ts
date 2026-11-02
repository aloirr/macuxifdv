import { completarCnpj, completarCpf } from '@macuxi/comum';
import { describe, expect, it } from 'vitest';
import {
  CAMPOS_CADASTRO_PADRAO,
  ROTULO_CAMPO_CADASTRO,
  cadastroCompleto,
  camposExigidos,
  observacaoComCadastro,
  type DadosCadastro,
} from './cadastro';

const CNPJ = completarCnpj('123456780001');
const CPF = completarCpf('123456789');
/** Troca o último dígito para quebrar o dígito verificador. */
const quebrar = (doc: string) => doc.slice(0, -1) + (doc.endsWith('0') ? '1' : '0');

const pj: DadosCadastro = {
  razao_social: 'Mercearia Boa Vista Ltda',
  documento: CNPJ,
  inscricao_estadual: '123456',
  logradouro: 'Rua das Flores',
  numero: '100',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69000-000',
};

describe('RN-CORE-16: cadastroCompleto', () => {
  it('RN-CORE-16: cadastro PJ com todos os campos do padrão é completo', () => {
    expect(cadastroCompleto(pj, CAMPOS_CADASTRO_PADRAO)).toEqual({ completo: true, campos_faltantes: [] });
  });

  it('RN-CORE-16: CNPJ com dígito verificador inválido conta como ausente', () => {
    expect(cadastroCompleto({ ...pj, documento: quebrar(CNPJ) }, CAMPOS_CADASTRO_PADRAO)).toEqual({ completo: false, campos_faltantes: ['documento'] });
  });

  it('RN-CORE-16: CNPJ válido com máscara é aceito', () => {
    const mascarado = `${CNPJ.slice(0, 2)}.${CNPJ.slice(2, 5)}.${CNPJ.slice(5, 8)}/${CNPJ.slice(8, 12)}-${CNPJ.slice(12)}`;
    expect(cadastroCompleto({ ...pj, documento: mascarado }, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
  });

  it('RN-CORE-16: CPF válido dispensa a IE; CPF inválido conta como ausente', () => {
    const pf: DadosCadastro = { ...pj, documento: CPF, inscricao_estadual: null };
    expect(cadastroCompleto(pf, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
    expect(cadastroCompleto({ ...pf, documento: quebrar(CPF) }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['documento']);
  });

  it('RN-CORE-16: documento vazio ou nulo é ausente', () => {
    expect(cadastroCompleto({ ...pj, documento: '' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['documento']);
    expect(cadastroCompleto({ ...pj, documento: null }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['documento']);
  });

  it('RN-CORE-16: IE só é exigida para CNPJ; "isento" (qualquer caixa) conta como preenchida', () => {
    expect(cadastroCompleto({ ...pj, inscricao_estadual: null }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['inscricao_estadual']);
    expect(cadastroCompleto({ ...pj, inscricao_estadual: '  ' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['inscricao_estadual']);
    expect(cadastroCompleto({ ...pj, inscricao_estadual: 'Isento' }, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
    expect(cadastroCompleto({ ...pj, inscricao_estadual: 'ISENTO' }, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
  });

  it('RN-CORE-16: sem documento válido, a IE não é cobrada (só o documento falta)', () => {
    expect(cadastroCompleto({ ...pj, documento: null, inscricao_estadual: null }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['documento']);
  });

  it.each(['razao_social', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'] as const)('RN-CORE-16: faltando %s, o cadastro é incompleto só por ele', (campo) => {
    expect(cadastroCompleto({ ...pj, [campo]: null }, CAMPOS_CADASTRO_PADRAO)).toEqual({ completo: false, campos_faltantes: [campo] });
    expect(cadastroCompleto({ ...pj, [campo]: '   ' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual([campo]);
  });

  it('RN-CORE-16: UF e CEP malformados contam como ausentes', () => {
    expect(cadastroCompleto({ ...pj, uf: 'XX' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['uf']);
    expect(cadastroCompleto({ ...pj, uf: 'am' }, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
    expect(cadastroCompleto({ ...pj, cep: '6900' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['cep']);
    expect(cadastroCompleto({ ...pj, cep: '69000000' }, CAMPOS_CADASTRO_PADRAO).completo).toBe(true);
  });

  it('RN-CORE-16: vários faltando saem na ordem canônica da lista', () => {
    expect(cadastroCompleto({ ...pj, cep: null, documento: null, bairro: '' }, CAMPOS_CADASTRO_PADRAO).campos_faltantes).toEqual(['documento', 'bairro', 'cep']);
  });

  it('RN-CORE-16: lista do tenant com campo extra passa a exigi-lo', () => {
    const exigidos = camposExigidos([...CAMPOS_CADASTRO_PADRAO, 'telefone']);
    expect(cadastroCompleto(pj, exigidos).campos_faltantes).toEqual(['telefone']);
    expect(cadastroCompleto({ ...pj, telefone: '(92) 99999-0000' }, exigidos).completo).toBe(true);
  });

  it('RN-CORE-16: campo fora da lista do tenant não é cobrado', () => {
    const exigidos = camposExigidos(['razao_social', 'documento']);
    expect(cadastroCompleto({ razao_social: 'X', documento: CNPJ }, exigidos)).toEqual({ completo: true, campos_faltantes: [] });
  });

  it('RN-CORE-16: mesmo recebendo uma lista sem documento, cadastroCompleto sempre cobra o CNPJ/CPF', () => {
    expect(cadastroCompleto({ razao_social: 'X' }, ['razao_social']).campos_faltantes).toEqual(['documento']);
  });

  it('RN-CORE-16: geolocalização exige latitude e longitude', () => {
    const exigidos = camposExigidos([...CAMPOS_CADASTRO_PADRAO, 'geolocalizacao']);
    expect(cadastroCompleto({ ...pj, latitude: -3.1 }, exigidos).campos_faltantes).toEqual(['geolocalizacao']);
    expect(cadastroCompleto({ ...pj, latitude: -3.1, longitude: -60 }, exigidos).completo).toBe(true);
  });
});

describe('RN-CORE-16: camposExigidos', () => {
  it('RN-CORE-16: o tenant não pode tirar o CNPJ/CPF nem a razão social', () => {
    expect(camposExigidos(['cep'])).toEqual(['razao_social', 'documento', 'cep']);
    expect(camposExigidos(['razao_social', 'uf'])).toContain('documento');
  });

  it('RN-CORE-16: parâmetro ausente ou inválido usa o padrão; códigos desconhecidos são ignorados', () => {
    expect(camposExigidos(undefined)).toEqual([...CAMPOS_CADASTRO_PADRAO]);
    expect(camposExigidos('xpto')).toEqual([...CAMPOS_CADASTRO_PADRAO]);
    expect(camposExigidos([])).toEqual([...CAMPOS_CADASTRO_PADRAO]);
    expect(camposExigidos(['cep', 'inexistente'])).toEqual(['razao_social', 'documento', 'cep']);
  });

  it('RN-CORE-16: sem duplicados e na ordem canônica', () => {
    expect(camposExigidos(['cep', 'cep', 'uf'])).toEqual(['razao_social', 'documento', 'uf', 'cep']);
  });
});

describe('RN-CORE-17: observacaoComCadastro', () => {
  const linha = 'Cadastro incompleto: falta CNPJ/CPF, CEP. Pedido só como orçamento até o cadastro ser completado no ERP.';

  it('RN-CORE-17: a linha automática fica no topo e não apaga o texto do ERP', () => {
    expect(observacaoComCadastro('Cliente prefere entrega de manhã.', ['documento', 'cep'])).toBe(`${linha}\nCliente prefere entrega de manhã.`);
  });

  it('RN-CORE-17: sem texto do ERP, só a linha', () => {
    expect(observacaoComCadastro(null, ['documento', 'cep'])).toBe(linha);
    expect(observacaoComCadastro('  ', ['documento', 'cep'])).toBe(linha);
  });

  it('RN-CORE-17: cadastro completo faz a linha sumir e devolve o texto do ERP intacto', () => {
    expect(observacaoComCadastro('Texto do ERP', [])).toBe('Texto do ERP');
    expect(observacaoComCadastro(null, [])).toBeNull();
  });

  it('RN-CORE-17: é refeita a cada atualização, sem acumular linhas antigas', () => {
    const v1 = observacaoComCadastro('Texto do ERP', ['cep']);
    const v2 = observacaoComCadastro(v1, ['documento']);
    expect(v2).toBe('Cadastro incompleto: falta CNPJ/CPF. Pedido só como orçamento até o cadastro ser completado no ERP.\nTexto do ERP');
    expect(observacaoComCadastro(v2, [])).toBe('Texto do ERP');
  });

  it('RN-CORE-17: código de campo desconhecido aparece como veio', () => {
    expect(observacaoComCadastro(null, ['campo_novo'])).toContain('falta campo_novo.');
  });

  it('RN-CORE-17: campos têm rótulo em português', () => {
    expect(ROTULO_CAMPO_CADASTRO.documento).toBe('CNPJ/CPF');
    expect(ROTULO_CAMPO_CADASTRO.cep).toBe('CEP');
    expect(ROTULO_CAMPO_CADASTRO.inscricao_estadual).toBe('inscrição estadual');
  });
});
