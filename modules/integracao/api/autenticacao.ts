/**
 * Autenticação e conferências prévias das rotas do Conector (ADR 0013 §3 etapas 3 e 6; desenho T-0032 §9a).
 * - `autenticar`: Zod dos cabeçalhos, HMAC da chave com o pepper do `.env`, `integracao.autenticar_chave` (única leitura sem
 *   tenant), `avaliarChaveConector` (RN-INT-10; a licença é da plataforma) e a lista de IPs. Recusa 401 sempre genérica.
 * - `antes`: taxa por Conector (token bucket em memória), tamanho do corpo pelo parâmetro do tenant, versão mínima (426, RN-INT-11).
 */
import {
  ErroConector,
  type ConectorAutenticado,
  type ConectorDaChave,
  type ContextoConector,
  type EntradaAutenticacaoConector,
  type RecusaConector,
  type RotaConector,
} from '@macuxi/platform-sdk';
import { CABECALHO_CONECTOR_VERSAO, CabecalhosConector, type Entidade, type PoliticaVersaoConector } from '../contracts';
import {
  avaliarChaveConector,
  avaliarVersaoConector,
  politicaEfetiva,
  classeDaRota,
  consumirToken,
  rotaBloqueadaPorVersao,
  verificarTamanhoCorpo,
  versaoInformada,
  type ChaveArmazenada,
  type EstadoBalde,
} from '../domain';
import { hashDaChave, ipPermitido, pepperValido } from './chave';
import { lerParametrosHub } from './parametros';

/** O Conector dono da chave, como as rotas o recebem em `ctx.conector`. */
export interface ConectorHub extends ConectorDaChave {
  entidades: Entidade[];
  recebe_pedidos: boolean;
  credencial_id: string;
  situacao_chave: 'ativa' | 'em_convivencia';
}

interface LinhaChave {
  credencial_id: string;
  tenant_id: string;
  conector_id: string;
  escopo: string;
  papel: 'atual' | 'anterior';
  criada_em: Date | string;
  expira_em: Date | string | null;
  anterior_valida_ate: Date | string | null;
  revogada_em: Date | string | null;
  ultimo_uso_em: Date | string | null;
  conector_identificador: string;
  conector_ativo: boolean;
  ips_permitidos: string[];
  recebe_pedidos: boolean;
  entidades: string[];
}

const iso = (v: Date | string | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

const SQL_CHAVE = `select credencial_id, tenant_id, conector_id, escopo, papel, criada_em, expira_em, anterior_valida_ate, revogada_em,
         ultimo_uso_em, conector_identificador, conector_ativo, ips_permitidos::text[] as ips_permitidos, recebe_pedidos, entidades
    from integracao.autenticar_chave($1)`;

export const MSG_401 = 'Credencial inválida. Confira o identificador do Conector e a chave de API; ela pode ter sido rotacionada ou revogada (peça uma nova no BKO e grave com "conector trocar-chave").';

/** `ultimo_uso_em` no máximo 1 vez por minuto por credencial (o resto não escreve). */
const INTERVALO_USO_MS = 60_000;

export interface AutenticacaoHub {
  autenticar(e: EntradaAutenticacaoConector): Promise<ConectorAutenticado<ConectorHub> | RecusaConector>;
  antes(ctx: ContextoConector<ConectorHub>, rota: RotaConector<ConectorHub>): Promise<void>;
  /** Política de versão lida em `antes` (a rota do sinal reaproveita, sem nova consulta). */
  politicaDaRequisicao(ctx: ContextoConector<ConectorHub>): PoliticaVersaoConector | null | undefined;
}

export function criarAutenticacaoHub(o: { pepper: () => string | undefined }): AutenticacaoHub {
  const baldes = new Map<string, EstadoBalde>();
  const usos = new Map<string, number>();
  const politicas = new WeakMap<object, PoliticaVersaoConector | null>();

  async function autenticar(e: EntradaAutenticacaoConector): Promise<ConectorAutenticado<ConectorHub> | RecusaConector> {
    const cab = CabecalhosConector.safeParse(e.cabecalhos);
    if (!cab.success) {
      return {
        ok: false,
        status: 400,
        codigo: 'requisicao_invalida',
        mensagem: `Cabeçalhos inválidos: ${cab.error.issues.map((i) => i.message).join('; ')}.`,
        motivo: 'cabecalhos_malformados',
      };
    }
    const pepper = o.pepper();
    if (!pepperValido(pepper)) {
      e.log.error({ motivo: 'sem_pepper' }, 'MACUXI_HUB_CHAVE_PEPPER ausente ou curto: o Hub recusa as chamadas de Conector (falha fechada)');
      return { ok: false, status: 503, codigo: 'servico_indisponivel', mensagem: 'O Hub está indisponível no momento. O Conector tenta de novo sozinho.', motivo: 'sem_pepper' };
    }
    const chaveClara = String(cab.data.authorization).slice('Bearer '.length);
    const hash = hashDaChave(pepper, chaveClara);
    const { rows } = await e.semTenant((db) => db.query<LinhaChave>(SQL_CHAVE, [hash]));
    const linha = rows[0] ?? null;
    const armazenada: ChaveArmazenada | null =
      linha === null
        ? null
        : {
            conector_id: linha.conector_identificador,
            conector_ativo: linha.conector_ativo,
            escopo: linha.escopo,
            papel: linha.papel,
            criada_em: iso(linha.criada_em) as string,
            expira_em: iso(linha.expira_em),
            anterior_valida_ate: iso(linha.anterior_valida_ate),
            revogada_em: iso(linha.revogada_em),
          };
    const r = avaliarChaveConector({
      chave: armazenada,
      conector_id_cabecalho: String(cab.data['x-macuxi-conector-id']),
      agora: e.agora().toISOString(),
      ipPermitido: linha === null ? undefined : ipPermitido(linha.ips_permitidos ?? [], e.ip),
    });
    if (!r.ok) {
      return { ok: false, status: r.status, codigo: r.codigo, mensagem: r.status === 401 ? MSG_401 : r.mensagem, motivo: r.motivo };
    }
    // `linha` existe: a chave só é aceita quando o hash casou com uma credencial
    const l = linha as LinhaChave;
    return {
      ok: true,
      tenantId: l.tenant_id,
      conector: {
        id: l.conector_id,
        identificador: l.conector_identificador,
        entidades: l.entidades as Entidade[],
        recebe_pedidos: l.recebe_pedidos,
        credencial_id: l.credencial_id,
        situacao_chave: r.situacao,
      },
    };
  }

  async function antes(ctx: ContextoConector<ConectorHub>, rota: RotaConector<ConectorHub>): Promise<void> {
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    const classe = classeDaRota(rota.metodo, rota.caminho);
    const agora = ctx.agora();

    // taxa por Conector e classe de rota (RN-INT-12)
    const chaveBalde = `${ctx.tenantId}|${ctx.conector.id}|${classe}`;
    const token = consumirToken(baldes.get(chaveBalde) ?? null, agora.toISOString(), parametros.taxaPorConector[classe]);
    baldes.set(chaveBalde, token.estado);
    if (!token.permitido) {
      throw new ErroConector(
        429,
        { codigo: 'limite_de_taxa', mensagem: 'O Conector chamou o Hub mais vezes do que o permitido. Aguarde um instante; o Conector retoma sozinho.', erros: [{ codigo: 'limite_de_taxa', campo: null, mensagem: 'Muitas chamadas em pouco tempo.' }] },
        { 'retry-after': String(Math.max(1, token.retryAfterSeg)) },
      );
    }

    const tamanho = verificarTamanhoCorpo(ctx.bytesCorpo, classe, parametros);
    if (!tamanho.ok) {
      throw new ErroConector(413, { codigo: tamanho.codigo, mensagem: tamanho.mensagem, detalhes: { limite_bytes: tamanho.limite_bytes }, erros: [{ codigo: tamanho.codigo, campo: null, mensagem: tamanho.mensagem }] });
    }

    // política de versão do tenant (RN-INT-11): abaixo da mínima só o sinal de vida passa
    const politicaGravada = await ctx.comTenant(async (db) => {
      const { rows } = await db.query<{ versao_minima: string; versao_recomendada: string; mensagem: string | null; pacote: PoliticaVersaoConector['pacote'] | null }>(
        'select versao_minima, versao_recomendada, mensagem, pacote from integracao.politica_versao where tenant_id = $1 and deleted_at is null',
        [ctx.tenantId],
      );
      const p = rows[0];
      return p ? ({ versao_minima: p.versao_minima, versao_recomendada: p.versao_recomendada, mensagem: p.mensagem, pacote: p.pacote } satisfies PoliticaVersaoConector) : null;
    });
    // RN-INT-11: sem linha gravada, Conector que recebe pedidos exige o piso 1.2.1 (padrão do Hub); a linha da empresa sempre manda
    const politica = politicaEfetiva(politicaGravada, ctx.conector.recebe_pedidos);
    politicas.set(ctx, politica);
    const doCorpo = (ctx.corpo as { versao_conector?: unknown } | null | undefined)?.versao_conector;
    const versao = versaoInformada(ctx.cabecalhos[CABECALHO_CONECTOR_VERSAO.toLowerCase()], typeof doCorpo === 'string' ? doCorpo : null);
    const avaliacao = avaliarVersaoConector(versao, politica);
    if (rotaBloqueadaPorVersao(rota.id, avaliacao.situacao)) {
      const mensagem = avaliacao.aviso ?? 'A versão do Conector está abaixo da mínima exigida. Atualize o Conector.';
      throw new ErroConector(426, {
        codigo: 'versao_conector_nao_suportada',
        mensagem,
        detalhes: { versao_minima: politica?.versao_minima ?? null },
        erros: [{ codigo: 'versao_conector_nao_suportada', campo: null, mensagem }],
      });
    }

    // uso da chave (no máximo 1×/min por credencial; em memória primeiro, para não abrir transação à toa)
    const ultimo = usos.get(ctx.conector.credencial_id) ?? 0;
    if (agora.getTime() - ultimo >= INTERVALO_USO_MS) {
      usos.set(ctx.conector.credencial_id, agora.getTime());
      await ctx.comTenant((db) =>
        db.query(
          `update integracao.credencial set ultimo_uso_em = $2
            where tenant_id = $1 and id = $3 and (ultimo_uso_em is null or ultimo_uso_em <= $2::timestamptz - interval '1 minute')`,
          [ctx.tenantId, agora.toISOString(), ctx.conector.credencial_id],
        ),
      );
    }
  }

  return { autenticar, antes, politicaDaRequisicao: (ctx) => politicas.get(ctx) };
}
