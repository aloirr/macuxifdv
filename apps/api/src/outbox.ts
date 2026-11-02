/**
 * Outbox no Postgres (doc 04 "Comunicação entre módulos"; desenho T-0004 §6): o evento é gravado em
 * `plataforma.evento` na MESMA transação do fato (`ctx.comTenant`), com o RLS do tenant. A validação (nome,
 * `publica` do manifesto, schema do payload) é a do barramento do platform-sdk. O despacho entre tenants
 * (papel `macuxi_worker`, ADR 0007) lê daqui depois.
 *
 * Na mesma transação, o comando que referencia uma foto registra a linha `aguardando` em `plataforma.arquivo`
 * (`registrarArquivo`, ADR 0010); o upload (`arquivos.ts`) só a completa. Também na mesma transação: a consulta a outro
 * módulo (`consultar`, ADR 0012: mesmo `ClienteBanco`, tenant e RLS) e a auditoria (`auditar`, RN-AUD-01).
 */
import {
  CODIGOS_ARQUIVO,
  ConsultaIndisponivel,
  criarBarramento,
  ErroHttpModulo,
  executarConsulta,
  validarNovoArquivo,
  type ClienteBanco,
  type EnvelopeEvento,
  type ImplementacaoConsulta,
  type LogRota,
  type Manifesto,
  type ModuloId,
  type RegistroConsumo,
  type TransacaoTenant,
  type UsuarioDaRequisicao,
} from '@macuxi/platform-sdk';

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
  consultas?: RegistroConsultasApi;
  parametros?: (modulo: ModuloId) => Readonly<Record<string, unknown>>;
  log?: LogComFilho;
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

export function transacaoTenant(db: ClienteBanco, o: OrigemTransacao): TransacaoTenant {
  return {
    publicar: publicadorTenant(db, o),
    async consultar(def, entrada) {
      if (!o.modulo) throw new Error('Rota da plataforma não usa consulta de módulo');
      const quem = o.manifestos.find((m) => m.id === o.modulo);
      if (!quem?.usaConsultas.includes(def.nome))
        throw new Error(`Consulta ${def.nome}: ${o.modulo} não a declara em usaConsultas do manifesto (ADR 0012)`);
      const impl = o.consultas?.get(def.nome);
      // dono não instalado (opcional) ou inativo para o usuário agora (licença, RN-CORE-02/03)
      if (!impl || !o.usuario || !o.usuario.modulos.includes(def.modulo)) throw new ConsultaIndisponivel(def.nome, def.modulo);
      const usuario = o.usuario;
      const base = o.log ?? logMudo;
      // log da consulta: dono, consulta e request_id; nunca a entrada nem a saída
      const log = (base as LogComFilho).child?.({ modulo: def.modulo, consulta: def.nome, consumidor: o.modulo }) ?? base;
      return executarConsulta(def, entrada, (e) =>
        impl.executar(e, { db, usuario, requestId: o.requestId, agora: o.agora, parametros: () => o.parametros?.(def.modulo) ?? {}, log }),
      );
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
      const problemas = validarNovoArquivo(a);
      if (problemas.length > 0) throw new Error(`registrarArquivo: ${problemas.join('; ')}`);
      const id = a.id.toLowerCase();
      const entidadeId = a.entidade_id.toLowerCase();
      // id = UUID do aparelho: repetir o comando (lote reenviado) não cria outra linha
      const r = await db.query(
        `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por, tipo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do nothing`,
        [id, o.tenantId, o.modulo, a.finalidade, a.entidade, entidadeId, a.cliente_id?.toLowerCase() ?? null, o.usuarioId, a.tipo ?? 'image/jpeg'],
      );
      if (r.rowCount) return { criado: true };
      // já existe: mesma referência = idempotente; outra (ou de outro tenant, invisível pelo RLS) = conflito
      const atual = (
        await db.query<{ modulo: string; entidade: string; entidade_id: string; enviado_por: string }>(
          'select modulo, entidade, entidade_id, enviado_por from plataforma.arquivo where id = $1',
          [id],
        )
      ).rows[0];
      if (atual && atual.modulo === o.modulo && atual.entidade === a.entidade && atual.entidade_id === entidadeId && atual.enviado_por === o.usuarioId)
        return { criado: false };
      throw new ErroHttpModulo(409, CODIGOS_ARQUIVO.jaReferenciado, 'Esta foto já está ligada a outro registro. Tire a foto de novo.');
    },
  };
}
