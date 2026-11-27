import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { CorrecaoPreCadastroSchema, type HistoricoPreCadastro, type PreCadastroAtual, type TentativaPreCadastro } from '../../contracts';
import { COLUNAS_FORMULARIO, errosDaRecusaPorColuna, primeiraColunaMarcada } from '../../app/lib/pre-cadastro-formulario';
import {
  alternarLinhaObrigatoria,
  listaAlterada,
  buscaDoQDaUrl,
  buscaParaApi,
  codigoErpDoAceite,
  contadorDaAba,
  corpoDaCorrecao,
  erroDoReenvio,
  filtrosRecusadosDaUrl,
  linhaMarcada,
  LINHAS_CAMPOS_OBRIGATORIOS,
  ORDEM_DA_GRADE,
  situacaoDaGaveta,
  situacaoDoHistorico,
  temFiltroRecusados,
  tentativasEmOrdem,
  textoDeQuemCorrigiuAntes,
  textoDeQuemEnviou,
  textoDoResultado,
} from './pre-cadastro';

const FUSO = 'America/Manaus';
const ID = '3f1c2a52-3c1e-4f0a-9d49-7c4a5c0e1a11';
const ANA = { id: '9a8b7c6d-1111-4222-8333-444455556666', nome: 'Ana' };
const BRUNO = { id: '1a2b3c4d-1111-4222-8333-444455556666', nome: 'Bruno' };
const linha = (id: string) => LINHAS_CAMPOS_OBRIGATORIOS.find((l) => l.id === id)!;
const tentativa = (o: Partial<TentativaPreCadastro>): TentativaPreCadastro => ({
  revisao: 1, hash: null, origem: 'campo', corrigido_por: null, enviado_em: '2026-11-20T18:31:00Z', campos_alterados: [], resultado: 'aguardando', respondido_em: null, motivo: null, erros: [], cliente_id_original: null, ...o,
});

describe('Parâmetros › Clientes › Campos obrigatórios (RN-CORE-16 e RN-CORE-79)', () => {
  it('RN-CORE-79: sete linhas na ordem da spec, razão social e CPF/CNPJ sempre marcadas; Endereço cobre o grupo inteiro', () => {
    expect(LINHAS_CAMPOS_OBRIGATORIOS.map((l) => l.rotulo)).toEqual(['Razão social', 'CPF/CNPJ', 'Nome fantasia', 'Inscrição estadual', 'Telefone', 'E-mail', 'Endereço']);
    expect(LINHAS_CAMPOS_OBRIGATORIOS.filter((l) => l.sempre).map((l) => l.id)).toEqual(['razao_social', 'documento']);
    expect(linha('endereco').campos).toEqual(['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep']);
    expect(linhaMarcada([], linha('documento'))).toBe(true);
    expect(linhaMarcada(['cidade'], linha('endereco'))).toBe(true);
    expect(linhaMarcada(['razao_social'], linha('email'))).toBe(false);
  });

  it('RN-CORE-16: marcar ou desmarcar uma linha mexe só nela, mantém complemento e geolocalização e nunca tira os sempre obrigatórios', () => {
    const lista = ['razao_social', 'documento', 'cidade', 'complemento'] as const;
    expect(alternarLinhaObrigatoria(lista, linha('endereco'), true)).toEqual(['razao_social', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'complemento']);
    expect(alternarLinhaObrigatoria(lista, linha('endereco'), false)).toEqual(['razao_social', 'documento', 'complemento']);
    expect(alternarLinhaObrigatoria(lista, linha('documento'), false)).toEqual(['razao_social', 'documento', 'cidade', 'complemento']);
    expect(alternarLinhaObrigatoria([], linha('telefone'), true)).toEqual(['razao_social', 'documento', 'telefone']);
  });
});

describe('Clientes › Pré-cadastros recusados (RN-CORE-78)', () => {
  it('RN-CORE-78: filtros na URL; situação inválida ou ausente é Recusado, o padrão', () => {
    const f = filtrosRecusadosDaUrl(new URLSearchParams('situacao=aceito&q= Mercado '));
    expect(f).toEqual({ situacao: 'aceito', q: 'Mercado' });
    expect(filtrosRecusadosDaUrl(new URLSearchParams('situacao=todas'))).toEqual({ situacao: 'recusado', q: '' });
    expect(temFiltroRecusados(f)).toBe(true);
    expect(temFiltroRecusados({ situacao: 'recusado', q: '' })).toBe(false);
  });

  it('RN-CORE-78: a busca por CPF/CNPJ vai só com dígitos (sem precisar da máscara); texto vai como veio', () => {
    expect(buscaParaApi('11.222.333/0001')).toBe('112223330001');
    expect(buscaParaApi(' Mercado 2 ')).toBe('Mercado 2');
    expect(buscaParaApi('  ')).toBeUndefined();
  });

  it('RN-CORE-78: o número da aba é o dos recusados de uma página; com mais páginas, sem número', () => {
    expect(contadorDaAba({ itens: [1, 2, 3], proximo_cursor: null })).toBe(3);
    expect(contadorDaAba({ itens: [1], proximo_cursor: 'x' })).toBeNull();
    expect(contadorDaAba(undefined)).toBeNull();
  });

  it('RN-CORE-78: cada tentativa diz quem enviou ou corrigiu, onde e quando, e o que o ERP fez (fuso do tenant)', () => {
    expect(textoDeQuemEnviou(tentativa({ corrigido_por: { id: ANA.id, nome: 'Ana', perfil: 'vendedor' } }), FUSO)).toBe('Enviada por Ana, no Campo, em 20/11/2026 14:31');
    expect(textoDeQuemEnviou(tentativa({ revisao: 2, origem: 'bko', corrigido_por: { id: BRUNO.id, nome: 'Bruno', perfil: 'analista' } }), FUSO)).toBe('Corrigida por Bruno, no BKO, em 20/11/2026 14:31');
    expect(textoDeQuemEnviou(tentativa({}), FUSO)).toBe('Enviada no Campo, em 20/11/2026 14:31');
    expect(textoDoResultado(tentativa({}), FUSO)).toBe('Aguardando ERP');
    expect(textoDoResultado(tentativa({ resultado: 'recusado', respondido_em: '2026-11-21T12:00:00Z' }), FUSO)).toBe('Recusada pelo ERP em 21/11/2026 08:00');
    expect(textoDoResultado(tentativa({ resultado: 'aceito', respondido_em: '2026-11-21T12:00:00Z' }), FUSO)).toBe('Aceita pelo ERP em 21/11/2026 08:00');
  });

  it('RN-CORE-78: o Código ERP vai só no cartão da revisão aceita que trouxe o código (ADR 0069 item 10)', () => {
    expect(codigoErpDoAceite(tentativa({ resultado: 'aceito', external_id: 'C5112' }))).toBe('C5112');
    expect(codigoErpDoAceite(tentativa({ resultado: 'aceito', external_id: null }))).toBeNull();
    expect(codigoErpDoAceite(tentativa({ resultado: 'aceito' }))).toBeNull();
    expect(codigoErpDoAceite(tentativa({ resultado: 'recusado', external_id: 'C5112' }))).toBeNull();
    expect(codigoErpDoAceite(tentativa({ external_id: 'C5112' }))).toBeNull();
  });

  it('RN-CORE-78: 409 de revisão desatualizada diz quem corrigiu antes e quando; sem nome, o texto do contrato', () => {
    const h: HistoricoPreCadastro = { cliente_id: ID, revisao_atual: 3, tentativas: [tentativa({ revisao: 2 }), tentativa({ revisao: 3, corrigido_por: { id: ANA.id, nome: 'Ana', perfil: 'vendedor' }, enviado_em: '2026-11-22T13:05:00Z' })] };
    expect(tentativasEmOrdem(h).map((t) => t.revisao)).toEqual([3, 2]);
    expect(textoDeQuemCorrigiuAntes(h, FUSO)).toBe('Ana já corrigiu este pré-cadastro em 22/11 09:05.');
    expect(textoDeQuemCorrigiuAntes(undefined, FUSO)).toMatch(/corrigido por outra pessoa/);
    expect(erroDoReenvio(new ApiRequestError(409, 'REVISAO_DESATUALIZADA', 'x'))).toEqual({ revisaoDesatualizada: true, erros: {} });
  });

  it('RN-CORE-79: 422 CAMPOS_OBRIGATORIOS marca como "Obrigatório" as colunas de detalhes.campos; outro erro não marca nada', () => {
    const e = new ApiRequestError(422, 'CAMPOS_OBRIGATORIOS', 'Preencha o telefone. Preencha o endereço.', { campos: ['telefone', 'cep', 'x', 1] });
    expect(erroDoReenvio(e)).toEqual({ revisaoDesatualizada: false, erros: { telefone: 'Obrigatório', cep: 'Obrigatório' } });
    expect(erroDoReenvio(new ApiRequestError(422, 'CADASTRO_NAO_RECUSADO', 'x'))).toEqual({ revisaoDesatualizada: false, erros: {} });
    expect(erroDoReenvio(new Error('rede'))).toEqual({ revisaoDesatualizada: false, erros: {} });
  });

  it('RN-CORE-78: o selo da gaveta vem da tentativa mais nova do histórico (recusada, reenviada ou aceita)', () => {
    const h = (...t: Partial<TentativaPreCadastro>[]): HistoricoPreCadastro => ({ cliente_id: ID, revisao_atual: Math.max(1, t.length), tentativas: t.map(tentativa) });
    expect(situacaoDoHistorico(h({ resultado: 'recusado' }))).toBe('recusado');
    expect(situacaoDoHistorico(h({ resultado: 'recusado' }, { revisao: 2, resultado: 'aguardando' }))).toBe('reenviado');
    expect(situacaoDoHistorico(h({ resultado: 'recusado' }, { revisao: 2, resultado: 'aceito' }))).toBe('aceito');
    expect(situacaoDoHistorico(h())).toBeNull();
  });

  it('RN-CORE-78: até o histórico chegar (ou se falhar), o selo e o "Editar e reenviar" seguem a situação da linha; depois, a do histórico', () => {
    const h: HistoricoPreCadastro = { cliente_id: ID, revisao_atual: 2, tentativas: [tentativa({ resultado: 'recusado' }), tentativa({ revisao: 2, resultado: 'aguardando' })] };
    expect(situacaoDaGaveta('recusado', undefined)).toBe('recusado');
    expect(situacaoDaGaveta('recusado', h)).toBe('reenviado');
  });

  it('RN-CORE-78: a busca só volta ao campo quando o q da URL muda por fora; o eco do que o campo mandou não apaga o que foi digitado na espera', () => {
    expect(buscaDoQDaUrl('merc', 'merc')).toBeNull();
    expect(buscaDoQDaUrl('', 'merc')).toBe('');
    expect(buscaDoQDaUrl('padaria', 'merc')).toBe('padaria');
  });

  it('RN-CORE-78: a grade do BKO cobre as colunas do formulário único, e a primeira marcada segue a ordem da grade (IE antes do CEP)', () => {
    expect([...ORDEM_DA_GRADE].sort()).toEqual([...COLUNAS_FORMULARIO].sort());
    const marcas = errosDaRecusaPorColuna([{ campo: 'cep', mensagem: 'CEP não existe' }, { campo: 'inscricao_estadual', mensagem: 'IE inválida' }]);
    expect(primeiraColunaMarcada(marcas, ORDEM_DA_GRADE)).toBe('inscricao_estadual');
  });

  it('RN-CORE-78: o corpo da correção leva o formulário sem máscara, a localização e a filial gravadas e a revisão vista', () => {
    const atual = { id: ID, revisao: 2, status_cadastro: 'recusado', motivo: null, erros: [], razao_social: 'Mercado', documento: '11222333000181', latitude: -3.1, longitude: -60, filial_id: null } as PreCadastroAtual;
    const corpo = CorrecaoPreCadastroSchema.parse(corpoDaCorrecao(atual, { razao_social: 'Mercado Ltda', documento: '11.222.333/0001-81', cep: '69000-000', telefone: '(92) 98888-7777', email: ' ' }));
    expect(corpo).toMatchObject({ razao_social: 'Mercado Ltda', documento: '11222333000181', cep: '69000000', telefone: '92988887777', email: null, latitude: -3.1, longitude: -60, filial_id: null, revisao_base: 2 });
  });
});

describe('RN-CORE-16: Salvar do painel de campos obrigatórios só liga com alteração', () => {
  it('RN-CORE-16: lista igual à salva, em qualquer ordem, não é alteração; marcar ou desmarcar é', () => {
    expect(listaAlterada(['razao_social', 'documento', 'cep'], ['cep', 'documento', 'razao_social'])).toBe(false);
    expect(listaAlterada(['razao_social', 'documento', 'cep', 'email'], ['razao_social', 'documento', 'cep'])).toBe(true);
    expect(listaAlterada(['razao_social', 'documento'], ['razao_social', 'documento', 'cep'])).toBe(true);
  });
});

describe('RN-CORE-78: recusa do vendedor no formulário do BKO', () => {
  it('a linha "Vendedor" (aviso) leva o erro de vendedor_external_id, só quando existe', () => {
    const fonte = readFileSync(new URL('../components/pre-cadastro/pre-cadastros-recusados.tsx', import.meta.url), 'utf8');
    expect(fonte).toContain('const erroVendedor = erroDoVendedor(atual.erros);');
    expect(fonte).toMatch(/\{erroVendedor && \(\s*<Notice tone="danger">\s*<span data-testid=\{`\$\{P\}\.form\.campo\.vendedor`\}>\{`\$\{rotuloDoCampo\(CAMPO_VENDEDOR\)\}: \$\{erroVendedor\}`\}/);
  });
});
