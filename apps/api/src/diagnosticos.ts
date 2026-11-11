/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3): `POST /v1/diagnosticos`, o diagnóstico do aparelho na plataforma.
 * - Sessão do app obrigatória; qualquer perfil; sem licença de módulo nem carteira (a plataforma não é módulo).
 * - Tenant e usuário vêm do TOKEN; o corpo `.strict()` recusa `tenant_id`, `usuario_id`, e-mail, nome.
 * - Texto livre (`descricao`, `erro.*`, `saida_android.descricao/pilha`, `ultimas_saidas[].descricao/pilha`) passa pela máscara única de dado pessoal (a API revalida).
 * - Idempotente pelo `id` do aparelho: 201 na 1ª vez, 200 com o mesmo protocolo na repetição do mesmo usuário; id de outro
 *   usuário (ou de outro tenant, invisível pelo RLS) = 409 `DIAGNOSTICO_JA_EXISTE`.
 * - Com `print_id`, a linha `aguardando` do print (`modulo = 'plataforma'`, ADR 0010) nasce na MESMA transação.
 * - 20 envios novos por usuário por hora (a repetição não conta): 429 `DIAGNOSTICO_LIMITE`.
 * - Log só técnico: `origem`, `versao_app`, `protocolo` (+ tenant e request_id do contexto); nunca a descrição nem a pilha.
 */
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import {
  CODIGOS_DIAGNOSTICO,
  DIAGNOSTICOS_POR_HORA,
  DiagnosticoEnvioSchema,
  FINALIDADE_PRINT_DIAGNOSTICO,
  LIMITE_CORPO_DIAGNOSTICO_BYTES,
  ROTA_DIAGNOSTICOS,
  type DiagnosticoEnvio,
  type DiagnosticoResposta,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { ErroHttp } from './erros';
import { criarLimitador, type Limitador } from './limitador';
import type { Plataforma } from './tipos';

/** Módulo do print na `plataforma.arquivo` (fora dos manifestos: o tenant nunca lê; só o portal do super-admin). */
export const MODULO_ARQUIVO_PLATAFORMA = 'plataforma';

/** O print do diagnóstico sobe pelo `PUT /v1/arquivos/:id` sem a checagem de licença de módulo (T-0158 §3). */
export const ehPrintDeDiagnostico = (a: { modulo: string; finalidade: string }): boolean =>
  a.modulo === MODULO_ARQUIVO_PLATAFORMA && a.finalidade === FINALIDADE_PRINT_DIAGNOSTICO;

const mascarar = (t: string | null): string | null => (t === null ? null : mascararDadoPessoal(t));

/** Aplica a máscara de dado pessoal em todo texto livre do envio (o aparelho já mascara; a API sempre revalida). */
export function mascararDiagnostico(d: DiagnosticoEnvio): DiagnosticoEnvio {
  return {
    ...d,
    // a rota sem query string nem âncora (pode trazer o texto de uma busca; CHECK da 0058 recusa `?` e `#`)
    tela: d.tela === null ? null : d.tela.split(/[?#]/)[0] || null,
    descricao: mascarar(d.descricao),
    erro: d.erro && { ...d.erro, mensagem: mascararDadoPessoal(d.erro.mensagem), pilha: mascarar(d.erro.pilha) },
    saida_android: d.saida_android && { ...d.saida_android, descricao: mascararDadoPessoal(d.saida_android.descricao), pilha: mascarar(d.saida_android.pilha) },
    ...(d.ultimas_saidas
      ? { ultimas_saidas: d.ultimas_saidas.map((s) => ({ ...s, descricao: mascararDadoPessoal(s.descricao), pilha: mascarar(s.pilha) })) }
      : {}),
  };
}

/** `plataforma.diagnostico.detalhe` (CHECK da 0058: só estas chaves). A lista de saídas só entra quando veio com algo. */
export function detalheDoDiagnostico(d: DiagnosticoEnvio): Record<string, unknown> {
  return {
    erro: d.erro,
    saida_android: d.saida_android,
    sync: d.sync,
    ...(d.ultimas_saidas?.length ? { ultimas_saidas: d.ultimas_saidas } : {}),
  };
}

export interface OpcoesDiagnosticos {
  /** Limite de envios novos por usuário (padrão 20 por hora, `DIAGNOSTICOS_POR_HORA`). Injetável no teste. */
  limitador?: Limitador;
}

export function registrarDiagnosticos(app: FastifyInstance, p: Plataforma, op: OpcoesDiagnosticos = {}): void {
  const limitador = op.limitador ?? criarLimitador(DIAGNOSTICOS_POR_HORA, 60 * 60 * 1000, () => p.relogio().getTime());

  app.post(ROTA_DIAGNOSTICOS, { bodyLimit: LIMITE_CORPO_DIAGNOSTICO_BYTES }, async (req, reply) => {
    const { ctx } = await p.preparar(req, null);
    const lido = DiagnosticoEnvioSchema.safeParse(req.body ?? {});
    if (!lido.success) throw new ErroHttp(400, 'VALIDACAO', 'Diagnóstico inválido. Atualize o app e tente de novo.');
    const d = mascararDiagnostico(lido.data);
    const id = d.id.toLowerCase();
    const u = ctx.usuario;
    const chaveLimite = `${u.tenant_id}:${u.id}`;

    const r = await ctx.comTenant(async (db): Promise<{ protocolo: number; criado: boolean }> => {
      const existente = async () =>
        (await db.query<{ usuario_id: string; protocolo: string | number }>('select usuario_id, protocolo from plataforma.diagnostico where id = $1', [id])).rows[0];
      const repetido = (linha: { usuario_id: string; protocolo: string | number } | undefined) => {
        if (!linha || linha.usuario_id !== u.id)
          throw new ErroHttp(409, CODIGOS_DIAGNOSTICO.jaExiste, 'Este diagnóstico já foi registrado por outra pessoa. Envie um novo.');
        return { protocolo: Number(linha.protocolo), criado: false };
      };
      const antes = await existente();
      if (antes) return repetido(antes);
      if (!limitador.tentar(chaveLimite)) {
        reply.header('retry-after', String(limitador.esperaSegundos(chaveLimite)));
        throw new ErroHttp(429, CODIGOS_DIAGNOSTICO.limite, 'Muitos diagnósticos enviados em pouco tempo. Tente de novo mais tarde.');
      }
      const ins = await db.query<{ protocolo: string | number }>(
        `insert into plataforma.diagnostico
           (id, tenant_id, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api,
            tela, motivo, descricao, detalhe, print_id, ocorrido_em)
         values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)
         on conflict (id) do nothing
         returning protocolo`,
        [
          id,
          u.id,
          u.perfil,
          d.origem,
          d.app,
          d.versao_app,
          d.build,
          d.aparelho.fabricante,
          d.aparelho.modelo,
          d.aparelho.android,
          d.aparelho.api,
          d.tela,
          d.motivo,
          d.descricao,
          JSON.stringify(detalheDoDiagnostico(d)),
          d.print_id?.toLowerCase() ?? null,
          d.ocorrido_em,
        ],
      );
      // corrida com outro envio do mesmo id entre o select e o insert: decide pelo que ficou gravado
      if (!ins.rows[0]) return repetido(await existente());
      if (d.print_id) {
        await db.query(
          `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por, tipo)
           values ($1, plataforma.tenant_atual(), $2, $3, 'diagnostico', $4, null, $5, 'image/jpeg')
           on conflict (id) do nothing`,
          [d.print_id.toLowerCase(), MODULO_ARQUIVO_PLATAFORMA, FINALIDADE_PRINT_DIAGNOSTICO, id, u.id],
        );
      }
      return { protocolo: Number(ins.rows[0].protocolo), criado: true };
    });

    ctx.log.info({ diagnostico_id: id, origem: d.origem, versao_app: d.versao_app, protocolo: r.protocolo, criado: r.criado }, 'diagnóstico recebido');
    const corpo: DiagnosticoResposta = { id, protocolo: r.protocolo, criado: r.criado };
    return reply.code(r.criado ? 201 : 200).send(corpo);
  });
}
