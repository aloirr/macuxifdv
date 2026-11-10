import { describe, expect, it } from 'vitest';
import { decidirApagarTipoFoto, perfisDeLeitura, PERFIS_DOC_SENSIVEL, podeAbrirFoto, podeEnviarFoto, fachadaDoPdv, resumoFotos, validarTipoFoto, type TipoFotoLike } from './fotos-pdv';

const T = (id: string, nome: string, extra: Partial<TipoFotoLike> = {}): TipoFotoLike => ({ id, nome, obrigatorio: false, sensivel: false, fachada: false, ordem: 0, ativo: true, ...extra });
const FACHADA = T('f', 'Fachada', { fachada: true, obrigatorio: true });
const CNH = T('c', 'CNH do sócio', { sensivel: true, obrigatorio: true, ordem: 10 });
const CONTRATO = T('k', 'Contrato social', { sensivel: true, ordem: 20 });

describe('RN-CORE-38: tipos de foto do PDV', () => {
  it('RN-CORE-38: nome obrigatório de 1 a 60 caracteres, aparado', () => {
    expect(validarTipoFoto({ id: 'n', nome: '  Selfie do dono ', obrigatorio: false, sensivel: false }, [FACHADA])).toMatchObject({ ok: true, tipo: { nome: 'Selfie do dono' } });
    expect(validarTipoFoto({ id: 'n', nome: '   ', obrigatorio: false, sensivel: false }, [FACHADA])).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_INVALIDO' });
    expect(validarTipoFoto({ id: 'n', nome: 'x'.repeat(61), obrigatorio: false, sensivel: false }, [FACHADA])).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_INVALIDO' });
  });
  it('RN-CORE-38: nome único entre os vivos, sem diferenciar maiúscula; editar a si mesmo não conta', () => {
    expect(validarTipoFoto({ id: 'n', nome: 'cnh do sócio', obrigatorio: false, sensivel: true }, [FACHADA, CNH])).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_DUPLICADO' });
    expect(validarTipoFoto({ id: 'c', nome: 'CNH do sócio', obrigatorio: false, sensivel: true }, [FACHADA, CNH]).ok).toBe(true);
  });
  it('RN-CORE-38: a fachada nunca é sensível e o tipo fachada continua fachada', () => {
    expect(validarTipoFoto({ id: 'f', nome: 'Fachada', obrigatorio: true, sensivel: true }, [FACHADA])).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_FACHADA' });
    expect(validarTipoFoto({ id: 'f', nome: 'Fachada', obrigatorio: false, sensivel: false }, [FACHADA]).ok).toBe(true);
  });
  it('RN-CORE-38: o tipo fachada não é apagado nem inativado; os outros podem', () => {
    expect(decidirApagarTipoFoto(FACHADA)).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_FACHADA' });
    expect(decidirApagarTipoFoto(CNH)).toEqual({ ok: true });
    expect(validarTipoFoto({ id: 'f', nome: 'Fachada', obrigatorio: true, sensivel: false, ativo: false }, [FACHADA])).toMatchObject({ ok: false, codigo: 'FOTO_TIPO_FACHADA' });
  });
});

describe('RN-CORE-38: quem lê o quê', () => {
  it('RN-CORE-38: só a fachada não tem restrição de perfil; os demais tipos abrem só para admin, analista, gerente e supervisor', () => {
    expect([...PERFIS_DOC_SENSIVEL].sort()).toEqual(['admin', 'analista', 'gerente', 'supervisor']);
    expect(perfisDeLeitura(CNH)).toEqual(PERFIS_DOC_SENSIVEL);
    expect(perfisDeLeitura(FACHADA)).toBeNull();
    expect(perfisDeLeitura(T('x', 'Gôndola'))).toEqual(PERFIS_DOC_SENSIVEL);
  });
  it('RN-CORE-38: vendedor e promotor abrem só a fachada; dos demais tipos veem que existem e não os reabrem', () => {
    expect(podeAbrirFoto('vendedor', FACHADA)).toBe(true);
    expect(podeAbrirFoto('vendedor', T('x', 'Gôndola'))).toBe(false);
    expect(podeAbrirFoto('promotor', T('x', 'Gôndola'))).toBe(false);
    expect(podeAbrirFoto('promotor', FACHADA)).toBe(true);
    expect(podeAbrirFoto('supervisor', T('x', 'Gôndola'))).toBe(true);
    expect(podeAbrirFoto('vendedor', CNH)).toBe(false);
    expect(podeAbrirFoto('promotor', CNH)).toBe(false);
    for (const p of ['admin', 'analista', 'gerente', 'supervisor']) expect(podeAbrirFoto(p, CNH), p).toBe(true);
    expect(podeAbrirFoto('assistente', CNH)).toBe(false);
  });
  it('RN-CORE-38: vendedor e promotor enviam só o que falta; admin, analista e supervisor substituem', () => {
    expect(podeEnviarFoto('vendedor', false)).toEqual({ ok: true });
    expect(podeEnviarFoto('vendedor', true)).toMatchObject({ ok: false, codigo: 'RN-CORE-38', mensagem: 'Esta foto já foi enviada.' });
    expect(podeEnviarFoto('promotor', true)).toMatchObject({ ok: false });
    for (const p of ['admin', 'analista', 'supervisor']) expect(podeEnviarFoto(p, true), p).toEqual({ ok: true });
  });
});

describe('RN-CORE-38: resumo tem/falta e "Ver foto do PDV"', () => {
  const tipos = [CONTRATO, FACHADA, CNH, T('i', 'Antigo', { ativo: false })];
  it('RN-CORE-38: um item por tipo ativo, obrigatórios primeiro, depois a ordem; conta as obrigatórias que faltam', () => {
    const r = resumoFotos(tipos, [{ foto_tipo_id: 'f' }]);
    expect(r.itens.map((i) => [i.nome, i.situacao])).toEqual([['Fachada', 'tem'], ['CNH do sócio', 'falta'], ['Contrato social', 'falta']]);
    expect(r.faltam_obrigatorias).toBe(1);
  });
  it('RN-CORE-38: foto apagada não conta como tem', () => {
    expect(resumoFotos(tipos, [{ foto_tipo_id: 'f', deleted_at: '2026-11-01T00:00:00Z' }]).faltam_obrigatorias).toBe(2);
  });
  it('RN-CORE-38: fachadaDoPdv devolve a foto da fachada enviada ou null', () => {
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: 'f', arquivo_id: 'a1' }])?.arquivo_id).toBe('a1');
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: 'f' }])).toBeNull();
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: 'f', arquivo_id: 'a1', deleted_at: '2026-11-01T00:00:00Z' }])).toBeNull();
    expect(fachadaDoPdv(tipos, [{ foto_tipo_id: 'c', arquivo_id: 'a2' }])).toBeNull();
    expect(fachadaDoPdv([], [])).toBeNull();
  });
});
