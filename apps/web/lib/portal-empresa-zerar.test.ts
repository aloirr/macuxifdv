/**
 * "Zerar dados" (ADR 0068; RN-PLA-12): liberação do item do menu e do botão, frases de recusa e de falha (`mensagemDoZerar` do SDK),
 * caminho das rotas e o modo falso (prévia, pedido idempotente, andamento até concluir, recusas).
 */
import { CODIGOS_ZERAR_EMPRESA as Z, ENTIDADES_ZERAR, PreviaZerarSchema, ZerarEmpresaSchema, mensagemDoZerar, type PreviaZerar, type ZerarEmpresa } from '@macuxi/platform-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroPortal, MENSAGEM_PADRAO } from './portal-api';
import {
  andamentoDoZerar,
  comandosDeReenvio,
  erroDoZerar,
  fraseDaPreviaFalha,
  fraseDoZerar,
  previaCalculando,
  rotaDoZerar,
  rotulosDasEntidades,
  TEXTOS_ZERAR,
  zerarJaRodando,
  zerarLiberado,
  zerarLigadoNoMenu,
} from './portal-empresa-zerar';
import { entidadesZeradasFalso, limparZerarFalso, PREVIA_FALSA_MS, responderZerarFalso } from './portal-falso-zerar';

const T = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const previa = (x: Partial<PreviaZerar> = {}): PreviaZerar => ({
  id: '7c0d5e1a-2b4f-4c6d-8e9f-000000000010',
  situacao: 'pronta',
  entidades: null,
  linhas: [{ ordem: 0, tabela: 'core.cliente', modo: 'soft', linhas: 10 }],
  entidades_afetadas: ['cliente'],
  total: 10,
  bloqueio: null,
  erro_codigo: null,
  criado_em: '2026-11-23T12:00:00.000Z',
  ...x,
});
const calculando = previa({ situacao: 'em_andamento', linhas: null, entidades_afetadas: null, total: null });
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
  it('botão: prévia pronta sem bloqueio, alguma linha, código da empresa conferindo (sem diferença de maiúsculas) e senha', () => {
    expect(zerarLiberado(previa(), 'AM2290', ' am2290 ', 'x')).toBe(true);
    expect(zerarLiberado(undefined, 'AM2290', 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(calculando, 'AM2290', 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(previa({ situacao: 'falhou', linhas: null, entidades_afetadas: null, total: null, erro_codigo: 'ZERAR_PREVIA_FALHOU' }), 'AM2290', 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(previa(), 'AM2290', 'AM229', 'x')).toBe(false);
    expect(zerarLiberado(previa(), 'AM2290', 'AM2290', '')).toBe(false);
    expect(zerarLiberado(previa({ bloqueio: Z.backupEmAndamento }), 'AM2290', 'AM2290', 'x')).toBe(false);
    expect(zerarLiberado(previa({ total: 0, linhas: [] }), 'AM2290', 'AM2290', 'x')).toBe(false);
  });
  it('prévia: calculando só em andamento; falha com a frase do worker', () => {
    expect(previaCalculando(calculando)).toBe(true);
    expect(previaCalculando(previa())).toBe(false);
    expect(previaCalculando(undefined)).toBe(false);
    expect(fraseDaPreviaFalha(previa({ situacao: 'falhou', erro_codigo: 'ZERAR_PREVIA_FALHOU' }))).toBe('Não foi possível calcular o que sai. Tente de novo.');
  });
  it('"Mantém" da empresa inteira: administradores, não usuários (a rotina apaga os não administradores)', () => {
    expect(TEXTOS_ZERAR.ficam).toBe('Mantém: empresa, plano, administradores, perfis, parâmetros e conectores.');
  });
  it('zerar já em andamento (outra aba): o diálogo vai direto ao andamento', () => {
    expect(zerarJaRodando(previa({ bloqueio: Z.zerarEmAndamento }))).toBe(true);
    expect(zerarJaRodando(previa({ situacao: 'em_andamento', bloqueio: Z.zerarEmAndamento }))).toBe(false);
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
    expect(rotaDoZerar('previaLer', T, 'p1')).toBe(`/plataforma/empresas/${T}/zerar/previa/p1`);
    expect(rotaDoZerar('zerar', T)).toBe(`/plataforma/empresas/${T}/zerar`);
  });
});

describe('modo falso', () => {
  const empresa = { id: T, codigo: 'AM2290', status: 'suspenso', backupEmAndamento: false };
  const ler = async (r: Response) => ({ status: r.status, corpo: (await r.json()) as Record<string, unknown> });
  /** Pede a prévia, espera o worker falso e devolve a pronta. */
  const contar = async (x: typeof empresa, entidades?: string[]) => {
    const id = crypto.randomUUID();
    const pedida = await ler(responderZerarFalso('POST', x, true, { id, ...(entidades ? { entidades } : {}) }));
    expect(pedida.status).toBe(202);
    expect(PreviaZerarSchema.parse(pedida.corpo).situacao).toBe('em_andamento');
    vi.advanceTimersByTime(PREVIA_FALSA_MS);
    return PreviaZerarSchema.parse((await ler(responderZerarFalso('GET', x, true, undefined, id))).corpo);
  };
  beforeEach(() => {
    limparZerarFalso();
    vi.useFakeTimers({ now: new Date('2026-11-23T12:00:00.000Z') });
  });
  afterEach(() => vi.useRealTimers());

  it('prévia: pedida em andamento, pronta depois, no schema do SDK; o mesmo id devolve a mesma; sem dados e com backup rodando', async () => {
    const id = '7c0d5e1a-2b4f-4c6d-8e9f-000000000020';
    expect(PreviaZerarSchema.parse((await ler(responderZerarFalso('POST', empresa, true, { id }))).corpo).situacao).toBe('em_andamento');
    expect(PreviaZerarSchema.parse((await ler(responderZerarFalso('GET', empresa, true, undefined, id))).corpo).situacao).toBe('em_andamento');
    vi.advanceTimersByTime(PREVIA_FALSA_MS);
    const p = PreviaZerarSchema.parse((await ler(responderZerarFalso('POST', empresa, true, { id }))).corpo);
    expect([p.id, p.situacao, p.bloqueio]).toEqual([id, 'pronta', null]);
    expect(p.total).toBeGreaterThan(0);
    expect(p.linhas?.some((l) => l.tabela === 'core.usuario')).toBe(true);
    expect((await contar({ ...empresa, codigo: 'atacado-norte' })).total).toBe(0);
    expect((await contar({ ...empresa, backupEmAndamento: true })).bloqueio).toBe(Z.backupEmAndamento);
    expect((await contar({ ...empresa, status: 'encerrado' })).bloqueio).toBe(Z.exclusaoEmAndamento);
  });
  it('prévia: id de outra empresa = 409 ID_EM_USO; id desconhecido = 404; corpo fora do schema = 400', async () => {
    const id = '7c0d5e1a-2b4f-4c6d-8e9f-000000000021';
    await ler(responderZerarFalso('POST', empresa, true, { id }));
    const outra = await ler(responderZerarFalso('POST', { ...empresa, id: '0b6f1a52-5c1e-4c4e-9a43-000000000002' }, true, { id }));
    expect([outra.status, outra.corpo.codigo]).toEqual([409, Z.idEmUso]);
    const nenhuma = await ler(responderZerarFalso('GET', empresa, true, undefined, '7c0d5e1a-2b4f-4c6d-8e9f-000000000099'));
    expect([nenhuma.status, nenhuma.corpo.codigo]).toEqual([404, Z.previaNaoEncontrada]);
    expect((await ler(responderZerarFalso('POST', empresa, true, { id: crypto.randomUUID(), entidades: ['nada'] }))).status).toBe(400);
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
    expect((await contar(empresa)).bloqueio).toBe(Z.zerarEmAndamento);
    vi.advanceTimersByTime(6_000);
    const fim = ZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, false, undefined))).corpo);
    expect(fim.situacao).toBe('concluido');
    expect(fim.linhas_apagadas).toBeGreaterThan(0);
    expect((await contar(empresa)).total).toBe(0);
  });
  it('por entidade: a prévia leva a cascata (cliente → endereços); o concluído traz o lote e as afetadas; a entidade fica vazia', async () => {
    const p = await contar(empresa, ['cliente']);
    expect(p.entidades).toEqual(['cliente']);
    expect(p.entidades_afetadas).toEqual(['cliente', 'cliente_endereco']);
    expect(p.linhas?.map((t) => t.tabela)).toEqual(['core.cliente', 'core.cliente_endereco', 'integracao.registro_atual']);
    const id = '7c0d5e1a-2b4f-4c6d-8e9f-000000000002';
    expect((await ler(responderZerarFalso('POST', empresa, false, { id, codigo_confirmacao: 'AM2290', senha: 'x', entidades: ['cliente'] }))).status).toBe(202);
    vi.advanceTimersByTime(6_000);
    const fim = ZerarEmpresaSchema.parse((await ler(responderZerarFalso('GET', empresa, false, undefined))).corpo);
    expect([fim.entidades, fim.entidades_afetadas, fim.linhas_apagadas]).toEqual([['cliente'], ['cliente', 'cliente_endereco'], 1180 + 1300 + 2550]);
    expect(fim.lote).toBe('20261123T120001Z-7c0d5e1a'); // pedido depois do 1 s da prévia
    expect(entidadesZeradasFalso(T)).toEqual(new Set(['cliente', 'cliente_endereco']));
    const depois = await contar(empresa, ['cliente']);
    expect([depois.total, depois.entidades_afetadas]).toEqual([0, ['cliente']]);
  });
  it('empresa inexistente: 404', async () => {
    expect((await ler(responderZerarFalso('POST', null, true, { id: crypto.randomUUID() }))).status).toBe(404);
  });
});
