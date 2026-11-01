/**
 * Despachante da outbox (ADR 0007, seção "Implementação (T-0022)"; migração 0003; RN-CORE-05).
 *
 * Lê `plataforma.evento` de TODOS os tenants com o papel `macuxi_worker` (sem BYPASSRLS: política própria só nesta
 * tabela, só as colunas do envelope) e entrega cada evento aos consumidores declarados nos módulos
 * (`ModuloApi.consumidores`, que só aceitam eventos de `consome` do manifesto):
 *   1. lote em ordem `(ocorrido_em, id)` com `for no key update skip locked` (vários processos não pegam o mesmo evento;
 *      "no key" porque o `insert` em `evento_consumo` do handler checa a FK com `for key share` na mesma linha: com
 *      `for update` o handler esperaria o lote e o lote o handler);
 *      só eventos com algum consumidor instalado — os outros ficam pendentes e um consumidor que chegar depois recebe o
 *      histórico (a outbox acumula e nada é perdido);
 *   2. consumidor sem o módulo ativo no tenant (licença, RN-CORE-02/03) não recebe;
 *   3. o handler roda com `macuxi_app` em `comTenant(tenant do envelope)` e, na MESMA transação, grava
 *      `plataforma.evento_consumo (consumidor, evento_id)` com `on conflict do nothing`: reentrega não repete o efeito,
 *      e um handler que falha desfaz o efeito e o registro juntos;
 *   4. todos os consumidores ok → `publicado_em`; alguma falha → `tentativas + 1`, `ultimo_erro` e espera crescente
 *      (`esperaPadrao`) antes da próxima tentativa; os que já tinham consumido não repetem (passo 3). O evento em espera
 *      sai do lote e os outros (de qualquer tenant) seguem. Com `tentativas >= maxTentativas` o evento para (fica
 *      pendente para análise; para reprocessar, zere `tentativas` como administrador).
 * A ordem entre eventos não é garantida quando há retentativa: o consumidor usa `envelope.ocorrido_em`.
 * A espera fica na memória do processo (reiniciar tenta logo de novo uma vez; vários processos não compartilham a espera).
 * Logs: tenant_id, modulo, evento, evento_id, request_id, tentativas; nunca o payload (dado pessoal fica no banco).
 */
import { PAPEL_WORKER } from '@macuxi/db';
import {
  ehModulo,
  modulosEfetivos,
  type AcessoBanco,
  type ConsumidorEvento,
  type EnvelopeEvento,
  type LogRota,
  type ModuloApi,
  type ModuloId,
} from '@macuxi/platform-sdk';
import type pg from 'pg';
import { ErroPapelBanco } from './banco';
import { publicadorTenant } from './outbox';

export interface OpcoesDespachante {
  /** Pool com o papel `macuxi_worker` (lê e marca a outbox de todos os tenants; não enxerga mais nada). */
  worker: Pick<pg.Pool, 'connect'>;
  /** Banco com o papel `macuxi_app` (`criarBancoApp`): licenças e handlers, sempre em `comTenant`. */
  app: AcessoBanco;
  /** Módulos instalados (padrão do processo: `MODULOS_API`). */
  modulos: readonly ModuloApi[];
  /** Módulos ativos no tenant (padrão: `plataforma.tenant_modulo`); as dependências (RN-CORE-03) são aplicadas aqui. */
  ativosNoTenant?: (tenantId: string) => Promise<readonly ModuloId[]>;
  agora?: () => Date;
  /** Eventos por ciclo (padrão 20). Os handlers rodam em sequência enquanto o lote fica travado. */
  lote?: number;
  /** Tentativas até o evento parar (padrão 10). */
  maxTentativas?: number;
  /** Espera (ms) depois da n-ésima tentativa com falha (padrão `esperaPadrao`). */
  espera?: (tentativas: number) => number;
  log?: LogRota;
}

export interface ResumoCiclo {
  /** Eventos lidos no lote. */
  lidos: number;
  /** Marcados com `publicado_em` (todos os consumidores ativos ok). */
  publicados: number;
  /** Com alguma falha (voltam depois da espera). */
  comFalha: number;
  /** Handlers executados com sucesso (sem contar os já consumidos e os sem licença). */
  entregas: number;
}

export const LOTE_PADRAO = 20;
export const MAX_TENTATIVAS_PADRAO = 10;
const ESPERA_BASE_MS = 5_000;
const ESPERA_TETO_MS = 15 * 60_000;
const MAX_ERRO = 500;

/** 5 s, 10 s, 20 s… dobrando até 15 min (10 tentativas ≈ 50 min). */
export function esperaPadrao(tentativas: number): number {
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(0, tentativas - 1), ESPERA_TETO_MS);
}

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface LinhaEvento {
  id: string;
  tenant_id: string;
  nome: string;
  modulo: string;
  payload: unknown;
  ocorrido_em: Date;
  tentativas: number;
  usuario_id: string | null;
  request_id: string | null;
}

// Só as colunas com grant para o worker (migração 0003). `deleted_at` não é lida: evento não se apaga.
const SQL_LOTE = `
  select id, tenant_id, nome, modulo, payload, ocorrido_em, tentativas, usuario_id, request_id
    from plataforma.evento
   where publicado_em is null
     and nome = any($1::text[])
     and tentativas < $2
     and id <> all($3::uuid[])
   order by ocorrido_em, id
   limit $4
   for no key update skip locked`;

interface Assinatura {
  modulo: ModuloId;
  consumidor: ConsumidorEvento;
}

const mensagemDe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, MAX_ERRO);

/** Falha fechada na subida: a conexão do despachante tem de ser o `macuxi_worker`, sem SUPERUSER nem BYPASSRLS. */
export async function verificarPapelWorker(pool: Pick<pg.Pool, 'query'>): Promise<void> {
  const r = await pool.query<{ usuario: string; superusuario: boolean; ignora_rls: boolean }>(
    'select current_user as usuario, r.rolsuper as superusuario, r.rolbypassrls as ignora_rls from pg_roles r where r.rolname = current_user',
  );
  const papel = r.rows[0];
  if (!papel) throw new ErroPapelBanco('Não foi possível ler o papel da conexão do despachante.');
  if (papel.usuario !== PAPEL_WORKER) throw new ErroPapelBanco(`O despachante só lê a outbox como ${PAPEL_WORKER} (conectou como ${papel.usuario}).`);
  if (papel.superusuario || papel.ignora_rls) throw new ErroPapelBanco(`${PAPEL_WORKER} não pode ser superusuário nem ter BYPASSRLS.`);
}

export function criarDespachante(op: OpcoesDespachante) {
  const relogio = op.agora ?? (() => new Date());
  const lote = op.lote ?? LOTE_PADRAO;
  const maxTentativas = op.maxTentativas ?? MAX_TENTATIVAS_PADRAO;
  const espera = op.espera ?? esperaPadrao;
  const log = op.log ?? semLog;
  const manifestos = op.modulos.map((m) => m.manifesto);
  const instalados = manifestos.map((m) => m.id);

  const porEvento = new Map<string, Assinatura[]>();
  for (const m of op.modulos) {
    for (const c of m.consumidores ?? []) {
      const lista = porEvento.get(c.evento.nome) ?? [];
      lista.push({ modulo: m.manifesto.id, consumidor: c });
      porEvento.set(c.evento.nome, lista);
    }
  }
  const nomes = [...porEvento.keys()];

  const ativosDoBanco = (tenantId: string) =>
    op.app.comTenant(tenantId, async (db) =>
      (await db.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null')).rows
        .map((l) => l.modulo)
        .filter(ehModulo),
    );
  const fonteAtivos = op.ativosNoTenant ?? ativosDoBanco;

  /** evento_id → instante (ms) antes do qual não tenta de novo. */
  const emEspera = new Map<string, number>();

  async function efetivosNoTenant(tenantId: string): Promise<ReadonlySet<ModuloId>> {
    const ativos = await fonteAtivos(tenantId);
    // licença no nível do tenant: ativos ∩ instalados, menos quem perdeu dependência (RN-CORE-03); core sempre ativo
    return new Set(modulosEfetivos({ manifestos, ativosNoTenant: ativos, doPerfil: instalados }));
  }

  /** Entrega a todos os consumidores ativos; devolve as falhas e quantos handlers rodaram agora. */
  async function entregar(env: EnvelopeEvento, efetivos: ReadonlySet<ModuloId>): Promise<{ falhas: string[]; entregas: number }> {
    const falhas: string[] = [];
    let entregas = 0;
    for (const a of porEvento.get(env.nome) ?? []) {
      if (!efetivos.has(a.modulo)) continue;
      const campos = { tenant_id: env.tenant_id, modulo: a.modulo, evento: env.nome, evento_id: env.evento_id, request_id: env.request_id };
      const logConsumidor: LogRota = {
        info: (o, msg) => log.info({ ...campos, ...o }, msg),
        warn: (o, msg) => log.warn({ ...campos, ...o }, msg),
        error: (o, msg) => log.error({ ...campos, ...o }, msg),
      };
      try {
        const rodou = await op.app.comTenant(env.tenant_id, async (db) => {
          // idempotência (consumidor, evento_id) na mesma transação do efeito; a 2ª entrega espera a 1ª e não faz nada
          const r = await db.query(
            `insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, $2, $3)
             on conflict (tenant_id, consumidor, evento_id) do nothing`,
            [env.tenant_id, a.modulo, env.evento_id],
          );
          if (!r.rowCount) return false;
          const payload: unknown = a.consumidor.evento.schema.parse(env.payload);
          await a.consumidor.executar(payload, {
            envelope: { ...env, payload },
            db,
            publicar: publicadorTenant(db, {
              manifestos,
              modulo: a.modulo,
              tenantId: env.tenant_id,
              usuarioId: env.usuario_id,
              requestId: env.request_id,
              agora: relogio,
            }),
            agora: relogio,
            log: logConsumidor,
          });
          return true;
        });
        if (rodou) entregas += 1;
      } catch (e) {
        falhas.push(`${a.modulo}: ${mensagemDe(e)}`);
        logConsumidor.warn({ erro: mensagemDe(e) }, 'consumidor falhou');
      }
    }
    return { falhas, entregas };
  }

  /** Um ciclo: lê um lote, entrega e marca. Erro de banco do worker sobe (o lote desfaz e volta no próximo ciclo). */
  async function ciclo(): Promise<ResumoCiclo> {
    const resumo: ResumoCiclo = { lidos: 0, publicados: 0, comFalha: 0, entregas: 0 };
    if (nomes.length === 0) return resumo;
    const agoraMs = relogio().getTime();
    for (const [id, ate] of emEspera) if (ate <= agoraMs) emEspera.delete(id);

    const c = await op.worker.connect();
    try {
      await c.query('begin');
      const linhas = (await c.query<LinhaEvento>(SQL_LOTE, [nomes, maxTentativas, [...emEspera.keys()], lote])).rows;
      resumo.lidos = linhas.length;
      const efetivosPorTenant = new Map<string, ReadonlySet<ModuloId>>();
      for (const l of linhas) {
        const env: EnvelopeEvento = {
          evento_id: l.id,
          nome: l.nome,
          origem: l.modulo as ModuloId,
          tenant_id: l.tenant_id,
          usuario_id: l.usuario_id,
          request_id: l.request_id,
          ocorrido_em: l.ocorrido_em.toISOString(),
          payload: l.payload,
        };
        let falhas: string[];
        try {
          let efetivos = efetivosPorTenant.get(l.tenant_id);
          if (!efetivos) {
            efetivos = await efetivosNoTenant(l.tenant_id);
            efetivosPorTenant.set(l.tenant_id, efetivos);
          }
          const r = await entregar(env, efetivos);
          falhas = r.falhas;
          resumo.entregas += r.entregas;
        } catch (e) {
          falhas = [`licencas: ${mensagemDe(e)}`];
        }
        if (falhas.length === 0) {
          await c.query('update plataforma.evento set publicado_em = now(), tentativas = tentativas + 1, ultimo_erro = null where id = $1', [l.id]);
          resumo.publicados += 1;
          continue;
        }
        const t = (
          await c.query<{ tentativas: number }>(
            'update plataforma.evento set tentativas = tentativas + 1, ultimo_erro = $2 where id = $1 returning tentativas',
            [l.id, falhas.join(' | ').slice(0, MAX_ERRO)],
          )
        ).rows[0]!.tentativas;
        resumo.comFalha += 1;
        const campos = { tenant_id: l.tenant_id, evento: l.nome, evento_id: l.id, request_id: l.request_id, tentativas: t };
        if (t >= maxTentativas) {
          log.error(campos, 'evento parado: tentativas esgotadas (zere tentativas para reprocessar)');
        } else {
          emEspera.set(l.id, agoraMs + espera(t));
          log.warn({ ...campos, espera_ms: espera(t) }, 'evento volta depois da espera');
        }
      }
      await c.query('commit');
      return resumo;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    /** Eventos que têm consumidor instalado (os outros ficam na outbox). */
    eventos: (): readonly string[] => nomes,
    ciclo,
    /** Ids em espera (testes e diagnóstico). */
    emEspera: (): ReadonlyMap<string, number> => emEspera,
    /**
     * Laço do processo: ciclo; lote cheio → próximo ciclo já; senão espera `intervaloMs` (padrão 1 s).
     * Erro do ciclo (banco fora) é logado e o laço continua.
     */
    iniciar(o: { intervaloMs?: number } = {}): { parar(): Promise<void> } {
      const intervalo = o.intervaloMs ?? 1_000;
      let ativo = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let atual: Promise<void> = Promise.resolve();
      const passo = async (): Promise<void> => {
        let cheio = false;
        try {
          cheio = (await ciclo()).lidos >= lote;
        } catch (e) {
          log.error({ erro: mensagemDe(e) }, 'ciclo do despachante falhou');
        }
        if (ativo) timer = setTimeout(() => (atual = passo()), cheio ? 0 : intervalo);
      };
      atual = passo();
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

export type Despachante = ReturnType<typeof criarDespachante>;
