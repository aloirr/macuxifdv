/**
 * Agendador das tarefas periódicas dos módulos (ADR 0022; `ModuloApi.tarefas`), no MESMO processo do despachante (worker).
 *
 * - Acorda a cada `INTERVALO_MINIMO_TAREFA_MIN` (15 min; RN-CORE-23: nenhum timer abaixo disso). No 1º ciclo (subida) toda
 *   tarefa é devida; depois, cada uma volta quando passou o seu `cadaMin` (múltiplo de 15) desde a última rodada.
 * - Tenants: `tenantsAtivos()` (no worker, `plataforma.tenants_ativos()` pelo papel `macuxi_worker`: só ids de tenant ativo).
 *   Para cada tenant, licenças/parâmetros/fuso lidos UMA vez por ciclo (como o despachante); só roda a tarefa de módulo
 *   efetivo no tenant (RN-CORE-02/03).
 * - Cada (tarefa, tenant) roda na sua transação `comTenant` (macuxi_app, RLS) com uma trava consultiva da transação
 *   (`pg_try_advisory_xact_lock`): outro processo com a mesma tarefa no mesmo tenant pula. Falha desfaz só aquele tenant,
 *   é logada e volta no período seguinte (a tarefa é idempotente).
 * - Log: tenant_id, modulo, tarefa, request_id, duração e as CONTAGENS que a tarefa devolve; nunca dado pessoal.
 */
import { randomUUID } from 'node:crypto';
import {
  fusoDoTenantOuPadrao,
  INTERVALO_MINIMO_TAREFA_MIN,
  modulosEfetivos,
  USUARIO_SISTEMA_ID,
  type AcessoBanco,
  type LogRota,
  type ModuloApi,
  type ModuloId,
  type ResultadoTarefa,
  type TarefaPeriodica,
} from '@macuxi/platform-sdk';
import { licencasDoTenantNoBanco, type LicencasTenant } from './licencas';
import { mensagemSegura } from './log-seguro';
import { registroDeConsultas, transacaoTenant } from './outbox';

export interface OpcoesAgendador {
  /** Banco com o papel `macuxi_app` (`criarBancoApp`): licenças e tarefas, sempre em `comTenant`. */
  app: AcessoBanco;
  modulos: readonly ModuloApi[];
  /** Ids dos tenants ativos (no worker: `plataforma.tenants_ativos()` com o `macuxi_worker`). */
  tenantsAtivos: () => Promise<readonly string[]>;
  licencasNoTenant?: (tenantId: string) => Promise<LicencasTenant>;
  agora?: () => Date;
  log?: LogRota;
}

export interface ResumoAgendador {
  /** Tarefas devidas neste ciclo. */
  devidas: number;
  /** Execuções (tarefa × tenant) concluídas. */
  execucoes: number;
  /** Execuções puladas porque outro processo já rodava a mesma tarefa no tenant. */
  ocupadas: number;
  falhas: number;
}

const INTERVALO_MS = INTERVALO_MINIMO_TAREFA_MIN * 60_000;
/** Folga do relógio: o timer pode acordar um pouco antes; 30 s não faz uma tarefa de 15 min pular um ciclo. */
const FOLGA_MS = 30_000;
const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };
const SQL_TRAVA = 'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as ok';

interface Agendada {
  modulo: ModuloId;
  tarefa: TarefaPeriodica;
  chave: string;
}

/** Só as contagens numéricas finitas (o resto não vai ao log). */
function contagens(r: ResultadoTarefa): Record<string, number> {
  const saida: Record<string, number> = {};
  if (!r || typeof r !== 'object') return saida;
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && Number.isFinite(v)) saida[k] = v;
  return saida;
}

export function criarAgendador(op: OpcoesAgendador) {
  const relogio = op.agora ?? (() => new Date());
  const log = op.log ?? semLog;
  const manifestos = op.modulos.map((m) => m.manifesto);
  const instalados = manifestos.map((m) => m.id);
  const consultas = registroDeConsultas(op.modulos);
  const fonteLicencas = op.licencasNoTenant ?? ((tenantId: string) => licencasDoTenantNoBanco(tenantId, op.app));
  const agendadas: Agendada[] = op.modulos.flatMap((m) =>
    (m.tarefas ?? []).map((tarefa) => ({ modulo: m.manifesto.id, tarefa, chave: `${m.manifesto.id}.${tarefa.nome}` })),
  );
  /** chave → instante (ms) a partir do qual a tarefa volta a ser devida. */
  const proxima = new Map<string, number>();

  async function rodar(a: Agendada, tenantId: string, l: LicencasTenant, efetivos: ModuloId[]): Promise<'ok' | 'ocupada'> {
    const requestId = randomUUID();
    const campos = { tenant_id: tenantId, modulo: a.modulo, tarefa: a.tarefa.nome, request_id: requestId };
    const logTarefa: LogRota = {
      info: (o, msg) => log.info({ ...campos, ...o }, msg),
      warn: (o, msg) => log.warn({ ...campos, ...o }, msg),
      error: (o, msg) => log.error({ ...campos, ...o }, msg),
    };
    const fuso = fusoDoTenantOuPadrao(l.fuso);
    const parametros = (m: ModuloId) => l.parametros[m] ?? {};
    const inicio = Date.now();
    const r = await op.app.comTenant(tenantId, async (db) => {
      const trava = await db.query<{ ok: boolean }>(SQL_TRAVA, [`tarefa:${a.chave}:${tenantId}`]);
      if (!trava.rows[0]?.ok) return { ocupada: true as const };
      const tx = transacaoTenant(db, {
        manifestos,
        modulo: a.modulo,
        tenantId,
        usuarioId: null,
        requestId,
        agora: relogio,
        // ADR 0012: não há pessoa; a consulta recebe o usuário de sistema com os efetivos do tenant
        usuario: { id: USUARIO_SISTEMA_ID, tenant_id: tenantId, perfil: 'admin', modulos: efetivos },
        consultas,
        parametros,
        fuso: () => fuso,
        log: logTarefa,
      });
      const resultado = await a.tarefa.executar({
        tenantId,
        db,
        publicar: tx.publicar,
        consultar: tx.consultar,
        parametros: () => parametros(a.modulo),
        fuso: () => fuso,
        agora: relogio,
        log: logTarefa,
      });
      return { ocupada: false as const, resultado };
    });
    if (r.ocupada) return 'ocupada';
    const n = contagens(r.resultado);
    if (Object.values(n).some((v) => v > 0)) logTarefa.info({ ...n, duracao_ms: Date.now() - inicio }, 'tarefa periódica executada');
    return 'ok';
  }

  /** Um ciclo: roda as tarefas devidas em todos os tenants ativos. Falha de um tenant não para os outros. */
  async function ciclo(): Promise<ResumoAgendador> {
    const resumo: ResumoAgendador = { devidas: 0, execucoes: 0, ocupadas: 0, falhas: 0 };
    const agoraMs = relogio().getTime();
    const devidas = agendadas.filter((a) => (proxima.get(a.chave) ?? 0) <= agoraMs + FOLGA_MS);
    resumo.devidas = devidas.length;
    if (devidas.length === 0) return resumo;
    // marca antes de rodar: falha (ou banco fora) só tenta de novo no próximo período, sem martelar
    for (const a of devidas) proxima.set(a.chave, agoraMs + a.tarefa.cadaMin * 60_000);
    const tenants = await op.tenantsAtivos();
    for (const tenantId of tenants) {
      let l: LicencasTenant;
      let efetivos: ModuloId[];
      try {
        l = await fonteLicencas(tenantId);
        efetivos = modulosEfetivos({ manifestos, ativosNoTenant: l.ativosNoTenant, doPerfil: instalados });
      } catch (e) {
        resumo.falhas += 1;
        log.warn({ tenant_id: tenantId, erro: mensagemSegura(e) }, 'agendador: licenças do tenant falharam');
        continue;
      }
      for (const a of devidas) {
        if (!efetivos.includes(a.modulo)) continue;
        try {
          const r = await rodar(a, tenantId, l, efetivos);
          if (r === 'ocupada') resumo.ocupadas += 1;
          else resumo.execucoes += 1;
        } catch (e) {
          resumo.falhas += 1;
          log.warn({ tenant_id: tenantId, modulo: a.modulo, tarefa: a.tarefa.nome, erro: mensagemSegura(e) }, 'tarefa periódica falhou');
        }
      }
    }
    return resumo;
  }

  return {
    /** `modulo.nome` das tarefas instaladas. */
    tarefas: (): readonly string[] => agendadas.map((a) => a.chave),
    ciclo,
    /**
     * Laço do processo: ciclo na subida e depois a cada 15 min (fixo; RN-CORE-23). Sem tarefa instalada, não liga timer.
     * Erro do ciclo (banco fora) é logado e o laço continua.
     */
    iniciar(): { parar(): Promise<void> } {
      let ativo = agendadas.length > 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let atual: Promise<void> = Promise.resolve();
      const passo = async (): Promise<void> => {
        try {
          await ciclo();
        } catch (e) {
          log.error({ erro: mensagemSegura(e) }, 'ciclo do agendador falhou');
        }
        if (ativo) {
          timer = setTimeout(() => (atual = passo()), INTERVALO_MS);
          // Sob a lib DOM (tests/tsconfig) o retorno é number; em Node é Timeout com unref (não segura o processo).
          (timer as unknown as { unref?: () => void }).unref?.();
        }
      };
      if (ativo) atual = passo();
      return {
        async parar() {
          ativo = false;
          if (timer) clearTimeout(timer);
          await atual;
        },
      };
    },
  };
}

export type Agendador = ReturnType<typeof criarAgendador>;
