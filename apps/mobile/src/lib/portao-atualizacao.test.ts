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
  contadorDeRascunhos,
  contarParaAtualizar,
  criarPortaoAtualizacao,
  DESTINO_CLIENTE_NAO_ACEITO,
  DESTINO_FILA_DO_APARELHO,
  DESTINO_LOGIN,
  DESTINO_PEDIDO_NAO_ACEITO,
  DESTINO_RASCUNHOS,
  destinoDaAcao,
  podeBaixar,
  rotaLiberadaParaResolver,
  telaDaAtualizacao,
  TEXTOS_ATUALIZACAO_APP,
  type ContagemAtualizacao,
  type PortaoAtualizacao,
  type ResultadoEnvioAtualizacao,
} from './portao-atualizacao';
import { situacaoGuardada, telaDeBloqueioNaEntrada, type VersaoPublicadaGuardada } from './versao-app';

const PEDIDO = '0e000000-0000-4000-8000-000000000001';
const ORCAMENTO = '0e000000-0000-4000-8000-000000000002';
const PRE_CADASTRO = '0e000000-0000-4000-8000-000000000003';
const URL_APK = 'https://pacotes.exemplo.com/campo/Campo-Oficial-v1.0.34.apk?assinatura=x';

/** Bloqueio ativo: publicada há 25 h (RN-CORE-80), instalada 1.0.33. */
const AGORA = new Date('2026-11-25T15:00:00.000Z');
const GUARDADA: VersaoPublicadaGuardada = { variante: 'campo', versao: '1.0.34', publicada_em: '2026-11-24T14:00:00.000Z', recebida_em: '2026-11-24T14:05:00.000Z' };

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
function portaoSobre(motor: MotorSync, o: { rascunhos?: () => number; semSinal?: () => boolean } = {}) {
  const descartar = vi.spyOn(motor, 'descartar');
  const descartarArquivo = vi.spyOn(motor, 'descartarArquivo');
  const enviar = vi.spyOn(motor, 'enviar');
  const pedirLink = vi.fn(async () => ({ tipo: 'ok' as const, url: URL_APK }));
  const abrirNoNavegador = vi.fn(async (_url: string) => undefined);
  const portao = criarPortaoAtualizacao({
    temSessao: () => true,
    contar: async () => contarParaAtualizar(motor.estado(), o.rascunhos?.() ?? 0),
    async enviar(): Promise<ResultadoEnvioAtualizacao> {
      if (o.semSinal?.()) return 'sem_sinal';
      await motor.enviar({ incluirFalhos: false });
      return 'ok';
    },
    pedirLink,
    abrirNoNavegador,
  });
  return { portao, descartar, descartarArquivo, enviar, pedirLink, abrirNoNavegador };
}

const telaDo = (p: PortaoAtualizacao, versao = '1.0.34') => {
  const e = p.estado();
  return telaDaAtualizacao({ temSessao: true, contagem: e.contagem, envio: e.envio, link: e.link, versao });
};

describe('T-0195 critério principal: bloqueio ativo com pedido, orçamento e pré-cadastro na fila', () => {
  it('o bloqueio está ativo pela última versão guardada (sem rede): a entrada mostra só a tela de bloqueio', () => {
    expect(situacaoGuardada(GUARDADA, '1.0.33', AGORA).situacao).toBe('bloqueada');
    expect(telaDeBloqueioNaEntrada({ mostrando: false, bloqueada: true, entrada: true })).toBe(true);
  });

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
    expect(t.portao.estado().contagem).toEqual({ pendentes: 3, naoAceitos: 0, rascunhos: 0 });
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
    expect(t.portao.estado().contagem).toEqual({ pendentes: 0, naoAceitos: 0, rascunhos: 0 });
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
    expect(podeBaixar(t.portao.estado().contagem)).toBe(false);
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
    expect(telaDo(t.portao)).toMatchObject({ estado: 'rascunhos', principal: { acao: 'abrir_rascunhos' } });
    await t.portao.baixar();
    expect(t.pedirLink).not.toHaveBeenCalled();
    expect(destinoDaAcao('abrir_rascunhos', motor.estado().fila)).toBe(DESTINO_RASCUNHOS);

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
    expect(t.portao.estado().contagem).toEqual({ pendentes: 0, naoAceitos: 1, rascunhos: 0 });
    expect(telaDo(t.portao)).toMatchObject({ estado: 'nao_aceitos', principal: { acao: 'abrir_nao_aceitos' } });
    await t.portao.baixar();
    expect(t.pedirLink).not.toHaveBeenCalled();
    expect(destinoDaAcao('abrir_nao_aceitos', motor.estado().fila)).toBe(DESTINO_PEDIDO_NAO_ACEITO);
    // o "Não aceito" não é reenviado sozinho nem descartado
    expect(t.enviar.mock.calls.every(([o]) => o?.incluirFalhos === false)).toBe(true);
    expect(t.descartar).not.toHaveBeenCalled();
  });
});

describe('contagem e estados da tela (docs/design/t0195-atualizacao-obrigatoria.md §3.3)', () => {
  const base = { temSessao: true, envio: 'parado', link: 'parado', versao: '1.0.34' } as const;
  const c = (x: Partial<ContagemAtualizacao>): ContagemAtualizacao => ({ pendentes: 0, naoAceitos: 0, rascunhos: 0, ...x });

  it('conta comandos e arquivos: pendente; falhou e modulo_inativo como "Não aceito"; enviado e aceito não contam', () => {
    const it = (situacao: string) => ({ situacao }) as never;
    expect(
      contarParaAtualizar({ fila: [it('pendente'), it('falhou'), it('modulo_inativo')], arquivos: [it('pendente'), it('enviado'), it('falhou')] }, 2),
    ).toEqual({ pendentes: 2, naoAceitos: 3, rascunhos: 2 });
    expect(podeBaixar(c({}))).toBe(true);
    for (const x of [{ pendentes: 1 }, { naoAceitos: 1 }, { rascunhos: 1 }]) expect(podeBaixar(c(x))).toBe(false);
  });

  it('textos literais da especificação, com singular', () => {
    expect(telaDaAtualizacao({ ...base, contagem: c({ pendentes: 1 }) })).toMatchObject({
      texto: 'Antes de reinstalar, envie o que está neste aparelho. Não desinstale o app.',
      linha: { tipo: 'chip', texto: '1 na fila', icone: 'clock' },
      principal: { rotulo: 'Enviar agora', ocupado: false },
      suporte: false,
    });
    expect(telaDaAtualizacao({ ...base, envio: 'enviando', contagem: c({ pendentes: 4 }) })).toMatchObject({ linha: { texto: 'Enviando 4…', icone: 'sync' }, principal: { ocupado: true } });
    expect(telaDaAtualizacao({ ...base, envio: 'erro', contagem: c({ pendentes: 1 }) })).toMatchObject({
      linha: { tipo: 'banner', tom: 'danger', texto: 'Não deu para enviar 1 item. Tente de novo; se continuar, avise o suporte.' },
      principal: { rotulo: 'Tentar de novo' },
      suporte: true,
    });
    expect(telaDaAtualizacao({ ...base, contagem: c({}) })).toMatchObject({
      estado: 'pronto',
      texto: 'Baixe a versão 1.0.34 e instale por cima desta. Não desinstale o app.',
      linha: null,
      principal: { rotulo: 'Baixar a versão 1.0.34', acao: 'baixar' },
    });
    expect(telaDaAtualizacao({ ...base, link: 'gerando', contagem: c({}) }).principal).toMatchObject({ acao: 'baixar', ocupado: true });
    expect(telaDaAtualizacao({ ...base, link: 'erro', contagem: c({}) })).toMatchObject({
      linha: { texto: 'Não deu para preparar o download. Tente de novo; se continuar, avise o suporte.' },
      principal: { rotulo: 'Tentar de novo', acao: 'baixar' },
      suporte: true,
    });
    expect(telaDaAtualizacao({ ...base, link: 'sem_sinal', contagem: c({}) }).linha).toMatchObject({ texto: 'Sem sinal. Conecte-se à internet para baixar a versão 1.0.34.' });
    expect(TEXTOS_ATUALIZACAO_APP.titulo).toBe('Versão desatualizada, reinstale para continuar.');
  });

  it('o botão do link nunca aparece com qualquer contagem acima de zero, em nenhum estado de envio ou de link', () => {
    for (const envio of ['parado', 'enviando', 'erro', 'sem_sinal'] as const)
      for (const link of ['parado', 'gerando', 'erro', 'sem_sinal'] as const)
        for (const x of [{ pendentes: 2 }, { naoAceitos: 1 }, { rascunhos: 3 }])
          expect(telaDaAtualizacao({ ...base, envio, link, contagem: c(x) }).principal.acao).not.toBe('baixar');
  });

  it('sem sessão: entrar primeiro (a fila é do usuário), sem link', () => {
    expect(telaDaAtualizacao({ ...base, temSessao: false, contagem: c({}) }).principal).toMatchObject({ acao: 'entrar' });
    expect(destinoDaAcao('entrar', [])).toBe(DESTINO_LOGIN);
  });
});

describe('telas que resolvem', () => {
  it('o primeiro "Não aceito" decide a tela: pedido, pré-cadastro ou a fila do aparelho', () => {
    expect(destinoDaAcao('abrir_nao_aceitos', [{ entidade: 'cliente_pre_cadastro', situacao: 'falhou' }])).toBe(DESTINO_CLIENTE_NAO_ACEITO);
    expect(destinoDaAcao('abrir_nao_aceitos', [{ entidade: 'pedido', situacao: 'pendente' }, { entidade: 'visita', situacao: 'falhou' }])).toBe(DESTINO_FILA_DO_APARELHO);
    expect(destinoDaAcao('abrir_nao_aceitos', [])).toBe(DESTINO_FILA_DO_APARELHO);
  });

  it('só as rotas liberadas da tela que resolve; fora delas a tela de bloqueio volta', () => {
    expect(rotaLiberadaParaResolver('/m/rascunhos', DESTINO_RASCUNHOS)).toBe(true);
    expect(rotaLiberadaParaResolver('/m/novo-pedido?rascunho=a', DESTINO_RASCUNHOS)).toBe(true);
    expect(rotaLiberadaParaResolver('/m/catalogo', DESTINO_RASCUNHOS)).toBe(false);
    expect(rotaLiberadaParaResolver('/', DESTINO_PEDIDO_NAO_ACEITO)).toBe(false);
    expect(rotaLiberadaParaResolver('/m/pedidos', null)).toBe(false);
  });
});

describe('leitura opcional dos rascunhos do Vendedor', () => {
  it('usa contarRascunhosParaAtualizar quando o módulo exporta', async () => {
    const f = vi.fn(async () => 2);
    const arm = {};
    await expect(contadorDeRascunhos({ contarRascunhosParaAtualizar: f }, async () => null)(arm, AGORA)).resolves.toBe(2);
    expect(f).toHaveBeenCalledWith(arm, AGORA);
  });

  it('sem a função: reserva conta as chaves guardadas; falha na leitura segura o link', async () => {
    await expect(contadorDeRascunhos({}, async () => ({ a: {}, b: {} }))(null, AGORA)).resolves.toBe(2);
    await expect(contadorDeRascunhos(undefined, async () => null)(null, AGORA)).resolves.toBe(0);
    await expect(
      contadorDeRascunhos({}, async () => {
        throw new Error('disco');
      })(null, AGORA),
    ).resolves.toBe(1);
  });
});
