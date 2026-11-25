/**
 * T-0195 (ADR 0070 §D8 a, RN-CORE-80; R-20261123-201347-alexandre): nenhum orçamento, pedido ou pré-cadastro digitado se perde
 * com a atualização obrigatória. Critério principal: com o bloqueio ativo, a fila do aparelho não é apagada, o envio é liberado
 * e chamado sozinho, e o botão "Baixar a versão X.Y.Z" só aparece com a fila, os "Não aceito" e os rascunhos em zero.
 * Motor real do SDK sobre um disco em memória, com o transporte v1 do shell e uma API falsa.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  comPrefixo,
  criarMotorSync,
  criarRegistroSync,
  defineModule,
  definirEntidadeSync,
  type ArmazenamentoSync,
  type MotorSync,
} from '@macuxi/platform-sdk';

import { HttpError, NetworkError, type ApiClient } from '@/services/api';
import { transporteV1 } from '@/services/transporte';

import {
  contarParaAtualizar,
  criarPortaoAtualizacao,
  DESTINO_FILA_DO_APARELHO,
  DESTINO_LOGIN,
  destinoDaAcao,
  podeBaixar,
  rotaLiberadaParaResolver,
  telaDaAtualizacao,
  telaDoPortao,
  TEXTOS_ATUALIZACAO_APP,
  type ContagemAtualizacao,
  type ContextoDestino,
  type PortaoAtualizacao,
  type ResultadoEnvioAtualizacao,
} from './portao-atualizacao';

const PEDIDO = '0e000000-0000-4000-8000-000000000001';
const ORCAMENTO = '0e000000-0000-4000-8000-000000000002';
const PRE_CADASTRO = '0e000000-0000-4000-8000-000000000003';
const URL_APK = 'https://pacotes.exemplo.com/campo/Campo-Oficial-v1.0.34.apk?assinatura=x';

/** Visão com Pedidos e Clientes (a página que corrige o "Não aceito"). */
const ctx = (fila: ContextoDestino['fila'], extra: Partial<ContextoDestino> = {}): ContextoDestino => ({
  fila,
  arquivos: [],
  hrefRascunhos: null,
  telaExiste: (c) => c === 'pedidos' || c === 'clientes',
  ...extra,
});

function disco(): { dados: Map<string, string>; armazenamento: ArmazenamentoSync } {
  const dados = new Map<string, string>();
  const base: ArmazenamentoSync = {
    ler: async <T,>(c: string) => (dados.has(c) ? (JSON.parse(dados.get(c)!) as T) : null),
    gravar: async (c, v) => void (v === null || v === undefined ? dados.delete(c) : dados.set(c, JSON.stringify(v))),
    remover: async (c) => void dados.delete(c),
    chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)).sort(),
  };
  return { dados, armazenamento: comPrefixo(base, 'macuxi:u:carla:') };
}

type Api = (metodo: string, caminho: string, opts?: { body?: unknown }) => Promise<{ status: number; data: unknown }>;

/** Motor com pedido, orçamento e pré-cadastro na fila; `api` decide cada resposta. */
async function aparelhoComFila(api: Api) {
  const registro = criarRegistroSync([defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['pedido', 'cliente_pre_cadastro'] })]);
  registro.registrar(definirEntidadeSync({ nome: 'pedido', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: z.object({ tipo: z.string(), total_centavos: z.number() }) }));
  registro.registrar(definirEntidadeSync({ nome: 'cliente_pre_cadastro', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: z.object({ cnpj: z.string() }) }));
  const cliente = { request: vi.fn(api) } as unknown as ApiClient;
  const d = disco();
  const motor = criarMotorSync({ registro, armazenamento: d.armazenamento, transporte: transporteV1(() => cliente, async () => undefined), online: () => true });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core']);
  await motor.enfileirar({ id: PEDIDO, entidade: 'pedido', payload: { tipo: 'pedido', total_centavos: 12_345 } });
  await motor.enfileirar({ id: ORCAMENTO, entidade: 'pedido', payload: { tipo: 'orcamento', total_centavos: 9_900 } });
  await motor.enfileirar({ id: PRE_CADASTRO, entidade: 'cliente_pre_cadastro', payload: { cnpj: '11222333000181' } });
  return { motor, d, cliente };
}

/** O portão como a plataforma o monta (`state/plataforma.tsx`), sobre o motor real. */
function portaoSobre(
  motor: MotorSync,
  o: { rascunhos?: () => number; semSinal?: () => boolean; modoSemSinal?: { ligado: boolean }; sessao?: { ok: boolean } } = {},
) {
  const descartar = vi.spyOn(motor, 'descartar');
  const descartarArquivo = vi.spyOn(motor, 'descartarArquivo');
  const enviar = vi.spyOn(motor, 'enviar');
  const pedirLink = vi.fn(async () => ({ tipo: 'ok' as const, url: URL_APK }));
  const abrirNoNavegador = vi.fn(async (_url: string) => undefined);
  const desligarModoSemSinal = vi.fn(async () => {
    if (o.modoSemSinal) o.modoSemSinal.ligado = false;
  });
  const portao = criarPortaoAtualizacao({
    temSessao: () => o.sessao?.ok ?? true,
    modoSemSinal: () => o.modoSemSinal?.ligado ?? false,
    desligarModoSemSinal,
    contar: async () => {
      const n = o.rascunhos?.() ?? 0;
      return contarParaAtualizar(motor.estado(), n > 0 ? [{ total: n, href: '/m/rascunhos' }] : []);
    },
    async enviar(): Promise<ResultadoEnvioAtualizacao> {
      if (o.semSinal?.() || o.modoSemSinal?.ligado) return 'sem_sinal';
      await motor.enviar({ incluirFalhos: false });
      return 'ok';
    },
    pedirLink,
    abrirNoNavegador,
  });
  return { portao, descartar, descartarArquivo, enviar, pedirLink, abrirNoNavegador, desligarModoSemSinal };
}

const telaDo = (p: PortaoAtualizacao, versao = '1.0.34') => telaDoPortao(p.estado(), versao);
const SEM = { naoAceitos: 0, rascunhos: 0, hrefRascunhos: null, pendenciasComErro: null };

describe('T-0195 critério principal: bloqueio ativo com pedido, orçamento e pré-cadastro na fila', () => {
  it('nada é apagado, o envio é chamado sozinho e o botão do link não aparece até a fila esvaziar', async () => {
    let servidorFora = true;
    const { motor, d } = await aparelhoComFila(async (_m, caminho, opts) => {
      if (caminho !== '/sync/push') throw new HttpError(426, 'APP_DESATUALIZADO', 'Versão desatualizada, reinstale para continuar.');
      if (servidorFora) throw new NetworkError();
      const itens = (opts?.body as { itens: { id: string }[] }).itens;
      return { status: 200, data: { resultados: itens.map((i) => ({ id: i.id, status: 'aceito' })) } };
    });
    const t = portaoSobre(motor);

    // ao entrar, a tela envia sozinha; o envio cai (sem rede): os três continuam no aparelho, pendentes
    await t.portao.entrar();
    expect(t.enviar).toHaveBeenCalledWith({ incluirFalhos: false });
    expect(motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([
      [PEDIDO, 'pendente'],
      [ORCAMENTO, 'pendente'],
      [PRE_CADASTRO, 'pendente'],
    ]);
    expect([...d.dados.keys()].some((k) => k.includes('fila'))).toBe(true);
    expect(t.portao.estado().contagem).toEqual({ pendentes: 3, ...SEM });
    expect(telaDo(t.portao)).toMatchObject({ estado: 'erro_envio', principal: { acao: 'enviar', rotulo: 'Tentar de novo' } });
    expect(telaDo(t.portao).principal.acao).not.toBe('baixar');

    // tocar no link à força (segunda trava): não pede nada à API
    await t.portao.baixar();
    expect(t.pedirLink).not.toHaveBeenCalled();
    expect(t.abrirNoNavegador).not.toHaveBeenCalled();

    // o motor reabre do disco (app fechado e aberto de novo): a fila está lá
    await motor.carregar();
    expect(motor.estado().fila).toHaveLength(3);

    // o sinal volta: "Tentar de novo" envia; o push é liberado no bloqueio e o servidor aceita os três
    servidorFora = false;
    await t.portao.enviarAgora();
    expect(motor.estado().fila).toEqual([]);
    expect(t.portao.estado().contagem).toEqual({ pendentes: 0, ...SEM });
    expect(telaDo(t.portao)).toMatchObject({ estado: 'pronto', principal: { acao: 'baixar', rotulo: 'Baixar a versão 1.0.34' } });

    // agora o link: pedido na hora, aberto no navegador e nunca guardado
    await t.portao.baixar();
    expect(t.pedirLink).toHaveBeenCalledTimes(1);
    expect(t.abrirNoNavegador).toHaveBeenCalledWith(URL_APK);
    expect(JSON.stringify(t.portao.estado())).not.toContain('pacotes.exemplo.com');
    expect([...d.dados.values()].some((v) => v.includes('pacotes.exemplo.com'))).toBe(false);

    // em nenhum momento o portão descartou algo
    expect(t.descartar).not.toHaveBeenCalled();
    expect(t.descartarArquivo).not.toHaveBeenCalled();
  });

  it('o push recusado com 426 (servidor que ainda não libera o envio) deixa os três pendentes, nunca "Não aceito"', async () => {
    const { motor } = await aparelhoComFila(async () => {
      throw new HttpError(426, 'APP_DESATUALIZADO', 'Versão desatualizada, reinstale para continuar.');
    });
    const t = portaoSobre(motor);
    await t.portao.entrar();
    expect(motor.estado().fila.map((i) => i.situacao)).toEqual(['pendente', 'pendente', 'pendente']);
    expect(podeBaixar(t.portao.estado().contagem!)).toBe(false);
    expect(telaDo(t.portao).principal.acao).toBe('enviar');
  });

  it('sem sinal: o banner pede conexão e o link não aparece; a fila fica intacta', async () => {
    const { motor } = await aparelhoComFila(async () => ({ status: 200, data: { resultados: [] } }));
    const t = portaoSobre(motor, { semSinal: () => true });
    await t.portao.entrar();
    expect(motor.estado().fila).toHaveLength(3);
    expect(telaDo(t.portao)).toMatchObject({
      estado: 'sem_sinal_fila',
      linha: { tipo: 'banner', tom: 'warning', icone: 'wifiOff', texto: 'Sem sinal. Conecte-se à internet para enviar 3 itens.' },
      principal: { acao: 'enviar', rotulo: 'Enviar agora' },
    });
  });

  it('com a fila enviada mas um rascunho guardado, o link não aparece; abre só os Rascunhos', async () => {
    const { motor } = await aparelhoComFila(async (_m, _c, opts) => ({
      status: 200,
      data: { resultados: (opts?.body as { itens: { id: string }[] }).itens.map((i) => ({ id: i.id, status: 'aceito' })) },
    }));
    let rascunhos = 1;
    const t = portaoSobre(motor, { rascunhos: () => rascunhos });
    await t.portao.entrar();
    expect(motor.estado().fila).toEqual([]);
    expect(telaDo(t.portao)).toMatchObject({
      estado: 'rascunhos',
      texto: 'Antes de reinstalar, envie ou descarte o rascunho. Não desinstale o app.',
      linha: null,
      principal: { acao: 'abrir_rascunhos', rotulo: 'Abrir o rascunho' },
    });
    await t.portao.baixar();
    expect(t.pedirLink).not.toHaveBeenCalled();
    // a tela vem do gancho do módulo (`href`), não de uma rota fixa no shell
    expect(destinoDaAcao('abrir_rascunhos', ctx(motor.estado().fila, { hrefRascunhos: t.portao.estado().contagem!.hrefRascunhos }))).toEqual({
      abrir: '/m/rascunhos',
      liberadas: ['/m'],
    });

    // o vendedor envia (ou descarta de propósito) o rascunho na tela dele: só então o link
    rascunhos = 0;
    await t.portao.recontar();
    expect(telaDo(t.portao).principal.acao).toBe('baixar');
  });

  it('com um "Não aceito" na fila, o link não aparece; o item fica com o motivo e abre só a tela que o corrige', async () => {
    const { motor } = await aparelhoComFila(async (_m, _c, opts) => ({
      status: 200,
      data: {
        resultados: (opts?.body as { itens: { id: string }[] }).itens.map((i) =>
          i.id === ORCAMENTO ? { id: i.id, status: 'rejeitado', codigo: 'RN-VEN-10', mensagem: 'Preço desatualizado.' } : { id: i.id, status: 'aceito' },
        ),
      },
    }));
    const t = portaoSobre(motor);
    await t.portao.entrar();
    expect(motor.estado().fila).toMatchObject([{ id: ORCAMENTO, situacao: 'falhou', codigo: 'RN-VEN-10' }]);
    expect(t.portao.estado().contagem).toEqual({ pendentes: 0, ...SEM, naoAceitos: 1 });
    expect(telaDo(t.portao)).toMatchObject({
      estado: 'nao_aceitos',
      texto: 'Antes de reinstalar, corrija ou descarte o item não aceito. Não desinstale o app.',
      linha: null,
      principal: { acao: 'abrir_nao_aceitos', rotulo: 'Abrir o não aceito' },
    });
    await t.portao.baixar();
    expect(t.pedirLink).not.toHaveBeenCalled();
    expect(destinoDaAcao('abrir_nao_aceitos', ctx(motor.estado().fila)).abrir).toBe('/m/pedidos');
    // o "Não aceito" não é reenviado sozinho nem descartado
    expect(t.enviar.mock.calls.every(([o]) => o?.incluirFalhos === false)).toBe(true);
    expect(t.descartar).not.toHaveBeenCalled();
  });
});

describe('modo sem sinal ligado (§5.1, prioridade 1)', () => {
  it('nada é tentado por baixo; "Desligar modo sem sinal" desliga e já envia; a fila fica intacta', async () => {
    const { motor } = await aparelhoComFila(async (_m, _c, opts) => ({
      status: 200,
      data: { resultados: (opts?.body as { itens: { id: string }[] }).itens.map((i) => ({ id: i.id, status: 'aceito' })) },
    }));
    const modo = { ligado: true };
    const t = portaoSobre(motor, { modoSemSinal: modo });
    await t.portao.entrar();
    expect(t.enviar).not.toHaveBeenCalled();
    expect(motor.estado().fila).toHaveLength(3);
    expect(telaDo(t.portao)).toEqual({
      estado: 'modo_sem_sinal',
      texto: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
      linha: null,
      principal: { rotulo: 'Desligar modo sem sinal', acao: 'desligar_modo_sem_sinal', ocupado: false },
      suporte: false,
    });
    // "Enviar agora" à força com o modo ligado: nada sai
    await t.portao.enviarAgora();
    expect(t.enviar).not.toHaveBeenCalled();

    const vistos: string[] = [];
    t.portao.assinar((e) => vistos.push(telaDoPortao(e, '1.0.34').estado + (e.desligando ? ':ocupado' : '')));
    await t.portao.desligarModoSemSinal();
    expect(t.desligarModoSemSinal).toHaveBeenCalledTimes(1);
    expect(vistos[0]).toBe('modo_sem_sinal:ocupado');
    expect(vistos).toContain('enviando');
    expect(motor.estado().fila).toEqual([]);
    expect(telaDo(t.portao).estado).toBe('pronto');
  });
});

describe('contagem e estados da tela (docs/design/t0195-atualizacao-obrigatoria.md §3.3 e §5.2)', () => {
  const base = { modoSemSinal: false, temSessao: true, envio: 'parado', link: 'parado', versao: '1.0.34' } as const;
  const c = (x: Partial<ContagemAtualizacao>): ContagemAtualizacao => ({ pendentes: 0, ...SEM, ...x });

  it('conta comandos e arquivos: pendente; falhou e modulo_inativo como "Não aceito"; enviado e aceito não contam', () => {
    const it = (situacao: string) => ({ situacao }) as never;
    const estado = { fila: [it('pendente'), it('falhou'), it('modulo_inativo')], arquivos: [it('pendente'), it('enviado'), it('falhou')] };
    expect(contarParaAtualizar(estado, [{ total: 2, href: '/m/rascunhos' }])).toEqual({ pendentes: 2, naoAceitos: 3, rascunhos: 2, hrefRascunhos: '/m/rascunhos', pendenciasComErro: null });
    expect(podeBaixar(c({}))).toBe(true);
    for (const x of [{ pendentes: 1 }, { naoAceitos: 1 }, { rascunhos: 1 }, { pendenciasComErro: 'x' }]) expect(podeBaixar(c(x))).toBe(false);
  });

  it('textos literais da especificação, com singular', () => {
    expect(telaDaAtualizacao({ ...base, contagem: c({ pendentes: 1 }) })).toMatchObject({
      texto: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
      linha: { tipo: 'chip', texto: '1 na fila', icone: 'clock' },
      principal: { rotulo: 'Enviar agora', ocupado: false },
      suporte: false,
    });
    expect(telaDaAtualizacao({ ...base, envio: 'enviando', contagem: c({ pendentes: 4 }) })).toMatchObject({ linha: { texto: '4 na fila', icone: 'sync' }, principal: { ocupado: true } });
    expect(telaDaAtualizacao({ ...base, envio: 'erro', contagem: c({ pendentes: 1 }) })).toMatchObject({
      linha: { tipo: 'banner', tom: 'danger', texto: 'Não deu para enviar 1 item.' },
      principal: { rotulo: 'Tentar de novo' },
      suporte: true,
    });
    expect(telaDaAtualizacao({ ...base, envio: 'sem_sinal', contagem: c({ pendentes: 2 }) }).linha).toMatchObject({ texto: 'Sem sinal. Conecte-se à internet para enviar 2 itens.' });
    expect(telaDaAtualizacao({ ...base, contagem: c({}) })).toMatchObject({
      estado: 'pronto',
      texto: 'Instale por cima desta versão, sem desinstalar o app.',
      linha: null,
      principal: { rotulo: 'Baixar a versão 1.0.34', acao: 'baixar' },
    });
    expect(telaDaAtualizacao({ ...base, link: 'gerando', contagem: c({}) }).principal).toMatchObject({ acao: 'baixar', ocupado: true });
    expect(telaDaAtualizacao({ ...base, link: 'erro', contagem: c({}) })).toMatchObject({
      linha: { texto: 'Não deu para preparar o download.' },
      principal: { rotulo: 'Tentar de novo', acao: 'baixar' },
      suporte: true,
    });
    expect(telaDaAtualizacao({ ...base, link: 'sem_sinal', contagem: c({}) }).linha).toMatchObject({ texto: 'Sem sinal. Conecte-se à internet.' });
    // §5.2: plural, sem chip e sem suporte
    expect(telaDaAtualizacao({ ...base, contagem: c({ naoAceitos: 3 }) })).toEqual({
      estado: 'nao_aceitos',
      texto: 'Antes de reinstalar, corrija ou descarte 3 itens não aceitos. Não desinstale o app.',
      linha: null,
      principal: { rotulo: 'Abrir os não aceitos', acao: 'abrir_nao_aceitos', ocupado: false },
      suporte: false,
    });
    expect(telaDaAtualizacao({ ...base, contagem: c({ rascunhos: 2 }) })).toMatchObject({
      texto: 'Antes de reinstalar, envie ou descarte 2 rascunhos. Não desinstale o app.',
      linha: null,
      principal: { rotulo: 'Abrir os rascunhos' },
    });
    expect(TEXTOS_ATUALIZACAO_APP.titulo).toBe('Versão desatualizada, reinstale para continuar.');
  });

  it('U1 e U2: gancho com erro ou pendência sem tela navegável = erro do download, sem rascunho inventado', () => {
    const erroLink = {
      estado: 'erro_link',
      texto: 'Instale por cima desta versão, sem desinstalar o app.',
      linha: { tipo: 'banner', tom: 'danger', icone: 'alert', texto: 'Não deu para preparar o download.', anunciar: true },
      principal: { rotulo: 'Tentar de novo', acao: 'baixar', ocupado: false },
      suporte: true,
    };
    const comErro = contarParaAtualizar({ fila: [], arquivos: [] }, { erro: 'banco do vendedor indisponível' });
    expect(comErro).toEqual({ pendentes: 0, naoAceitos: 0, rascunhos: 0, hrefRascunhos: null, pendenciasComErro: 'banco do vendedor indisponível' });
    expect(telaDaAtualizacao({ ...base, contagem: comErro })).toEqual(erroLink);
    // href nulo com rascunho: o mesmo erro (o botão de rascunhos só existe com tela navegável)
    const semTela = contarParaAtualizar({ fila: [], arquivos: [] }, [{ total: 2, href: null }]);
    expect(semTela.pendenciasComErro).not.toBeNull();
    expect(telaDaAtualizacao({ ...base, contagem: semTela })).toEqual(erroLink);
    // "Não aceito" vem antes; pendentes antes de tudo
    expect(telaDaAtualizacao({ ...base, contagem: { ...comErro, naoAceitos: 1 } }).estado).toBe('nao_aceitos');
    expect(telaDaAtualizacao({ ...base, contagem: { ...comErro, pendentes: 1 } }).estado).toBe('fila');
  });

  it('U3: até a primeira contagem, nenhum número e "Enviar agora" ocupado', () => {
    expect(telaDaAtualizacao({ ...base, contagem: null })).toEqual({
      estado: 'contando',
      texto: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
      linha: null,
      principal: { rotulo: 'Enviar agora', acao: 'enviar', ocupado: true },
      suporte: false,
    });
    const portao = criarPortaoAtualizacao({
      temSessao: () => true,
      modoSemSinal: () => false,
      desligarModoSemSinal: async () => undefined,
      contar: async () => contarParaAtualizar({ fila: [], arquivos: [] }, []),
      enviar: async () => 'ok',
      pedirLink: async () => ({ tipo: 'erro' }),
      abrirNoNavegador: async () => undefined,
    });
    expect(telaDo(portao).estado).toBe('contando');
  });

  it('U1: "Tentar de novo" reconta; com o erro do gancho ainda lá, o link não é pedido e o erro continua com o detalhe', async () => {
    let gancho: { erro: string } | [] = { erro: 'banco do vendedor indisponível' };
    const pedirLink = vi.fn(async () => ({ tipo: 'ok' as const, url: URL_APK }));
    const portao = criarPortaoAtualizacao({
      temSessao: () => true,
      modoSemSinal: () => false,
      desligarModoSemSinal: async () => undefined,
      contar: async () => contarParaAtualizar({ fila: [], arquivos: [] }, gancho),
      enviar: async () => 'ok',
      pedirLink,
      abrirNoNavegador: async () => undefined,
    });
    await portao.entrar();
    expect(telaDo(portao).estado).toBe('erro_link');
    expect(portao.estado().detalhe).toBe('banco do vendedor indisponível');
    await portao.baixar();
    expect(pedirLink).not.toHaveBeenCalled();
    expect(portao.estado().link).toBe('erro');
    expect(telaDo(portao).estado).toBe('erro_link');
    // o gancho voltou: o próximo toque pede o link
    gancho = [];
    await portao.baixar();
    expect(pedirLink).toHaveBeenCalledTimes(1);
    expect(portao.estado().link).toBe('parado');
  });

  it('o botão do link nunca aparece com contagem acima de zero, sem sessão ou com o modo sem sinal, em nenhum estado', () => {
    for (const envio of ['parado', 'enviando', 'erro', 'sem_sinal'] as const)
      for (const link of ['parado', 'gerando', 'erro', 'sem_sinal'] as const) {
        for (const x of [{ pendentes: 2 }, { naoAceitos: 1 }, { rascunhos: 3 }])
          expect(telaDaAtualizacao({ ...base, envio, link, contagem: c(x) }).principal.acao).not.toBe('baixar');
        expect(telaDaAtualizacao({ ...base, envio, link, temSessao: false, contagem: c({}) }).principal.acao).not.toBe('baixar');
        expect(telaDaAtualizacao({ ...base, envio, link, modoSemSinal: true, contagem: c({}) }).principal.acao).not.toBe('baixar');
      }
  });

  it('prioridade: modo sem sinal > sem sessão > pendentes > não aceito > rascunhos', () => {
    const tudo = c({ pendentes: 1, naoAceitos: 1, rascunhos: 1 });
    expect(telaDaAtualizacao({ ...base, modoSemSinal: true, temSessao: false, contagem: tudo }).estado).toBe('modo_sem_sinal');
    expect(telaDaAtualizacao({ ...base, modoSemSinal: true, desligando: true, contagem: tudo }).principal.ocupado).toBe(true);
    expect(telaDaAtualizacao({ ...base, temSessao: false, contagem: tudo })).toMatchObject({ estado: 'sem_sessao', linha: null, principal: { rotulo: 'Entrar', acao: 'entrar' } });
    expect(telaDaAtualizacao({ ...base, contagem: tudo }).estado).toBe('fila');
    expect(telaDaAtualizacao({ ...base, contagem: c({ naoAceitos: 1, rascunhos: 1 }) }).estado).toBe('nao_aceitos');
    expect(destinoDaAcao('entrar', ctx([]))).toBe(DESTINO_LOGIN);
  });

  it('a mesma leitura de sessão na tela de bloqueio e na folha: vem do portão', async () => {
    const { motor } = await aparelhoComFila(async () => ({ status: 200, data: { resultados: [] } }));
    const sessao = { ok: false };
    const t = portaoSobre(motor, { sessao });
    await t.portao.entrar();
    expect(t.portao.estado().temSessao).toBe(false);
    expect(telaDo(t.portao).estado).toBe('sem_sessao');
    expect(t.enviar).not.toHaveBeenCalled();
    sessao.ok = true;
    await t.portao.recontar();
    expect(t.portao.estado().temSessao).toBe(true);
  });
});

describe('telas que resolvem', () => {
  it('o primeiro "Não aceito" decide: pedido ou pré-cadastro recusado na página que corrige; o resto na fila do aparelho', () => {
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([{ entidade: 'cliente_pre_cadastro', situacao: 'falhou' }]))).toEqual({ abrir: '/m/clientes', liberadas: ['/m'] });
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([{ entidade: 'pedido', situacao: 'pendente' }, { entidade: 'visita', situacao: 'falhou' }]))).toBe(DESTINO_FILA_DO_APARELHO);
    // módulo desativado não se corrige na tela do pedido: fila do aparelho, onde há o Descartar
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([{ entidade: 'pedido', situacao: 'modulo_inativo' }]))).toBe(DESTINO_FILA_DO_APARELHO);
    // foto recusada (arquivo) ou página fora da visão: fila do aparelho
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([], { arquivos: [{ situacao: 'falhou' }] }))).toBe(DESTINO_FILA_DO_APARELHO);
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([{ entidade: 'pedido', situacao: 'falhou' }], { telaExiste: () => false }))).toBe(DESTINO_FILA_DO_APARELHO);
    expect(destinoDaAcao('abrir_nao_aceitos', ctx([]))).toBe(DESTINO_FILA_DO_APARELHO);
    expect(DESTINO_FILA_DO_APARELHO.abrir).toBe('/profile');
  });

  it('só as rotas liberadas da tela que resolve; fora delas a tela de bloqueio volta', () => {
    const rascunhos = destinoDaAcao('abrir_rascunhos', ctx([], { hrefRascunhos: '/m/rascunhos' }));
    expect(rotaLiberadaParaResolver('/m/rascunhos', rascunhos)).toBe(true);
    expect(rotaLiberadaParaResolver('/m/novo-pedido?rascunho=a', rascunhos)).toBe(true);
    expect(rotaLiberadaParaResolver('/', rascunhos)).toBe(false);
    expect(rotaLiberadaParaResolver('/profile', rascunhos)).toBe(false);
    expect(rotaLiberadaParaResolver('/m/pedidos', DESTINO_FILA_DO_APARELHO)).toBe(false);
    expect(rotaLiberadaParaResolver('/m/pedidos', null)).toBe(false);
  });
});
