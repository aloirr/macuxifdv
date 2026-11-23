/**
 * "Zerar dados" (ADR 0068; RN-PLA-12): liberação do item do menu e do botão, frases de recusa e de falha (`mensagemDoZerar` do SDK),
 * caminho das rotas e o modo falso (prévia, pedido idempotente, andamento até concluir, recusas).
 */
import { CODIGOS_ZERAR_EMPRESA as Z, ENTIDADES_ZERAR, PreviaZerarEmpresaSchema, ZerarEmpresaSchema, mensagemDoZerar, type PreviaZerarEmpresa, type ZerarEmpresa } from '@macuxi/platform-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroPortal, MENSAGEM_PADRAO } from './portal-api';
import { andamentoDoZerar, comandosDeReenvio, erroDoZerar, fraseDoZerar, rotaDoZerar, rotulosDasEntidades, zerarJaRodando, zerarLiberado, zerarLigadoNoMenu } from './portal-empresa-zerar';
import { entidadesZeradasFalso, limparZerarFalso, responderZerarFalso } from './portal-falso-zerar';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const previa = (x: Partial<PreviaZerarEmpresa> = {}): PreviaZerarEmpresa => ({
  tenant_id: T,
  codigo: 'AM2290',
  entidades: null,
  entidades_afetadas: ['cliente'],
  contado_em: '2026-11-23T12:00:00.000Z',
  total_linhas: 10,
  tabelas: [{ tabela: 'core.cliente', modo: 'soft', linhas: 10 }],
  bloqueio: null,
  ...x,
});
const zerar = (x: Partial<ZerarEmpresa> = {}): ZerarEmpresa => ({
  id: '7c0d5e1a-2b4f-4c6d-8e9f-000000000009',
  tenant_id: T,
  codigo: 'AM2290',
  entidades: null,
  entidades_afetadas: null,
  lote: '20261123T120000Z-7c0d5e1a',
  situacao: 'em_andamento',
  pedido_em: '2026-11-23T12:00:00.000Z',
  concluido_em: null,
  linhas_apagadas: null,
  contagem: null,
  copia_expira_em: null,
  erro_codigo: null,
  ...x,
});

describe('liberação (RN-PLA-12)', () => {
  it('item do menu: desligado com backup rodando, empresa em exclusão ou outro pedido da linha no ar', () => {
    expect(zerarLigadoNoMenu({ backupLigado: true, situacaoLigada: true })).toBe(true);
    expect(zerarLigadoNoMenu({ backupLigado: false, situacaoLigada: true })).toBe(false);
    expect(zerarLigadoNoMenu({ backupLigado: true, situacaoLigada: false })).toBe(false);
  });
  it('botão: prévia sem bloqueio, alguma linha, código conferindo (sem diferença de maiúsculas) e senha', () => {
    expect(zerarLiberado(previa(), ' am2290 ', 'x')).toBe(true);
    expect(zerarLiberado(undefined, 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(previa(), 'AM229', 'x')).toBe(false);
    expect(zerarLiberado(previa(), 'AM2290', '')).toBe(false);
    expect(zerarLiberado(previa({ bloqueio: Z.backupEmAndamento }), 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(previa({ total_linhas: 0, tabelas: [] }), 'AM2290', 'x')).toBe(false);
  });
  it('zerar já em andamento (outra aba): o diálogo vai direto ao andamento', () => {
    expect(zerarJaRodando(previa({ bloqueio: Z.zerarEmAndamento }))).toBe(true);
    expect(zerarJaRodando(previa({ bloqueio: Z.backupEmAndamento }))).toBe(false);
    expect(zerarJaRodando(undefined)).toBe(false);
  });
});

describe('frases (uma tabela só: `mensagemDoZerar`)', () => {
  it('senha errada vai para o campo senha; o resto para o bloco, com a frase do SDK', () => {
    const senha = erroDoZerar(new ErroPortal(403, Z.reautenticacaoFalhou, 'frase da API'));
    expect(senha).toEqual({ texto: mensagemDoZerar(Z.reautenticacaoFalhou), senha: true });
    expect(erroDoZerar(new ErroPortal(422, Z.codigoNaoConfere, 'x'))).toEqual({ texto: 'Código não confere.', senha: false });
    expect(erroDoZerar(new ErroPortal(409, Z.zerarEmAndamento, 'x')).texto).toBe(mensagemDoZerar(Z.zerarEmAndamento));
  });
  it('código fora da tabela: a frase da API; erro técnico: a padrão', () => {
    expect(fraseDoZerar(new ErroPortal(500, 'OUTRO', 'Frase da API.'))).toBe('Frase da API.');
    expect(fraseDoZerar(new Error('{"x":1}'))).toBe(MENSAGEM_PADRAO);
  });
  it('andamento: giro, linhas apagadas no fuso pt-BR e a frase da falha do worker', () => {
    expect(andamentoDoZerar(undefined)).toEqual({ tom: 'andamento', texto: 'Em andamento…' });
    expect(andamentoDoZerar(zerar())).toEqual({ tom: 'andamento', texto: 'Em andamento…' });
    const ok = zerar({ situacao: 'concluido', concluido_em: '2026-11-23T12:01:00.000Z', linhas_apagadas: 18119, contagem: [{ tabela: 'core.cliente', modo: 'soft', linhas: 18119 }], entidades_afetadas: ['cliente'], copia_expira_em: '2026-11-30T12:01:00.000Z' });
    expect(andamentoDoZerar(ok)).toEqual({ tom: 'success', texto: '18.119 linhas apagadas.' });
    expect(andamentoDoZerar({ ...ok, linhas_apagadas: 1 })).toEqual({ tom: 'success', texto: '1 linha apagada.' });
    expect(andamentoDoZerar(zerar({ situacao: 'falhou', erro_codigo: 'ZERAR_CONCORRENCIA' }))).toEqual({
      tom: 'danger',
      texto: 'A empresa estava em uso e nada foi apagado. Tente de novo.',
    });
  });
  it('reenvio: um `conector carga-completa` por entidade afetada; as 16 viram `todas`; rótulos na ordem dada', () => {
    expect(comandosDeReenvio(['cliente', 'cliente_endereco'])).toEqual(['conector carga-completa cliente', 'conector carga-completa cliente_endereco']);
    expect(comandosDeReenvio([...ENTIDADES_ZERAR])).toEqual(['conector carga-completa todas']);
    expect(comandosDeReenvio([])).toEqual([]);
    expect(comandosDeReenvio(null)).toEqual([]);
    expect(rotulosDasEntidades(['cliente', 'cliente_endereco'])).toBe('Clientes, Endereços de clientes');
  });
  it('rotas do SDK sem o /v1', () => {
    expect(rotaDoZerar('previa', T)).toBe(`/plataforma/empresas/${T}/zerar/previa`);
    expect(rotaDoZerar('zerar', T)).toBe(`/plataforma/empresas/${T}/zerar`);
  });
});

describe('modo falso', () => {
  const empresa = { id: T, codigo: 'AM2290', status: 'suspenso', backupEmAndamento: false };
  const ler = async (r: Response) => ({ status: r.status, corpo: (await r.json()) as Record<string, unknown> });
  beforeEach(() => {
    limparZerarFalso();
    vi.useFakeTimers({ now: new Date('2026-11-23T12:00:00.000Z') });
  });
  afterEach(() => vi.useRealTimers());

  it('prévia no schema do SDK; sem dados e com backup rodando', async () => {
    const p = PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined))).corpo);
    expect(p.total_linhas).toBeGreaterThan(0);
    expect(p.bloqueio).toBeNull();
    const vazia = PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', { ...empresa, codigo: 'atacado-norte' }, true, undefined))).corpo);
    expect(vazia.total_linhas).toBe(0);
    const comBackup = PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', { ...empresa, backupEmAndamento: true }, true, undefined))).corpo);
    expect(comBackup.bloqueio).toBe(Z.backupEmAndamento);
  });
  it('pedido: recusas, 202 idempotente, em andamento e concluído 6 s depois; a prévia fica vazia', async () => {
    const id = '7c0d5e1a-2b4f-4c6d-8e9f-000000000001';
    expect((await ler(responderZerarFalso('GET', empresa, false, undefined))).corpo.codigo).toBe(Z.zerarNaoEncontrado);
    expect((await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'AM2290', senha: 'errada' }))).status).toBe(403);
    expect((await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'XX99', senha: 'x' }))).corpo.codigo).toBe(Z.codigoNaoConfere);
    const r = await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'am2290', senha: 'x' }));
    expect(r.status).toBe(202);
    expect(ZerarEmpresaSchema.parse(r.corpo).situacao).toBe('em_andamento');
    expect((await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'AM2290', senha: 'x' }))).status).toBe(202);
    const outro = await ler(responderZerarFalso('POST', empresa, false, { id: crypto.randomUUID(), codigo_confirmacao: 'AM2290', senha: 'x' }));
    expect([outro.status, outro.corpo.codigo]).toEqual([409, Z.zerarEmAndamento]);
    expect(PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined))).corpo).bloqueio).toBe(Z.zerarEmAndamento);
    vi.advanceTimersByTime(6_000);
    const fim = ZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, false, undefined))).corpo);
    expect(fim.situacao).toBe('concluido');
    expect(fim.linhas_apagadas).toBeGreaterThan(0);
    expect(PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined))).corpo).total_linhas).toBe(0);
  });
  it('por entidade: a prévia leva a cascata (cliente → endereços); o concluído traz o lote e as afetadas; a entidade fica vazia', async () => {
    const p = PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined, '/x?entidades=cliente'))).corpo);
    expect(p.entidades).toEqual(['cliente']);
    expect(p.entidades_afetadas).toEqual(['cliente', 'cliente_endereco']);
    expect(p.tabelas.map((t) => t.tabela)).toEqual(['core.cliente', 'core.cliente_endereco', 'integracao.registro_atual']);
    expect((await ler(responderZerarFalso('GET', empresa, true, undefined, '/x?entidades=nada'))).status).toBe(400);
    const id = '7c0d5e1a-2b4f-4c6d-8e9f-000000000002';
    expect((await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'AM2290', senha: 'x', entidades: ['cliente'] }))).status).toBe(202);
    vi.advanceTimersByTime(6_000);
    const fim = ZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, false, undefined))).corpo);
    expect([fim.entidades, fim.entidades_afetadas, fim.linhas_apagadas]).toEqual([['cliente'], ['cliente', 'cliente_endereco'], 1180 + 1300 + 2550]);
    expect(fim.lote).toBe('20261123T120000Z-7c0d5e1a');
    expect(entidadesZeradasFalso(T)).toEqual(new Set(['cliente', 'cliente_endereco']));
    const depois = PreviaZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined, '/x?entidades=cliente'))).corpo);
    expect([depois.total_linhas, depois.entidades_afetadas]).toEqual([0, ['cliente']]);
  });
  it('empresa inexistente: 404', async () => {
    expect((await ler(responderZerarFalso('GET', null, true, undefined))).status).toBe(404);
  });
});
