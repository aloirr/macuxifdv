/**
 * Laço de execução do serviço (`conector rodar`): agenda a leitura de cada entidade pela periodicidade configurada,
 * esvazia a fila, trata pedidos, manda o sinal de vida (1 min), a reconciliação diária e a manutenção.
 * O relógio e a espera são injetáveis; `ciclo()` é uma passada (testável), `rodar()` repete até o sinal de parada.
 */
import { ORDEM_CARGA, type Entidade } from './config/entidades';
import { periodicidadeDe } from './config/esquema';
import { type Contexto, resumoErro } from './contexto';
import { cicloAtualizacao } from './atualizacao/ciclo';
import { cicloPedidos } from './pedidos';
import { processarFila } from './remetente';
import { reconciliacaoVencida, reconciliarTudo } from './reconciliacao';
import { sincronizarEntidade } from './sincronizador';
import { atualizacaoParaSinal } from './atualizacao/sinal';
import { montarStatus } from './status';
import { dormir } from './util/retry';
import { avaliarVersaoLocal, guardarPolitica, tratarRecusaPorVersao } from './politica';
import { VERSAO_CONECTOR } from './versao';
import { type SinalConector, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';

interface Tarefa {
  nome: string;
  intervaloMs: number;
  proxima: number;
  executar(): Promise<number | void>;
}

export class Executor {
  private readonly tarefas: Tarefa[] = [];

  constructor(private readonly ctx: Contexto, private readonly opcoes: { tickMs?: number; dormir?: (ms: number) => Promise<void> } = {}) {
    const { config } = ctx;
    const agora = ctx.relogio.agora();
    // o sinal vai PRIMEIRO: a resposta traz a política de versão, que precisa valer antes de qualquer envio da partida
    this.tarefas.push({ nome: 'sinal', intervaloMs: config.sinalSegundos * 1000, proxima: agora, executar: () => this.sinal() });
    for (const e of ORDEM_CARGA) {
      if (!config.entidades[e]?.ativa) continue;
      this.tarefas.push({
        nome: `entidade:${e}`,
        intervaloMs: periodicidadeDe(config, e) * 1000,
        proxima: agora,
        executar: async () => {
          const r = await sincronizarEntidade(ctx, e as Entidade);
          // fila cheia/limite de páginas/Hub fora na partida: volta logo, sem esperar a periodicidade inteira
          if (r.maisParaLer) return 3_000;
          if (r.adiado?.startsWith('Hub indisponível')) return 30_000;
          return undefined;
        },
      });
    }
    this.tarefas.push({ nome: 'fila', intervaloMs: Math.max(1, Math.min(config.fila.consultaResultadoSegundos, 5)) * 1000, proxima: agora, executar: async () => void (await processarFila(ctx)) });
    if (config.pedidos?.ativo) {
      this.tarefas.push({ nome: 'pedidos', intervaloMs: config.pedidos.consultaSegundos * 1000, proxima: agora, executar: async () => void (await cicloPedidos(ctx, { buscar: true, status: false })) });
      this.tarefas.push({ nome: 'pedidos_status', intervaloMs: config.pedidos.statusSegundos * 1000, proxima: agora, executar: async () => void (await cicloPedidos(ctx, { buscar: false, status: true })) });
    }
    this.tarefas.push({
      nome: 'reconciliacao', intervaloMs: 5 * 60_000, proxima: agora,
      executar: async () => {
        if (reconciliacaoVencida(ctx)) await reconciliarTudo(ctx);
      },
    });
    // T-0116: só entra na agenda se ligada na configuração (padrão desligada); primeira passada depois do primeiro sinal (política do Hub)
    if (config.atualizacao?.ativa) {
      this.tarefas.push({ nome: 'atualizacao', intervaloMs: config.atualizacao.verificarMinutos * 60_000, proxima: agora + 60_000, executar: async () => void (await cicloAtualizacao(ctx)) });
    }
    this.tarefas.push({ nome: 'manutencao', intervaloMs: 3_600_000, proxima: agora, executar: async () => ctx.store.limpar(ctx.relogio.agora(), config.fila.retencaoDias) });
  }

  private ultimaSituacaoVersao: string | null = null;
  private ultimoAvisoVersaoMs = 0;

  private get versao(): string {
    return this.ctx.versao ?? VERSAO_CONECTOR;
  }

  /** Registra no log a situação da versão: na primeira vez, quando muda e, enquanto parado/desatualizado, a cada hora. */
  private registrarVersao(): void {
    const a = avaliarVersaoLocal(this.ctx.store, this.versao);
    const agora = this.ctx.relogio.agora();
    const mudou = a.situacao !== this.ultimaSituacaoVersao;
    const lembrar = a.situacao !== 'ok' && a.situacao !== 'sem_politica' && agora - this.ultimoAvisoVersaoMs >= 3_600_000;
    if (!mudou && !lembrar) return;
    this.ultimaSituacaoVersao = a.situacao;
    this.ultimoAvisoVersaoMs = agora;
    if (a.deveParar) this.ctx.log.erro('versao_abaixo_da_minima', { versao: this.versao, situacao: a.situacao, motivo: a.mensagem });
    else if (a.situacao === 'desatualizado') this.ctx.log.aviso('versao_desatualizada', { versao: this.versao, situacao: a.situacao, motivo: a.mensagem });
    else if (mudou) this.ctx.log.info('versao_verificada', { versao: this.versao, situacao: a.situacao });
  }

  private async sinal(): Promise<void> {
    const s = montarStatus(this.ctx.store, this.ctx.config, this.versao);
    const parado = s.versao.deveParar;
    const atualizacao = atualizacaoParaSinal(s.atualizacao);
    // regra 3 (T-0048): o corpo é o tipo do contrato (`SinalConector`), não um objeto montado à mão
    const corpo: SinalConector = {
      conector_id: this.ctx.config.hub.conectorId,
      versao_conector: this.versao,
      versao_contrato: VERSAO_CONTRATO,
      em: new Date(this.ctx.relogio.agora()).toISOString(),
      fila: s.fila.map((f) => ({ estado: f.estado, lotes: f.lotes, linhas: f.linhas, maisAntigo: f.maisAntigo })),
      entidades: s.entidades.map((e) => ({ entidade: e.entidade, fase: e.fase, ultimo_sucesso: e.ultimoSucesso, bloqueada: e.bloqueio !== null, lotes_na_fila: e.lotesNaFila })),
      ...(parado ? { parado_por_versao: true } : {}),
      // T-0100: o monitor do BKO mostra o último resultado da atualização automática; sem resultado, o campo nem vai
      ...(atualizacao ? { atualizacao } : {}),
    };
    const resposta = await this.enviarSinal(corpo);
    // a política do Hub vale a partir daqui (inclusive para liberar o envio quando o Hub baixa a mínima)
    if (resposta?.politica_versao) guardarPolitica(this.ctx.store, resposta.politica_versao, this.ctx.relogio.agora());
    this.registrarVersao();
  }

  /** O sinal é liberado abaixo da mínima; se um Hub fora do contrato responder 426 mesmo assim, vale como pausa (T-0027). */
  private async enviarSinal(corpo: SinalConector) {
    try {
      return await this.ctx.hub.enviarSinal(corpo);
    } catch (e) {
      if (tratarRecusaPorVersao(this.ctx, e, 'sinal')) return null;
      throw e;
    }
  }

  /** Uma passada: roda o que está vencido. Erro de uma tarefa nunca derruba as outras. */
  async ciclo(): Promise<string[]> {
    const executadas: string[] = [];
    for (const t of this.tarefas) {
      if (t.proxima > this.ctx.relogio.agora()) continue;
      executadas.push(t.nome);
      let volta: number | void = undefined;
      try {
        volta = await t.executar();
      } catch (e) {
        this.ctx.log.aviso('tarefa_falhou', { tarefa: t.nome, erro: resumoErro(e) });
      }
      t.proxima = this.ctx.relogio.agora() + (typeof volta === 'number' ? volta : t.intervaloMs);
    }
    return executadas;
  }

  async rodar(parar: AbortSignal): Promise<void> {
    const espera = this.opcoes.dormir ?? dormir;
    this.registrarVersao();
    this.ctx.log.info('conector_iniciado', { versao: this.versao, entidades: this.tarefas.filter((t) => t.nome.startsWith('entidade:')).map((t) => t.nome.slice(9)) });
    while (!parar.aborted) {
      await this.ciclo();
      await espera(this.opcoes.tickMs ?? 1000);
    }
    this.ctx.log.info('conector_parado');
  }
}
