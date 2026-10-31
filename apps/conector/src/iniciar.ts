/** Monta o contexto de execução a partir do arquivo de configuração (config + segredos + log + fila + ERP + Hub). */
import { dirname, isAbsolute, resolve } from 'node:path';
import { Armazenamento } from './armazenamento/armazenamento';
import { carregarConfig } from './config/carregar';
import type { ConfigConector } from './config/esquema';
import { type Contexto, uuidReal } from './contexto';
import { abrirConexaoErp } from './erp/fabrica';
import { ClienteHub } from './hub/cliente';
import { criarLogger, type Logger } from './log/logger';
import { criarProvedor, Segredos } from './segredos/provedores';
import { relogioReal } from './util/relogio';

export interface Ambiente {
  config: ConfigConector;
  dadosDir: string;
  caminhoConfig: string;
  segredos: Segredos;
  log: Logger;
}

export function prepararAmbiente(caminhoConfig: string, opcoes: { console?: boolean; env?: NodeJS.ProcessEnv } = {}): Ambiente {
  const caminho = resolve(caminhoConfig);
  const config = carregarConfig(caminho);
  const dadosDir = isAbsolute(config.dadosDir) ? config.dadosDir : resolve(dirname(caminho), config.dadosDir);
  const log = criarLogger({
    pasta: resolve(dadosDir, 'logs'),
    nivel: config.logs.nivel,
    retencaoDias: config.logs.retencaoDias,
    maxBytes: Math.round(config.logs.maxMegabytes * 1024 * 1024),
    console: opcoes.console,
  });
  const segredos = new Segredos(criarProvedor(config.segredos.provedor, { env: opcoes.env }));
  return { config, dadosDir, caminhoConfig: caminho, segredos, log };
}

/** Abre ERP, fila e cliente do Hub. Quem chama fecha com `fecharContexto`. */
export async function abrirContexto(amb: Ambiente): Promise<Contexto> {
  const senha = await amb.segredos.exigir('erp_senha');
  const erp = await abrirConexaoErp(amb.config.erp, senha);
  const store = Armazenamento.abrir(resolve(amb.dadosDir, 'fila.sqlite'));
  const hub = new ClienteHub({
    url: amb.config.hub.url,
    token: () => amb.segredos.exigir('hub_token'),
    timeoutMs: amb.config.hub.timeoutSegundos * 1000,
    retry: amb.config.hub.retry,
    aoRetentar: (i) => amb.log.aviso('hub_retry', i),
  });
  return { config: amb.config, erp, hub, store, log: amb.log, relogio: relogioReal, uuid: uuidReal, aleatorio: Math.random };
}

export async function fecharContexto(ctx: Contexto): Promise<void> {
  await ctx.erp.fechar();
  ctx.store.fechar();
}
