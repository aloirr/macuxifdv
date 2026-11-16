/**
 * Outbox no Postgres (doc 04 "Comunicação entre módulos"; desenho T-0004 §6): o evento é gravado em
 * `plataforma.evento` na MESMA transação do fato (`ctx.comTenant`), com o RLS do tenant. A validação (nome,
 * `publica` do manifesto, schema do payload) é a do barramento do platform-sdk. O despacho entre tenants
 * (papel `macuxi_worker`, ADR 0007) lê daqui depois.
 *
 * Na mesma transação, o comando que referencia uma foto registra a linha `aguardando` em `plataforma.arquivo`
 * (`registrarArquivo`, ADR 0010); o upload (`arquivos.ts`) só a completa. Também na mesma transação: a consulta a outro
 * módulo (`consultar`, ADR 0012: mesmo `ClienteBanco`, tenant e RLS; `{ licenca: 'tenant' }` em leitura e, em escrita, só para
 * consulta `configuracaoDoTenant` num savepoint somente leitura, ADR 0025 §4.1) e a
 * auditoria (`auditar`, RN-AUD-01).
 */
import {
  CODIGOS_ARQUIVO,
  catalogoDePermissoes,
  ConsultaIndisponivel,
  consultasDeclaradas,
  criarBarramento,
  ErroHttpModulo,
  executarConsulta,
  fusoDoTenantOuPadrao,
  matrizDeFabrica,
  problemasPerfisLeitura,
  validarNovoArquivo,
  type ClienteBanco,
  type ContextoConsulta,
  type DefinicaoConsulta,
  type EnvelopeEvento,
  type ImagemGuardada,
  type ImplementacaoConsulta,
  type InfoArquivo,
  type NovoArquivo,
  type LogRota,
  type Manifesto,
  type ModuloId,
  type MotorPermissoes,
  type OpcoesConsulta,
  type RegistroConsumo,
  type TransacaoTenant,
  type UsuarioDaRequisicao,
} from '@macuxi/platform-sdk';
import type { z } from 'zod';
import { CHAVE_ARQUIVO_RE } from './arquivos';

export async function gravarEvento(db: ClienteBanco, envelope: EnvelopeEvento, agregadoId: string | null): Promise<void> {
  await db.query(
    // usuario_id/request_id: envelope completo no banco para o rastreio ponta a ponta (ADR 0007 §4, migração 0003)
    `insert into plataforma.evento (id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, usuario_id, request_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      envelope.evento_id,
      envelope.tenant_id,
      envelope.nome,
      envelope.origem,
      agregadoId,
      JSON.stringify(envelope.payload),
      envelope.ocorrido_em,
      envelope.usuario_id,
      envelope.request_id,
    ],
  );
}

/** Publicar não consome: o registro de consumo é do despachante. */
const semConsumo: RegistroConsumo = {
  jaProcessado: async () => false,
  marcarProcessado: async () => undefined,
};

/** Consultas implementadas pelos módulos instalados (ADR 0012), por nome. */
export type RegistroConsultasApi = ReadonlyMap<string, ImplementacaoConsulta>;

/** Monta o registro (a montagem já foi validada por `definirModuloApi` e `validarConjunto`). */
export function registroDeConsultas(modulos: readonly { consultas?: readonly ImplementacaoConsulta[] }[]): RegistroConsultasApi {
  const r = new Map<string, ImplementacaoConsulta>();
  for (const m of modulos) for (const c of m.consultas ?? []) r.set(c.consulta.nome, c);
  return r;
}

/** Logger com `child` (pino); o tipo do SDK não exige. */
type LogComFilho = LogRota & { child?: (b: Record<string, unknown>) => LogRota };

export interface OrigemTransacao {
  manifestos: readonly Manifesto[];
  /** Módulo da rota (quem publica). `null` = rota da plataforma, que não publica evento de módulo. */
  modulo: ModuloId | null;
  tenantId: string;
  /** Autor da sessão; `null` nas rotas de Conector (ADR 0013 §4: não há usuário; auditoria e eventos sem autor). */
  usuarioId: string | null;
  requestId: string;
  agora: () => Date;
  /** Para `consultar` (ADR 0012): usuário com os módulos efetivos AGORA, consultas instaladas, parâmetros e log. */
  usuario?: UsuarioDaRequisicao;
  /**
   * ADR 0025: módulos efetivos do TENANT para `consultar(def, entrada, { licenca: 'tenant' })`. Presente onde a opção vale:
   * rota de usuário (leitura e escrita), consumidor de evento e tarefa periódica. Ausente (Conector) = pedir `'tenant'` é
   * erro de programação.
   */
  modulosDoTenant?: readonly ModuloId[];
  /**
   * ADR 0025 §4.1 (T-0114): rota de usuário de ESCRITA (método ≠ GET/HEAD, inclusive o push do sync). Com `true`,
   * `'tenant'` só vale para consulta que o dono declarou `configuracaoDoTenant`, executada num savepoint somente leitura;
   * outra consulta = erro de programação. Consumidor e tarefa não marcam (a licença já é a do tenant).
   */
  escrita?: boolean;
  consultas?: RegistroConsultasApi;
  parametros?: (modulo: ModuloId) => Readonly<Record<string, unknown>>;
  /** Fuso do tenant para `ContextoConsulta.fuso()` (o mesmo `ctx.fuso()` de quem consulta). Ausente/inválido = America/Manaus. */
  fuso?: () => string;
  log?: LogComFilho;
}

/** Savepoint da consulta de configuração do tenant em escrita (ADR 0025 §4.1). */
export const SAVEPOINT_SOMENTE_LEITURA = 'macuxi_consulta_tenant';

/**
 * ADR 0025 §4.1: roda `fn` num savepoint com `transaction_read_only` ligado, no meio da transação da rota de escrita. O
 * Postgres recusa qualquer escrita (SQLSTATE 25006) e o `rollback to savepoint` devolve a transação ao modo leitura e
 * escrita (a consulta não escreveu nada, então não há o que perder); depois o savepoint é liberado. Erro da consulta
 * desfaz o savepoint e segue para quem chamou (a transação continua utilizável).
 */
export async function emSomenteLeitura<T>(db: ClienteBanco, fn: () => Promise<T>): Promise<T> {
  const desfazer = async () => {
    await db.query(`rollback to savepoint ${SAVEPOINT_SOMENTE_LEITURA}`);
    await db.query(`release savepoint ${SAVEPOINT_SOMENTE_LEITURA}`);
  };
  await db.query(`savepoint ${SAVEPOINT_SOMENTE_LEITURA}`);
  let r: T;
  try {
    await db.query('set transaction read only');
    r = await fn();
  } catch (e) {
    await desfazer().catch(() => undefined);
    throw e;
  }
  await desfazer();
  return r;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const logMudo: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface OrigemPublicacao {
  manifestos: readonly Manifesto[];
  modulo: ModuloId | null;
  tenantId: string;
  /** Autor do fato; `null` quando o evento nasce de outro evento sem autor (sistema, Hub). */
  usuarioId: string | null;
  requestId: string | null;
  agora: () => Date;
}

/** `tx.publicar` da rota e do consumidor de evento (despachante): grava em `plataforma.evento` na transação `db`. */
export function publicadorTenant(db: ClienteBanco, o: OrigemPublicacao): TransacaoTenant['publicar'] {
  return async (def, payload, agregadoId = null) => {
    if (!o.modulo) throw new Error('Rota da plataforma não publica evento de módulo');
    const barramento = criarBarramento({
      manifestos: o.manifestos,
      outbox: { gravar: (env) => gravarEvento(db, env, agregadoId) },
      consumo: semConsumo,
      agora: o.agora,
    });
    return barramento.publicar(o.modulo, def, payload, { tenant_id: o.tenantId, usuario_id: o.usuarioId, request_id: o.requestId });
  };
}

const motorPorManifestos = new WeakMap<readonly Manifesto[], MotorPermissoes>();

/**
 * ADR 0033 (T-0111; T-0173): catálogo das chaves e padrão de fábrica dos manifestos instalados, o MESMO objeto para a rota
 * (`ContextoBase.permissoes`) e para a consulta (`ContextoConsulta.permissoes`). Calculado uma vez por lista de manifestos.
 */
export function motorPermissoesDe(manifestos: readonly Manifesto[]): MotorPermissoes {
  let m = motorPorManifestos.get(manifestos);
  if (!m) {
    m = { catalogo: catalogoDePermissoes(manifestos), matriz: matrizDeFabrica(manifestos) };
    motorPorManifestos.set(manifestos, m);
  }
  return m;
}

/** Profundidade máxima da cadeia de consultas (consulta que chama consulta, T-0149): guarda contra laço por engano. */
export const PROFUNDIDADE_MAXIMA_CONSULTAS = 4;

/**
 * `consultar` com `consumidor` = módulo que chama. Na rota, no consumidor e na tarefa é o módulo deles; dentro de uma consulta
 * (`ContextoConsulta.consultar`, T-0149) é o DONO da consulta que está rodando: ele precisa declarar a outra em `usaConsultas` (ou
 * `usaConsultasOpcionais`) do próprio manifesto, como qualquer consumidor. Mesmo `db` (transação, tenant, RLS), mesmo usuário e
 * mesmo modo (escrita) da origem; sem elevação. `cadeia` = consultas em execução acima desta: repetir uma (ciclo) ou passar de
 * `PROFUNDIDADE_MAXIMA_CONSULTAS` = erro de programação. Dentro do savepoint somente leitura (ADR 0025 §4.1) a consulta aninhada
 * já está protegida e não abre outro.
 */
async function consultarComo<E extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  db: ClienteBanco,
  o: OrigemTransacao,
  consumidor: ModuloId,
  cadeia: readonly string[],
  jaSomenteLeitura: boolean,
  def: DefinicaoConsulta<E, S>,
  entrada: z.input<E>,
  opcoes?: OpcoesConsulta,
): Promise<z.output<S>> {
  const quem = o.manifestos.find((m) => m.id === consumidor);
  if (!quem || !consultasDeclaradas(quem).includes(def.nome))
    throw new Error(`Consulta ${def.nome}: ${consumidor} não a declara em usaConsultas do manifesto (ADR 0012)`);
  if (cadeia.includes(def.nome)) throw new Error(`Consulta ${def.nome}: ciclo entre consultas (${[...cadeia, def.nome].join(' -> ')}; T-0149)`);
  if (cadeia.length >= PROFUNDIDADE_MAXIMA_CONSULTAS)
    throw new Error(`Consulta ${def.nome}: cadeia de consultas passou de ${PROFUNDIDADE_MAXIMA_CONSULTAS} níveis (${cadeia.join(' -> ')}; T-0149)`);
  const licenca = opcoes?.licenca ?? 'usuario';
  if (licenca !== 'usuario' && licenca !== 'tenant') throw new Error(`Consulta ${def.nome}: licenca inválida (use 'usuario' ou 'tenant', ADR 0025)`);
  const impl = o.consultas?.get(def.nome);
  // sem usuário (rota de Conector, ADR 0013): indisponível com qualquer licença
  if (!impl || !o.usuario) throw new ConsultaIndisponivel(def.nome, def.modulo);
  // ADR 0025: só a checagem de módulo muda (o usuário, o escopo, o tenant e a RLS são os mesmos). Em escrita, só consulta
  // que o DONO declarou configuracaoDoTenant (o registro da implementação manda, não a definição que o consumidor passou)
  let ativos: readonly ModuloId[] = o.usuario.modulos;
  let somenteLeitura = false;
  if (licenca === 'tenant') {
    if (!o.modulosDoTenant) throw new Error(`Consulta ${def.nome}: licenca 'tenant' indisponível neste contexto (ADR 0025)`);
    if (o.escrita) {
      if (impl.consulta.configuracaoDoTenant !== true)
        throw new Error(`Consulta ${def.nome}: licenca 'tenant' em escrita só para consulta configuracaoDoTenant do dono (ADR 0025 §4.1)`);
      somenteLeitura = !jaSomenteLeitura;
    }
    ativos = o.modulosDoTenant;
  }
  // dono não instalado (opcional ou usaConsultasOpcionais, ADR 0019) ou inativo agora (licença do usuário ou do tenant, RN-CORE-02/03)
  if (!ativos.includes(def.modulo)) throw new ConsultaIndisponivel(def.nome, def.modulo);
  const usuario = o.usuario;
  const base = o.log ?? logMudo;
  // log da consulta: dono, consulta, licença e request_id; nunca a entrada nem a saída
  const log = (base as LogComFilho).child?.({ modulo: def.modulo, consulta: def.nome, consumidor, licenca }) ?? base;
  const abaixo = [...cadeia, def.nome];
  const protegida = jaSomenteLeitura || somenteLeitura;
  const ctx: ContextoConsulta = {
    db,
    usuario,
    requestId: o.requestId,
    agora: o.agora,
    parametros: () => o.parametros?.(def.modulo) ?? {},
    fuso: () => fusoDoTenantOuPadrao(o.fuso?.()),
    log,
    // T-0173: matriz de fábrica dos módulos instalados (ex.: core.credencial_conferir@1 confere a permissão efetiva)
    permissoes: motorPermissoesDe(o.manifestos),
    // T-0149: a consulta chama outra como o módulo DONO (usaConsultas dele), na mesma transação e com o mesmo usuário
    consultar: (d, e, op) => consultarComo(db, o, def.modulo, abaixo, protegida, d, e, op),
  };
  const executar = () => executarConsulta(def, entrada, (e) => impl.executar(e, ctx));
  return somenteLeitura ? emSomenteLeitura(db, executar) : executar();
}

export function transacaoTenant(db: ClienteBanco, o: OrigemTransacao): TransacaoTenant {
  return {
    publicar: publicadorTenant(db, o),
    async consultar(def, entrada, opcoes) {
      if (!o.modulo) throw new Error('Rota da plataforma não usa consulta de módulo');
      return consultarComo(db, o, o.modulo, [], false, def, entrada, opcoes);
    },
    async auditar(r) {
      if (!o.modulo) throw new Error('Rota da plataforma não audita fato de módulo');
      if (!r.acao.trim() || !r.entidade.trim()) throw new Error('auditar: informe acao e entidade');
      if (r.entidade_id !== null && !UUID_RE.test(r.entidade_id)) throw new Error('auditar: entidade_id precisa ser UUID (ou null)');
      await db.query(
        `insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
        [
          o.tenantId,
          o.usuarioId,
          o.modulo,
          r.acao,
          r.entidade,
          r.entidade_id?.toLowerCase() ?? null,
          r.antes === undefined ? null : JSON.stringify(r.antes),
          r.depois === undefined ? null : JSON.stringify(r.depois),
          o.requestId,
          o.agora().toISOString(),
        ],
      );
    },
    async registrarArquivo(a) {
      if (!o.modulo) throw new Error('Rota da plataforma não registra arquivo de módulo');
      if (o.usuarioId === null) throw new Error('registrarArquivo: rota sem usuário (Conector) não registra arquivo (ADR 0010/0013)');
      return registrarArquivoNoBanco(db, { tenantId: o.tenantId, modulo: o.modulo, enviadoPor: o.usuarioId }, a);
    },
    async infoArquivo(id) {
      if (!o.modulo) throw new Error('Rota da plataforma não consulta arquivo de módulo');
      return infoArquivoNoBanco(db, o.modulo, id);
    },
    async restringirArquivos(alvo) {
      if (!o.modulo) throw new Error('Rota da plataforma não restringe arquivo de módulo');
      if (!/^[a-z][a-z0-9_]*$/.test(alvo.entidade)) throw new Error('restringirArquivos: entidade em snake_case');
      if (alvo.entidade_ids.some((x) => !UUID_RE.test(x))) throw new Error('restringirArquivos: entidade_ids precisam ser UUID');
      const problemas = problemasPerfisLeitura(alvo.perfis_leitura);
      if (problemas.length > 0) throw new Error(`restringirArquivos: ${problemas.join('; ')}`);
      if (alvo.entidade_ids.length === 0) return { alterados: 0 };
      // só os arquivos do próprio módulo (o RLS já limita ao tenant); o gatilho arquivo_updated_at atualiza o updated_at
      const r = await db.query(
        `update plataforma.arquivo set perfis_leitura = $4::text[]
          where modulo = $1 and entidade = $2 and entidade_id = any($3::uuid[]) and deleted_at is null
            and perfis_leitura is distinct from $4::text[]`,
        [o.modulo, alvo.entidade, alvo.entidade_ids.map((x) => x.toLowerCase()), alvo.perfis_leitura ? [...alvo.perfis_leitura] : null],
      );
      return { alterados: r.rowCount ?? 0 };
    },
  };
}

/**
 * ADR 0010 + ADR 0058: cria a linha de `plataforma.arquivo` do módulo (idempotente pelo `id`). Sem `recebido`, nasce
 * `aguardando` (o upload completa); com `recebido` (foto gravada pelo trabalho), nasce `recebido` com sha256, tamanho,
 * dimensões e a chave, que tem de ser do tenant, do módulo e do próprio `id`. Mesmo `id` em outra entidade, outro módulo
 * ou de outro autor → 409 `ARQUIVO_JA_REFERENCIADO`.
 */
export async function registrarArquivoNoBanco(
  db: ClienteBanco,
  o: { tenantId: string; modulo: ModuloId; enviadoPor: string },
  a: NovoArquivo & { recebido?: ImagemGuardada },
): Promise<{ criado: boolean }> {
  const problemas = validarNovoArquivo(a);
  if (!UUID_RE.test(o.enviadoPor)) problemas.push('enviado_por precisa ser UUID');
  const id = a.id.toLowerCase();
  const r0 = a.recebido;
  if (r0) {
    const chaveOk =
      CHAVE_ARQUIVO_RE.test(r0.chave) &&
      r0.chave.startsWith(`${o.tenantId.toLowerCase()}/${o.modulo}/`) &&
      new RegExp(`/${id}\\.(jpg|png|webp)$`).test(r0.chave);
    if (!chaveOk) problemas.push('recebido.chave não é do arquivo');
    if (!/^[0-9a-f]{64}$/.test(r0.sha256)) problemas.push('recebido.sha256 inválido');
    if (a.tipo !== undefined && a.tipo !== r0.tipo) problemas.push('tipo diferente do recebido');
  }
  if (problemas.length > 0) throw new Error(`registrarArquivo: ${problemas.join('; ')}`);
  const entidadeId = a.entidade_id.toLowerCase();
  const enviadoPor = o.enviadoPor.toLowerCase();
  // id = UUID do aparelho: repetir o comando (lote reenviado) não cria outra linha
  // perfis_leitura (ADR 0041): só na criação; mudança depois é pelo restringirArquivos
  const r = await db.query(
    `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por, tipo, perfis_leitura,
                                     situacao, sha256, tamanho_bytes, largura_px, altura_px, recebido_em, chave_armazenamento)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, case when $11 = 'recebido' then now() end, $16)
     on conflict (id) do nothing`,
    [
      id,
      o.tenantId,
      o.modulo,
      a.finalidade,
      a.entidade,
      entidadeId,
      a.cliente_id?.toLowerCase() ?? null,
      enviadoPor,
      r0?.tipo ?? a.tipo ?? 'image/jpeg',
      a.perfis_leitura ? [...a.perfis_leitura] : null,
      r0 ? 'recebido' : 'aguardando',
      r0?.sha256 ?? null,
      r0?.tamanho_bytes ?? null,
      r0?.largura_px ?? null,
      r0?.altura_px ?? null,
      r0?.chave ?? null,
    ],
  );
  if (r.rowCount) return { criado: true };
  // já existe: mesma referência = idempotente; outra (ou de outro tenant, invisível pelo RLS) = conflito
  const atual = (
    await db.query<{ modulo: string; entidade: string; entidade_id: string; enviado_por: string }>(
      'select modulo, entidade, entidade_id, enviado_por from plataforma.arquivo where id = $1',
      [id],
    )
  ).rows[0];
  if (atual && atual.modulo === o.modulo && atual.entidade === a.entidade && atual.entidade_id === entidadeId && atual.enviado_por === enviadoPor)
    return { criado: false };
  throw new ErroHttpModulo(409, CODIGOS_ARQUIVO.jaReferenciado, 'Esta foto já está ligada a outro registro. Tire a foto de novo.');
}

/** ADR 0058: situação de um arquivo DO MÓDULO (RLS do tenant); `null` = não existe, removido ou de outro módulo. */
export async function infoArquivoNoBanco(db: ClienteBanco, modulo: ModuloId, id: string): Promise<InfoArquivo | null> {
  if (!UUID_RE.test(id)) return null;
  const l = (
    await db.query<InfoArquivo>(
      `select id, tipo, situacao, tamanho_bytes, entidade, entidade_id, enviado_por
         from plataforma.arquivo where id = $1 and modulo = $2 and deleted_at is null`,
      [id.toLowerCase(), modulo],
    )
  ).rows[0];
  return l ? { ...l, tamanho_bytes: l.tamanho_bytes === null ? null : Number(l.tamanho_bytes) } : null;
}
