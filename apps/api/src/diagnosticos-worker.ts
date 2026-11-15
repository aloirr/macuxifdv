/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3): o lado do WORKER do diagnóstico do aparelho, no processo do
 * despachante (`worker.ts`), com o papel `macuxi_worker` (0058: lê as colunas técnicas de todos os tenants, SEM `descricao`
 * nem `detalhe`; atualiza só as `alerta_*` das linhas pendente/agrupado; executa `plataforma.expurgar_diagnosticos`).
 *
 * Alerta (a cada 60 s): até 10 linhas `pendente`, cada uma na sua transação (`for update skip locked`):
 * - sem cliente do GitHub (`MACUXI_RECADOS_TOKEN_SERVIDOR` ausente) → todas as pendentes viram `desligado`, um único `warn`
 *   por processo e nenhuma tentativa;
 * - queda/erro de tela repetido (mesma `versao_app`, `motivo` e `aparelho_modelo` com recado enviado há menos de 6 h) →
 *   `agrupado` (o próximo resumo conta). O botão sempre gera recado, dentro do teto;
 * - teto de 12 recados por hora (contados pelos `alerta_recado_id` distintos da última hora) → `agrupado`;
 * - senão, UM commit no repositório de recados com `recados/alexandre/<id>.md` e `recados/engenheiro-apps/<id>.md`
 *   (remetente de sistema `diagnostico`) → `enviado`; falha → espera exponencial (1, 2, 4… até 60 min) e, na 8ª, `falhou`.
 * - Resumo: no máximo um por hora, com as linhas `agrupado` ainda sem recado ("mais N diagnósticos desde HH:MM").
 * O recado NUNCA leva o texto livre nem a pilha (o worker nem lê essas colunas): só protocolo, dados técnicos curtos, ids e
 * o link do portal. O repositório de recados é imutável e lá não há expurgo.
 *
 * Expurgo (LGPD, diário a partir das 07:00 UTC = 03:00 em Manaus): `plataforma.expurgar_diagnosticos` em lotes de 500
 * (linha + arquivo do print na mesma transação; prints `aguardando` há mais de 7 dias) e, depois do commit, os bytes pela
 * porta `ArmazenamentoArquivos`. Remoção que falha vira `warn` e volta no ciclo seguinte (lista em memória).
 *
 * Log: `tipo: diagnostico`, ids, protocolo, situação, tentativas e contagens; nunca texto do aparelho nem o token.
 */
import { formatarProtocolo, RETENCAO_DIAGNOSTICO_DIAS, rotuloDoMotivoDiagnostico, type LogRota } from '@macuxi/platform-sdk';
import type pg from 'pg';
import type { ArmazenamentoArquivos } from './arquivos';
import { iniciarLaco } from './laco';
import { mensagemSegura } from './log-seguro';
import type { ClienteRecadosGithub } from './recados-github';

export const REMETENTE_DIAGNOSTICO = 'diagnostico';
/** Caixas que recebem o recado automático (R-20261110-112315-alexandre). */
export const DESTINOS_RECADO_DIAGNOSTICO = ['alexandre', 'engenheiro-apps'] as const;
export const LOTE_ALERTA = 10;
export const TETO_RECADOS_POR_HORA = 12;
export const JANELA_QUEDA_REPETIDA_MS = 6 * 60 * 60_000;
export const MAX_TENTATIVAS_ALERTA = 8;
export const LOTE_EXPURGO = 500;
/** Hora UTC a partir da qual o expurgo do dia roda (03:00 em Manaus). */
export const HORA_EXPURGO_UTC = 7;
export const URL_PORTAL_PADRAO = 'https://config.macuxifdv.com.br';
const HORA_MS = 60 * 60_000;

/** 1, 2, 4… minutos, dobrando até 60 min. */
export function esperaAlerta(tentativas: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, tentativas - 1), HORA_MS);
}

// ---------- formato do recado (o mesmo front matter do coord, ADR 0039) ----------

/** Manaus não tem horário de verão desde 2008: UTC−4 fixo (o coord grava a hora local do PC, também −04:00). */
const OFFSET_MANAUS_MS = -4 * HORA_MS;
export function horaDeManaus(d: Date): { iso: string; compacto: string; curta: string } {
  const loc = new Date(d.getTime() + OFFSET_MANAUS_MS).toISOString().slice(0, 19);
  return { iso: `${loc}-04:00`, compacto: loc.replace(/[-:]/g, '').replace('T', '-'), curta: loc.replace('T', ' ').slice(0, 16) };
}

/** Id livre no formato do coord: `R-<aaaammdd-hhmmss>-diagnostico`, depois `R-...-2-diagnostico`, `-3-`... */
export function idDoRecadoDiagnostico(agora: Date, existentes: ReadonlySet<string>): string {
  const { compacto } = horaDeManaus(agora);
  let id = `R-${compacto}-${REMETENTE_DIAGNOSTICO}`;
  for (let n = 2; existentes.has(id); n++) id = `R-${compacto}-${n}-${REMETENTE_DIAGNOSTICO}`;
  return id;
}

/** Texto vindo do aparelho numa linha só (sem quebra nem controle: nada de cabeçalho forjado no recado) e curto. */
export function textoDeUmaLinha(v: string | null | undefined, max = 80): string {
  const t = String(v ?? '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.slice(0, max) : '—';
}

/** Colunas que o worker lê (0058: as técnicas; nunca `descricao` nem `detalhe`). */
export interface LinhaAlerta {
  id: string;
  tenant_id: string;
  protocolo: string | number;
  usuario_id: string;
  perfil: string;
  origem: 'botao' | 'queda' | 'erro_tela';
  app: 'campo' | 'gestao';
  versao_app: string;
  build: string | null;
  aparelho_fabricante: string | null;
  aparelho_modelo: string | null;
  android: string | null;
  tela: string | null;
  motivo: string | null;
  print_id: string | null;
  recebido_em: Date;
  alerta_tentativas: number;
}

const NOME_APP = { campo: 'Campo', gestao: 'Gestão' } as const;

function cabecalho(id: string, agora: Date, prioridade: 'alta' | 'normal'): string[] {
  return [
    '---',
    `id: ${id}`,
    `de: ${REMETENTE_DIAGNOSTICO}`,
    `para: [${DESTINOS_RECADO_DIAGNOSTICO.join(', ')}]`,
    'cc: []',
    'tipo: aviso',
    `prioridade: ${prioridade}`,
    'tarefa: T-0158',
    'responde_a: null',
    'encerra: false',
    'contrato: null',
    `criado_em: ${horaDeManaus(agora).iso}`,
    '---',
  ];
}

const urlBase = (u: string) => u.replace(/\/+$/, '');

/** O recado de UM diagnóstico. Só dado técnico curto e ids; o detalhe fica no portal. */
export function montarRecadoDiagnostico(l: LinhaAlerta, o: { id: string; agora: Date; urlPortal: string }): string {
  const protocolo = formatarProtocolo(Number(l.protocolo));
  const motivo = textoDeUmaLinha(l.motivo, 60);
  // RD-0124: no título, o mesmo texto que o app e o portal mostram (tabela única do SDK); o código fica no Contexto.
  const rotulo = textoDeUmaLinha(rotuloDoMotivoDiagnostico(l.motivo), 60);
  const origem = l.origem === 'botao' ? 'enviado pelo botão' : l.origem === 'queda' ? `queda (${rotulo})` : `erro de tela (${rotulo})`;
  const aparelho = textoDeUmaLinha([l.aparelho_fabricante, l.aparelho_modelo].filter(Boolean).join(' '), 120);
  const android = textoDeUmaLinha(l.android, 20);
  const versao = textoDeUmaLinha(l.versao_app, 20);
  const titulo = `Diagnóstico nº ${protocolo} — ${origem} · ${NOME_APP[l.app] ?? textoDeUmaLinha(l.app, 20)} ${versao} · ${aparelho} · Android ${android}`;
  return [
    ...cabecalho(o.id, o.agora, l.origem === 'queda' ? 'alta' : 'normal'),
    `# ${titulo}`,
    '',
    '## Contexto',
    `Protocolo ${protocolo}, recebido ${horaDeManaus(l.recebido_em).curta} (Manaus). Origem: ${l.origem}. Motivo: ${motivo}. Tela: ${textoDeUmaLinha(l.tela, 200)}.`,
    `Versão: ${versao} (build ${textoDeUmaLinha(l.build, 60)}). Empresa: ${l.tenant_id}. Usuário: ${l.usuario_id} (perfil ${textoDeUmaLinha(l.perfil, 20)}). Print: ${l.print_id ? 'anexado' : 'não'}.`,
    '',
    '## O que preciso / o que mudou',
    `Detalhe técnico (descrição, pilha, saída do Android) só no portal: ${urlBase(o.urlPortal)}/config/diagnosticos/${l.id}`,
    '',
    '## Pronto quando',
    'Informativo (gerado pelo servidor).',
    '',
  ].join('\n');
}

/** O resumo da hora: as linhas agrupadas (teto ou queda repetida) desde `desde`. */
export function montarRecadoResumo(o: { id: string; agora: Date; quantidade: number; desde: Date; urlPortal: string }): string {
  const desde = horaDeManaus(o.desde);
  const n = o.quantidade;
  return [
    ...cabecalho(o.id, o.agora, 'normal'),
    `# Diagnósticos: mais ${n} desde ${desde.curta.slice(11)} (Manaus)`,
    '',
    '## Contexto',
    `${n === 1 ? 'Mais 1 diagnóstico recebido' : `Mais ${n} diagnósticos recebidos`} desde ${desde.curta} (Manaus), sem recado próprio: teto de ${TETO_RECADOS_POR_HORA} recados por hora ou queda repetida (mesma versão, motivo e aparelho em menos de 6 h).`,
    '',
    '## O que preciso / o que mudou',
    `Lista no portal: ${urlBase(o.urlPortal)}/config/diagnosticos?de=${encodeURIComponent(o.desde.toISOString())}`,
    '',
    '## Pronto quando',
    'Informativo (gerado pelo servidor).',
    '',
  ].join('\n');
}

// ---------- SQL (papel macuxi_worker; 0058) ----------

const COLUNAS =
  'id, tenant_id, protocolo, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, tela, motivo, print_id, recebido_em, alerta_tentativas';
export const SQL_PROXIMO_PENDENTE = `select ${COLUNAS} from plataforma.diagnostico
 where alerta_situacao = 'pendente' and (alerta_proxima_em is null or alerta_proxima_em <= $1)
 order by recebido_em, id limit 1 for update skip locked`;
export const SQL_RECADOS_NA_HORA = `select count(distinct alerta_recado_id)::int as n from plataforma.diagnostico
 where alerta_recado_id is not null and alerta_em > $1`;
export const SQL_QUEDA_REPETIDA = `select exists (select 1 from plataforma.diagnostico
 where id <> $1 and origem <> 'botao' and alerta_situacao = 'enviado' and alerta_em > $2
   and versao_app = $3 and motivo is not distinct from $4 and aparelho_modelo is not distinct from $5) as repetida`;
const SQL_ENVIADO = `update plataforma.diagnostico
   set alerta_situacao = 'enviado', alerta_tentativas = $2, alerta_recado_id = $3, alerta_em = $4, alerta_proxima_em = null
 where id = $1`;
const SQL_AGRUPADO = `update plataforma.diagnostico set alerta_situacao = 'agrupado', alerta_proxima_em = null where id = $1`;
const SQL_ADIADO = `update plataforma.diagnostico set alerta_tentativas = $2, alerta_proxima_em = $3 where id = $1`;
const SQL_FALHOU = `update plataforma.diagnostico set alerta_situacao = 'falhou', alerta_tentativas = $2, alerta_proxima_em = null where id = $1`;
export const SQL_DESLIGAR = `update plataforma.diagnostico set alerta_situacao = 'desligado', alerta_proxima_em = null where alerta_situacao = 'pendente'`;
export const SQL_AGRUPADOS_SEM_RESUMO = `select id, recebido_em from plataforma.diagnostico
 where alerta_situacao = 'agrupado' and alerta_recado_id is null order by recebido_em, id limit 1000 for update skip locked`;
export const SQL_ULTIMO_RESUMO = `select max(alerta_em) as em from plataforma.diagnostico where alerta_situacao = 'agrupado' and alerta_recado_id is not null`;
const SQL_MARCAR_RESUMO = `update plataforma.diagnostico set alerta_recado_id = $2, alerta_em = $3 where id = any($1::uuid[])`;
export const SQL_EXPURGO = 'select diagnosticos, arquivos, chaves from plataforma.expurgar_diagnosticos($1, $2)';
export const SQL_EXISTE_0058 =
  "select to_regclass('plataforma.diagnostico') is not null and to_regprocedure('plataforma.expurgar_diagnosticos(timestamptz, integer)') is not null as ok";

// ---------- worker ----------

export interface OpcoesWorkerDiagnosticos {
  /** Pool com o papel `macuxi_worker`. */
  worker: Pick<pg.Pool, 'connect' | 'query'>;
  /** Cliente do repositório de recados; `null` = sem `MACUXI_RECADOS_TOKEN_SERVIDOR` (alerta desligado). */
  recados: ClienteRecadosGithub | null;
  /** Bytes do print (o expurgo remove depois do commit); `null` = só linhas (as chaves ficam no log como contagem). */
  armazenamento: ArmazenamentoArquivos | null;
  urlPortal?: string;
  agora?: () => Date;
  log?: LogRota;
}

export interface ResumoAlerta {
  enviados: number;
  agrupados: number;
  adiados: number;
  falhos: number;
  desligados: number;
  resumos: number;
}

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };
const diaUtc = (d: Date) => d.toISOString().slice(0, 10);

export function criarWorkerDiagnosticos(op: OpcoesWorkerDiagnosticos) {
  const relogio = op.agora ?? (() => new Date());
  const log = op.log ?? semLog;
  const urlPortal = op.urlPortal ?? URL_PORTAL_PADRAO;
  let avisouDesligado = false;
  let proximoResumoMs = 0;
  let ultimoExpurgo: string | null = null;
  const chavesPendentes = new Set<string>();

  async function emTransacao<T>(f: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await op.worker.connect();
    try {
      await c.query('begin');
      const r = await f(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** Um diagnóstico pendente numa transação. `null` = não havia pendente vencido. */
  async function umAlerta(recados: ClienteRecadosGithub): Promise<keyof Omit<ResumoAlerta, 'desligados' | 'resumos'> | null> {
    return emTransacao(async (c) => {
      const agora = relogio();
      const l = (await c.query<LinhaAlerta>(SQL_PROXIMO_PENDENTE, [agora])).rows[0];
      if (!l) return null;
      const base = { tipo: 'diagnostico', diagnostico_id: l.id, tenant_id: l.tenant_id, protocolo: Number(l.protocolo), origem: l.origem };
      if (l.origem !== 'botao') {
        const r = await c.query<{ repetida: boolean }>(SQL_QUEDA_REPETIDA, [l.id, new Date(agora.getTime() - JANELA_QUEDA_REPETIDA_MS), l.versao_app, l.motivo, l.aparelho_modelo]);
        if (r.rows[0]?.repetida) {
          await c.query(SQL_AGRUPADO, [l.id]);
          log.info({ ...base, situacao: 'agrupado', motivo_agrupado: 'repetida' }, 'diagnóstico agrupado (queda repetida)');
          return 'agrupados';
        }
      }
      const naHora = (await c.query<{ n: number }>(SQL_RECADOS_NA_HORA, [new Date(agora.getTime() - HORA_MS)])).rows[0]?.n ?? 0;
      if (naHora >= TETO_RECADOS_POR_HORA) {
        await c.query(SQL_AGRUPADO, [l.id]);
        log.info({ ...base, situacao: 'agrupado', motivo_agrupado: 'teto' }, 'diagnóstico agrupado (teto de recados por hora)');
        return 'agrupados';
      }
      const tentativas = l.alerta_tentativas + 1;
      try {
        const r = await recados.enviar({
          destinos: DESTINOS_RECADO_DIAGNOSTICO,
          gerarId: (ids) => idDoRecadoDiagnostico(agora, ids),
          montar: (id) => montarRecadoDiagnostico(l, { id, agora, urlPortal }),
        });
        await c.query(SQL_ENVIADO, [l.id, tentativas, r.id, agora]);
        log.info({ ...base, situacao: 'enviado', recado_id: r.id, tentativas }, 'recado do diagnóstico enviado');
        return 'enviados';
      } catch (e) {
        const erro = mensagemSegura(e);
        if (tentativas >= MAX_TENTATIVAS_ALERTA) {
          await c.query(SQL_FALHOU, [l.id, tentativas]);
          log.warn({ ...base, situacao: 'falhou', tentativas, erro }, 'recado do diagnóstico não enviado (falha final; o portal mostra)');
          return 'falhos';
        }
        const espera = esperaAlerta(tentativas);
        await c.query(SQL_ADIADO, [l.id, tentativas, new Date(agora.getTime() + espera)]);
        log.warn({ ...base, situacao: 'pendente', tentativas, espera_ms: espera, erro }, 'recado do diagnóstico adiado');
        return 'adiados';
      }
    });
  }

  /** Resumo da hora das linhas agrupadas ainda sem recado. */
  async function resumo(recados: ClienteRecadosGithub): Promise<number> {
    const agora = relogio();
    if (agora.getTime() < proximoResumoMs) return 0;
    return emTransacao(async (c) => {
      const ultimo = (await c.query<{ em: Date | null }>(SQL_ULTIMO_RESUMO)).rows[0]?.em ?? null;
      if (ultimo && agora.getTime() - new Date(ultimo).getTime() < HORA_MS) {
        proximoResumoMs = new Date(ultimo).getTime() + HORA_MS;
        return 0;
      }
      const linhas = (await c.query<{ id: string; recebido_em: Date }>(SQL_AGRUPADOS_SEM_RESUMO)).rows;
      if (!linhas.length) return 0;
      const desde = new Date(linhas[0]!.recebido_em);
      try {
        const r = await recados.enviar({
          destinos: DESTINOS_RECADO_DIAGNOSTICO,
          gerarId: (ids) => idDoRecadoDiagnostico(agora, ids),
          montar: (id) => montarRecadoResumo({ id, agora, quantidade: linhas.length, desde, urlPortal }),
        });
        await c.query(SQL_MARCAR_RESUMO, [linhas.map((x) => x.id), r.id, agora]);
        proximoResumoMs = agora.getTime() + HORA_MS;
        log.info({ tipo: 'diagnostico', situacao: 'resumo', recado_id: r.id, quantidade: linhas.length }, 'resumo dos diagnósticos agrupados enviado');
        return 1;
      } catch (e) {
        proximoResumoMs = agora.getTime() + 5 * 60_000;
        log.warn({ tipo: 'diagnostico', situacao: 'resumo', quantidade: linhas.length, erro: mensagemSegura(e) }, 'resumo dos diagnósticos não enviado; nova tentativa em 5 min');
        return 0;
      }
    });
  }

  /** Um ciclo do alerta: sem token desliga as pendentes; com token, até `LOTE_ALERTA` recados e o resumo da hora. */
  async function cicloAlerta(): Promise<ResumoAlerta> {
    const r: ResumoAlerta = { enviados: 0, agrupados: 0, adiados: 0, falhos: 0, desligados: 0, resumos: 0 };
    if (!op.recados) {
      r.desligados = (await op.worker.query(SQL_DESLIGAR)).rowCount ?? 0;
      if (!avisouDesligado) {
        avisouDesligado = true;
        log.warn({ tipo: 'diagnostico', desligados: r.desligados }, 'alerta de diagnóstico desligado: falta MACUXI_RECADOS_TOKEN_SERVIDOR (o diagnóstico chega ao portal)');
      }
      return r;
    }
    for (let i = 0; i < LOTE_ALERTA; i++) {
      const x = await umAlerta(op.recados);
      if (!x) break;
      r[x] += 1;
    }
    r.resumos = await resumo(op.recados);
    return r;
  }

  /** Bytes das chaves expurgadas (depois do commit); o que falhar fica para o próximo ciclo. */
  async function removerBytes(): Promise<{ removidas: number; falhas: number }> {
    let removidas = 0;
    let falhas = 0;
    if (!op.armazenamento) {
      chavesPendentes.clear();
      return { removidas, falhas };
    }
    for (const chave of [...chavesPendentes]) {
      try {
        await op.armazenamento.remover(chave);
        chavesPendentes.delete(chave);
        removidas += 1;
      } catch {
        falhas += 1;
      }
    }
    if (falhas) log.warn({ tipo: 'diagnostico', etapa: 'expurgo', falhas }, 'bytes de print não removidos; nova tentativa no próximo ciclo');
    return { removidas, falhas };
  }

  /** Expurgo de 90 dias (lotes de 500 até esvaziar, no máximo 20 lotes por chamada). */
  async function expurgar(): Promise<{ diagnosticos: number; arquivos: number; bytes: number }> {
    const total = { diagnosticos: 0, arquivos: 0, bytes: 0 };
    for (let i = 0; i < 20; i++) {
      const l = (await op.worker.query<{ diagnosticos: number; arquivos: number; chaves: string[] | null }>(SQL_EXPURGO, [relogio(), LOTE_EXPURGO])).rows[0];
      if (!l) break;
      total.diagnosticos += l.diagnosticos;
      total.arquivos += l.arquivos;
      for (const k of l.chaves ?? []) chavesPendentes.add(k);
      total.bytes += (await removerBytes()).removidas;
      if (l.diagnosticos < LOTE_EXPURGO && l.arquivos < LOTE_EXPURGO) break;
    }
    if (total.diagnosticos || total.arquivos)
      log.info({ tipo: 'diagnostico', etapa: 'expurgo', ...total, retencao_dias: RETENCAO_DIAGNOSTICO_DIAS }, 'diagnósticos expurgados');
    return total;
  }

  /** Roda o expurgo uma vez por dia UTC, a partir das 07:00 UTC; nos outros ciclos, só retenta os bytes pendentes. */
  async function talvezExpurgar(): Promise<boolean> {
    const agora = relogio();
    if (chavesPendentes.size) await removerBytes();
    if (agora.getUTCHours() < HORA_EXPURGO_UTC || ultimoExpurgo === diaUtc(agora)) return false;
    await expurgar();
    ultimoExpurgo = diaUtc(agora);
    return true;
  }

  return {
    cicloAlerta,
    expurgar,
    talvezExpurgar,
    /** Chaves de bytes que ainda falta remover (testes). */
    chavesPendentes: (): readonly string[] => [...chavesPendentes],
    /** Laço do processo: alerta + resumo + expurgo do dia a cada `intervaloMs` (padrão 60 s). Erro é logado e o laço segue. */
    iniciar(o: { intervaloMs?: number } = {}): { parar(): Promise<void> } {
      return iniciarLaco({
        ciclo: async () => {
          try {
            await cicloAlerta();
          } catch (e) {
            log.error({ tipo: 'diagnostico', erro: mensagemSegura(e) }, 'ciclo do alerta de diagnóstico falhou');
          }
          try {
            await talvezExpurgar();
          } catch (e) {
            log.error({ tipo: 'diagnostico', etapa: 'expurgo', erro: mensagemSegura(e) }, 'expurgo de diagnósticos falhou');
          }
        },
        intervaloMs: o.intervaloMs ?? 60_000,
        aoFalhar: () => {}, // cada etapa já loga a própria falha
      });
    },
  };
}

export type WorkerDiagnosticos = ReturnType<typeof criarWorkerDiagnosticos>;
