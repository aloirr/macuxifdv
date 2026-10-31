/** Comandos da linha de comando (`conector <comando>`). Cada comando devolve o código de saída; nada aqui imprime segredo ou dado de linha. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ErroConfig, carregarConfig } from './config/carregar';
import { ehEntidade, ORDEM_CARGA, type Entidade } from './config/entidades';
import { adquirirTrava } from './trava';
import { Executor } from './executor';
import { abrirContexto, fecharContexto, prepararAmbiente } from './iniciar';
import { mapearEValidar } from './mapeamento';
import { criarProvedor, NOMES_SEGREDO, type NomeSegredo } from './segredos/provedores';
import { reiniciarCargaCompleta, retomarEntidade } from './sincronizador';
import { desinstalarServico, instalarServico } from './servico';
import { formatarStatus, montarStatus } from './status';
import { VERSAO_CONECTOR } from './versao';
import { Armazenamento } from './armazenamento/armazenamento';
import { resumoErro, uuidReal } from './contexto';
import { relogioReal } from './util/relogio';
import { mascararTexto } from './log/mascara';
import { cicloPedidos } from './pedidos';
import { processarFila } from './remetente';
import { sincronizarEntidade } from './sincronizador';

export interface ES {
  saida(texto: string): void;
  erro(texto: string): void;
  lerEntrada(): Promise<string>;
  env: NodeJS.ProcessEnv;
}

export const AJUDA = `Macuxi Conector ${VERSAO_CONECTOR}

Uso: conector <comando> [opções]      (--config <arquivo> ou MACUXI_CONECTOR_CONFIG; padrão ./conector.json)

  validar-config                    confere o arquivo de configuração (sem conectar a nada)
  testar-conexao                    testa segredos, banco do ERP (consultas e mapeamento) e Hub
  status [--json]                   fila local, último sucesso por entidade, bloqueios e erros
  rodar [--uma-vez]                 executa o laço (é o que o serviço roda); --uma-vez faz uma passada e sai
  carga-completa <entidade|todas>   refaz a carga completa (nova sessão)
  retomar <entidade>                libera uma entidade bloqueada e relê a partir do cursor confirmado
  segredo definir <nome>            grava no Gerenciador de Credenciais do Windows (valor pela entrada padrão)
                                    nomes: ${NOMES_SEGREDO.join(', ')}
  instalar-servico --winsw <exe> [--pasta <dir>] [--somente-gerar]
  desinstalar-servico [--pasta <dir>]
  versao                            mostra a versão
`;

export const ENV_CONFIG = 'MACUXI_CONECTOR_CONFIG';

export async function executarCli(argv: string[], io: ES): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        json: { type: 'boolean' },
        'uma-vez': { type: 'boolean' },
        winsw: { type: 'string' },
        pasta: { type: 'string' },
        'somente-gerar': { type: 'boolean' },
        ajuda: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.erro(`${(e as Error).message}\n\n${AJUDA}`);
    return 2;
  }
  const [comando, ...resto] = parsed.positionals;
  const o = parsed.values;
  if (!comando || o.ajuda || comando === 'ajuda') {
    io.saida(AJUDA);
    return comando || o.ajuda ? 0 : 2;
  }
  if (comando === 'versao') {
    io.saida(VERSAO_CONECTOR);
    return 0;
  }
  const caminhoConfig = o.config ?? io.env[ENV_CONFIG] ?? './conector.json';
  try {
    switch (comando) {
      case 'validar-config': {
        const cfg = carregarConfig(resolve(caminhoConfig));
        io.saida(`Configuração válida: ${Object.keys(cfg.entidades).length} entidade(s), ERP ${cfg.erp.tipo}, Hub ${new URL(cfg.hub.url).host}.`);
        return 0;
      }
      case 'testar-conexao':
        return await testarConexao(caminhoConfig, io);
      case 'status':
        return await status(caminhoConfig, Boolean(o.json), io);
      case 'rodar':
        return await rodar(caminhoConfig, Boolean(o['uma-vez']), io);
      case 'carga-completa':
      case 'retomar':
        return await operarEntidade(comando, resto[0], caminhoConfig, io);
      case 'segredo':
        return await segredo(resto, caminhoConfig, io);
      case 'instalar-servico': {
        const amb = prepararAmbiente(caminhoConfig, { env: io.env });
        const pasta = resolve(o.pasta ?? resolve(amb.dadosDir, '..', 'servico'));
        const r = await instalarServico({ pasta, winsw: o.winsw, caminhoConfig: amb.caminhoConfig, script: process.argv[1] ?? 'conector.mjs', pastaLogs: resolve(amb.dadosDir, 'logs'), somenteGerar: Boolean(o['somente-gerar']) });
        r.mensagens.forEach((m) => io.saida(m));
        io.saida('Se o serviço usa o Gerenciador de Credenciais, configure a conta do serviço em services.msc (aba "Fazer logon") para o usuário que gravou os segredos.');
        return 0;
      }
      case 'desinstalar-servico': {
        const amb = prepararAmbiente(caminhoConfig, { env: io.env });
        const pasta = resolve(o.pasta ?? resolve(amb.dadosDir, '..', 'servico'));
        (await desinstalarServico({ pasta })).forEach((m) => io.saida(m));
        return 0;
      }
      default:
        io.erro(`Comando desconhecido: ${comando}\n\n${AJUDA}`);
        return 2;
    }
  } catch (e) {
    io.erro(e instanceof ErroConfig ? e.message : `Erro: ${mascararTexto(resumoErro(e))}`);
    return 1;
  }
}

async function operarEntidade(comando: 'carga-completa' | 'retomar', alvo: string | undefined, caminhoConfig: string, io: ES): Promise<number> {
  if (!alvo) {
    io.erro(`Informe a entidade (${ORDEM_CARGA.join(', ')}${comando === 'carga-completa' ? ' ou todas' : ''}).`);
    return 2;
  }
  const amb = prepararAmbiente(caminhoConfig, { env: io.env });
  const alvos = alvo === 'todas' && comando === 'carga-completa' ? ORDEM_CARGA.filter((e) => amb.config.entidades[e]) : [alvo];
  for (const a of alvos) {
    if (!ehEntidade(a) || !amb.config.entidades[a]) {
      io.erro(`Entidade "${a}" não está configurada.`);
      return 2;
    }
  }
  mkdirSync(amb.dadosDir, { recursive: true });
  const liberar = adquirirTrava(amb.dadosDir);
  const store = Armazenamento.abrir(resolve(amb.dadosDir, 'fila.sqlite'));
  try {
    // só mexe no armazenamento local: não precisa de ERP nem de segredos
    const ctx = { store, log: amb.log, relogio: relogioReal, uuid: uuidReal };
    for (const a of alvos as Entidade[]) {
      if (comando === 'carga-completa') reiniciarCargaCompleta(ctx, a);
      else retomarEntidade(ctx, a);
      io.saida(`${a}: ${comando === 'carga-completa' ? 'carga completa agendada para o próximo ciclo' : 'liberada; relê a partir do cursor confirmado'}.`);
    }
  } finally {
    store.fechar();
    liberar();
  }
  return 0;
}

async function status(caminhoConfig: string, json: boolean, io: ES): Promise<number> {
  const amb = prepararAmbiente(caminhoConfig, { env: io.env });
  mkdirSync(amb.dadosDir, { recursive: true });
  const store = Armazenamento.abrir(resolve(amb.dadosDir, 'fila.sqlite'));
  try {
    const s = montarStatus(store, amb.config);
    io.saida(json ? JSON.stringify(s, null, 2) : formatarStatus(s));
    return s.entidades.some((e) => e.bloqueio) ? 3 : 0;
  } finally {
    store.fechar();
  }
}

async function rodar(caminhoConfig: string, umaVez: boolean, io: ES): Promise<number> {
  const amb = prepararAmbiente(caminhoConfig, { console: umaVez, env: io.env });
  mkdirSync(amb.dadosDir, { recursive: true });
  const liberar = adquirirTrava(amb.dadosDir);
  const ctx = await abrirContexto(amb);
  const parar = new AbortController();
  const encerrar = () => parar.abort();
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
  try {
    if (umaVez) {
      // passada única: lê, envia, trata pedidos; repete a fila até esvaziar ou 5 voltas
      for (const e of ORDEM_CARGA) if (amb.config.entidades[e]?.ativa) await sincronizarEntidade(ctx, e);
      for (let i = 0; i < 5; i++) await processarFila(ctx);
      await cicloPedidos(ctx);
      io.saida(formatarStatus(montarStatus(ctx.store, amb.config)));
    } else {
      await new Executor(ctx).rodar(parar.signal);
    }
    return 0;
  } finally {
    process.off('SIGINT', encerrar);
    process.off('SIGTERM', encerrar);
    await fecharContexto(ctx);
    liberar();
  }
}

async function segredo(args: string[], caminhoConfig: string, io: ES): Promise<number> {
  const [acao, nome] = args;
  if (acao !== 'definir' || !nome || !(NOMES_SEGREDO as readonly string[]).includes(nome)) {
    io.erro(`Uso: conector segredo definir <${NOMES_SEGREDO.join('|')}>  (o valor é lido da entrada padrão: echo valor | conector segredo definir ${NOMES_SEGREDO[0]})`);
    return 2;
  }
  const valor = (await io.lerEntrada()).replace(/\r?\n$/, '');
  if (!valor) {
    io.erro('Valor vazio: nada foi gravado.');
    return 2;
  }
  let modo: 'auto' | 'env' | 'windows' = 'windows';
  try {
    modo = carregarConfig(resolve(caminhoConfig)).segredos.provedor === 'env' ? 'env' : 'windows';
  } catch {
    // sem config válida ainda: segue com o Gerenciador de Credenciais
  }
  if (modo === 'env') {
    io.erro('O provedor configurado é "env": defina a variável de ambiente do sistema (MACUXI_CONECTOR_...). Nada foi gravado.');
    return 2;
  }
  const prov = criarProvedor('windows');
  await (prov.definir as NonNullable<typeof prov.definir>)(nome as NomeSegredo, valor);
  io.saida(`Segredo "${nome}" gravado no Gerenciador de Credenciais do Windows.`);
  return 0;
}

async function testarConexao(caminhoConfig: string, io: ES): Promise<number> {
  const amb = prepararAmbiente(caminhoConfig, { env: io.env });
  let falhas = 0;
  const ok = (m: string) => io.saida(`[ok]    ${m}`);
  const falha = (m: string) => {
    falhas++;
    io.erro(`[ERRO]  ${m}`);
  };
  ok(`Configuração válida (${Object.keys(amb.config.entidades).length} entidade(s)).`);

  for (const nome of NOMES_SEGREDO) {
    const v = await amb.segredos.obter(nome).catch(() => undefined);
    if (v) ok(`Segredo ${nome} encontrado.`);
    else falha(`Segredo ${nome} não encontrado (variável MACUXI_CONECTOR_${nome.toUpperCase()} ou Gerenciador de Credenciais).`);
  }

  const senha = await amb.segredos.obter('erp_senha').catch(() => undefined);
  if (senha) {
    const { abrirConexaoErp } = await import('./erp/fabrica');
    const erp = await abrirConexaoErp(amb.config.erp, senha);
    try {
      const v = await erp.testar();
      ok(`Banco do ERP (${amb.config.erp.tipo}) respondeu: ${mascararTexto(v.versao).slice(0, 80)}`);
      for (const nome of ORDEM_CARGA) {
        const cfg = amb.config.entidades[nome];
        if (!cfg) continue;
        try {
          const linhas = await erp.consultar(cfg.consulta, { cursor_alterado_em: new Date(0), cursor_alterado_em_ms: 0, cursor_external_id: '', limite: 5 });
          const m = mapearEValidar(nome, cfg, linhas);
          const resumo = `${nome}: consulta ok, ${linhas.length} linha(s) de amostra, ${m.descartadas} sem chave/data, ${m.invalidas} fora do contrato`;
          if (linhas.length > 0 && m.registros.length === 0 && m.ultimo === null) falha(`${resumo}. Confira os nomes das colunas em "campos".`);
          else if (m.invalidas > 0 || m.descartadas > 0) {
            ok(`${resumo}.`);
            const campos = [...new Set(m.problemas.map((p) => `${p.campo} (${p.mensagem})`))].slice(0, 5);
            io.saida(`        atenção: ${campos.join('; ')}`);
          } else ok(`${resumo}.`);
        } catch (e) {
          falha(`${nome}: a consulta falhou: ${mascararTexto(resumoErro(e))}`);
        }
      }
    } catch (e) {
      falha(`Banco do ERP: ${mascararTexto(resumoErro(e))}`);
    } finally {
      await erp.fechar();
    }
  }

  const token = await amb.segredos.obter('hub_token').catch(() => undefined);
  if (token) {
    const { ClienteHub } = await import('./hub/cliente');
    const hub = new ClienteHub({ url: amb.config.hub.url, token: async () => token, timeoutMs: amb.config.hub.timeoutSegundos * 1000, retry: { tentativas: 2 } });
    const primeira = ORDEM_CARGA.find((e) => amb.config.entidades[e]);
    try {
      await hub.consultarCursor(primeira ?? 'cliente');
      ok(`Hub ${new URL(amb.config.hub.url).host} respondeu e aceitou a credencial.`);
    } catch (e) {
      falha(`Hub: ${mascararTexto(resumoErro(e))}`);
    }
  }
  io.saida(falhas === 0 ? '\nTudo certo.' : `\n${falhas} problema(s) encontrado(s).`);
  return falhas === 0 ? 0 : 1;
}
