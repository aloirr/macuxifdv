import { describe, expect, it } from 'vitest';
import { abasDaFicha, acessoAoDocumento, decidirAbrirDocumento, decidirLeituraArquivoDocumento, documentosDaFicha, excecaoTiraAcesso, nivelDoUsuario, nivelDoTipo, situacaoValidadeDocumento, validarMatrizDocumentos, type DocumentoLinha, type TipoDocumento } from './documentos-cliente';

const tipo = (id: string, extra: Partial<TipoDocumento> = {}): TipoDocumento => ({ id, nome: id, grupo: 'Cadastro', ordem: 1, permite_envio: false, ativo: true, ...extra });
const doc = (id: string, tipo_id: string, extra: Partial<DocumentoLinha> = {}): DocumentoLinha => ({ id, tipo_id, nome: id, formato: 'PDF', data: '2026-10-01', validade: null, ...extra });
const matriz = [
  { tipo_id: 'alvara', perfil: 'vendedor', nivel: 've' as const },
  { tipo_id: 'alvara', perfil: 'supervisor', nivel: 've' as const },
  { tipo_id: 'social', perfil: 'supervisor', nivel: 've' as const },
  { tipo_id: 'fachada', perfil: 'vendedor', nivel: 've_e_envia' as const },
];

describe('T-0186 / P5 e P10: permissão de documento por tipo, perfil e documento', () => {
  it('P10: tipo sem permissão para o perfil não aparece na lista', () => {
    const r = documentosDaFicha(['vendedor'], [tipo('alvara'), tipo('social')], [doc('d1', 'alvara'), doc('d2', 'social')], matriz, [], '2026-11-19');
    expect(r.map((x) => x.id)).toEqual(['d1']);
  });
  it('P10: o mesmo tipo aparece para o supervisor que tem permissão', () => {
    const r = documentosDaFicha(['supervisor'], [tipo('alvara'), tipo('social')], [doc('d1', 'alvara'), doc('d2', 'social')], matriz, [], '2026-11-19');
    expect(r.map((x) => x.id)).toEqual(['d1', 'd2']);
  });
  it('P10/P11: exceção por documento deixa a linha com cadeado, sem permissão para abrir', () => {
    const r = documentosDaFicha(['vendedor'], [tipo('alvara')], [doc('d1', 'alvara')], matriz, [{ documento_id: 'd1', perfil: 'vendedor' }], '2026-11-19');
    expect(r[0]).toMatchObject({ id: 'd1', acesso: 'bloqueado' });
  });
  it('P11: a exceção só tira acesso; não libera tipo que o perfil não vê', () => {
    const r = documentosDaFicha(['vendedor'], [tipo('social')], [doc('d2', 'social')], matriz, [{ documento_id: 'd2', perfil: 'supervisor' }], '2026-11-19');
    expect(r).toEqual([]);
  });
  it('spec §7: admin e analista veem tudo e a exceção não os atinge', () => {
    for (const perfil of ['admin', 'analista']) {
      const r = documentosDaFicha([perfil], [tipo('social')], [doc('d2', 'social')], [], [{ documento_id: 'd2', perfil }], '2026-11-19');
      expect(r[0]).toMatchObject({ acesso: 'abrir' });
    }
  });
  it('níveis: sem linha na matriz = Não vê; "Vê e envia" só vale em tipo que permite envio', () => {
    expect(nivelDoTipo(matriz, tipo('alvara'), 'gerente')).toBe('nao_ve');
    expect(nivelDoTipo(matriz, tipo('fachada', { permite_envio: true }), 'vendedor')).toBe('ve_e_envia');
    expect(nivelDoTipo(matriz, tipo('fachada', { permite_envio: false }), 'vendedor')).toBe('ve');
  });
  it('acessoAoDocumento: tipo Não vê = oculto; exceção = bloqueado; senão abrir', () => {
    expect(acessoAoDocumento('nao_ve', false)).toBe('oculto');
    expect(acessoAoDocumento('ve', true)).toBe('bloqueado');
    expect(acessoAoDocumento('ve', false)).toBe('abrir');
  });
  it('tipo inativo não aparece e a lista sai por grupo e ordem do cadastro de tipos', () => {
    const tipos = [tipo('alvara', { ordem: 2, grupo: 'Cadastro' }), tipo('contrato', { ordem: 1, grupo: 'Contratos' }), tipo('velho', { ativo: false })];
    const m = ['alvara', 'contrato', 'velho'].map((tipo_id) => ({ tipo_id, perfil: 'vendedor', nivel: 've' as const }));
    const r = documentosDaFicha(['vendedor'], tipos, [doc('a', 'alvara'), doc('c', 'contrato'), doc('v', 'velho')], m, [], '2026-11-19');
    expect(r.map((x) => x.id)).toEqual(['c', 'a']);
  });
});

describe('T-0186 / P16: validade do documento só na linha', () => {
  it('sem validade, válido e vencido (vence hoje ainda vale)', () => {
    expect(situacaoValidadeDocumento(null, '2026-11-19')).toBe('sem_validade');
    expect(situacaoValidadeDocumento('2026-11-19', '2026-11-19')).toBe('valido');
    expect(situacaoValidadeDocumento('2026-10-31', '2026-11-19')).toBe('vencido');
  });
});

describe('T-0186 / spec §7: matriz de permissões gravada no BKO', () => {
  const tipos = [tipo('alvara'), tipo('fachada', { permite_envio: true })];
  it('aceita níveis válidos', () => {
    expect(validarMatrizDocumentos(tipos, [{ tipo_id: 'alvara', perfil: 'vendedor', nivel: 've' }, { tipo_id: 'fachada', perfil: 'vendedor', nivel: 've_e_envia' }])).toEqual({ ok: true });
  });
  it('"Vê e envia" em tipo que o app não captura = recusa com mensagem em português', () => {
    const r = validarMatrizDocumentos(tipos, [{ tipo_id: 'alvara', perfil: 'vendedor', nivel: 've_e_envia' }]);
    expect(r).toMatchObject({ ok: false, codigo: 'DOCUMENTO_NIVEL_INVALIDO' });
  });
  it('tipo desconhecido e perfil admin/analista (veem tudo) são recusados', () => {
    expect(validarMatrizDocumentos(tipos, [{ tipo_id: 'x', perfil: 'vendedor', nivel: 've' }])).toMatchObject({ ok: false, codigo: 'DOCUMENTO_TIPO_DESCONHECIDO' });
    expect(validarMatrizDocumentos(tipos, [{ tipo_id: 'alvara', perfil: 'admin', nivel: 'nao_ve' }])).toMatchObject({ ok: false, codigo: 'DOCUMENTO_PERFIL_FIXO' });
  });
});

describe('T-0186 / P12: abas da ficha', () => {
  it('P12: promotor sem promotor_ve_pedidos fica com Resumo e Documentação', () => {
    expect(abasDaFicha('promotor', false)).toEqual(['resumo', 'documentacao']);
  });
  it('promotor com promotor_ve_pedidos e os demais perfis têm as três abas', () => {
    expect(abasDaFicha('promotor', true)).toEqual(['resumo', 'historico', 'documentacao']);
    expect(abasDaFicha('vendedor', false)).toEqual(['resumo', 'historico', 'documentacao']);
  });
});

describe('T-0186 / 🔴 vazamento: a permissão vale pelos códigos de TODOS os perfis do usuário (perfil personalizado incluso)', () => {
  const m = [
    { tipo_id: 'alvara', perfil: 'vendedor', nivel: 've' as const },
    { tipo_id: 'alvara', perfil: 'rep_norte', nivel: 'nao_ve' as const },
    { tipo_id: 'fachada', perfil: 'vendedor', nivel: 've_e_envia' as const },
  ];
  it('P10: perfil personalizado com "Não vê" não vê o tipo', () => {
    expect(documentosDaFicha(['rep_norte'], [tipo('alvara')], [doc('d1', 'alvara')], m, [], '2026-11-19')).toEqual([]);
    expect(nivelDoUsuario(m, tipo('alvara'), ['rep_norte'])).toBe('nao_ve');
  });
  it('P10: perfil personalizado sem linha na matriz não vê (padrão é "Não vê")', () => {
    expect(documentosDaFicha(['rep_sul'], [tipo('alvara')], [doc('d1', 'alvara')], m, [], '2026-11-19')).toEqual([]);
  });
  it('P10: com dois perfis, um que vê e outro que não, o usuário vê', () => {
    const r = documentosDaFicha(['rep_norte', 'vendedor'], [tipo('alvara')], [doc('d1', 'alvara')], m, [], '2026-11-19');
    expect(r.map((x) => x.id)).toEqual(['d1']);
  });
  it('P5: "vê e envia" também basta em um perfil (o maior nível entre os perfis)', () => {
    expect(nivelDoUsuario(m, tipo('fachada', { permite_envio: true }), ['rep_norte', 'vendedor'])).toBe('ve_e_envia');
    expect(nivelDoUsuario(m, tipo('alvara'), ['rep_norte', 'vendedor'])).toBe('ve');
    expect(nivelDoUsuario(m, tipo('alvara'), [])).toBe('nao_ve');
  });
  it('P11: a exceção que pega QUALQUER um dos perfis tira o acesso (cadeado)', () => {
    const r = documentosDaFicha(['rep_norte', 'vendedor'], [tipo('alvara')], [doc('d1', 'alvara')], m, [{ documento_id: 'd1', perfil: 'vendedor' }], '2026-11-19');
    expect(r[0]).toMatchObject({ id: 'd1', acesso: 'bloqueado', pode_enviar: false });
    expect(excecaoTiraAcesso([{ documento_id: 'd1', perfil: 'vendedor' }], 'd1', ['rep_norte', 'vendedor'])).toBe(true);
    expect(excecaoTiraAcesso([{ documento_id: 'd1', perfil: 'vendedor' }], 'd2', ['vendedor'])).toBe(false);
    expect(excecaoTiraAcesso([{ documento_id: 'd1', perfil: 'vendedor' }], 'd1', ['rep_norte'])).toBe(false);
  });
  it('spec §7: se um dos perfis é admin ou analista, vê tudo e a exceção não o atinge', () => {
    const r = documentosDaFicha(['rep_norte', 'analista'], [tipo('social')], [doc('d2', 'social')], [], [{ documento_id: 'd2', perfil: 'rep_norte' }], '2026-11-19');
    expect(r[0]).toMatchObject({ acesso: 'abrir' });
  });
});

describe('RN-CORE-40: decisão de abrir o documento (a mesma da rota e da guarda do arquivo)', () => {
  const ex = [{ documento_id: 'd1', perfil: 'vendedor' }];
  it('RN-CORE-40: tipo "Não vê", sem linha na matriz ou inativo = oculto; exceção = sem permissão; senão liberado', () => {
    expect(decidirAbrirDocumento({ tipo: tipo('alvara'), documentoId: 'd1', matriz, excecoes: [], perfis: ['vendedor'] })).toBe('liberado');
    expect(decidirAbrirDocumento({ tipo: tipo('social'), documentoId: 'd1', matriz, excecoes: [], perfis: ['vendedor'] })).toBe('oculto');
    expect(decidirAbrirDocumento({ tipo: undefined, documentoId: 'd1', matriz, excecoes: [], perfis: ['vendedor'] })).toBe('oculto');
    expect(decidirAbrirDocumento({ tipo: tipo('alvara', { ativo: false }), documentoId: 'd1', matriz, excecoes: [], perfis: ['vendedor'] })).toBe('oculto');
    expect(decidirAbrirDocumento({ tipo: tipo('alvara'), documentoId: 'd1', matriz, excecoes: ex, perfis: ['vendedor'] })).toBe('sem_permissao');
    expect(decidirAbrirDocumento({ tipo: tipo('social'), documentoId: 'd1', matriz: [], excecoes: ex, perfis: ['admin'] })).toBe('liberado');
  });
  const base = { tipo: tipo('alvara'), documentoId: 'd1', matriz, excecoes: [], perfis: ['vendedor'], licenciado: true, naCarteira: true };
  it('RN-CORE-40: arquivo que não é de documento = null (a guarda não governa)', () => {
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: false })).toBeNull();
  });
  it('RN-CORE-40: documento com permissão, licença e carteira = liberado', () => {
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: true })).toBe('liberado');
  });
  it('RN-CORE-40: sem licença, fora da carteira, tipo "Não vê" ou exceção = negado', () => {
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: true, licenciado: false })).toBe('negado');
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: true, naCarteira: false })).toBe('negado');
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: true, perfis: ['rep_norte'] })).toBe('negado');
    expect(decidirLeituraArquivoDocumento({ ...base, ehDocumento: true, excecoes: ex })).toBe('negado');
  });
});
