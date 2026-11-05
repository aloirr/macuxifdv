/**
 * Rotas de sincronização da plataforma (doc 04 "Sincronização offline"; desenho T-0004 §5):
 *   GET  /v1/sync/pull?entidade=<nome>&cursor=<updated_at|id>  → { itens, proximo_cursor, versao_escopo?, horizonte }
 *   POST /v1/sync/push { itens }                                → { resultados } (um por item, na ordem)
 *
 * Pull — horizonte seguro: o módulo só devolve linhas com `updated_at < horizonte`, onde
 * `horizonte = least(now() - margem, início da transação aberta mais antiga)` (`BancoApp.horizonteSync`).
 * `updated_at` recebe o `now()` do INÍCIO da transação; sem o horizonte, uma transação longa que confirma depois
 * de um pull gravaria linhas atrás do cursor e o aparelho nunca as veria (desenho T-0002 §6 item 3).
 *
 * Push — RN-CORE-02: item de módulo inativo volta `rejeitado/MODULO_INATIVO` (o motor do app mostra "não enviado —
 * módulo desativado"), mesmo que a entidade ainda não tenha provedor (o dono vem do `sync` do manifesto — D-1);
 * RN-PRO-01: item de pedido enviado por promotor volta `rejeitado/RN-PRO-01`; só então `ENTIDADE_DESCONHECIDA`.
 * Pull de `pedido*` pelo promotor: permitido só se o manifesto lhe der `pedido.ver` (ADR 0004; doc 03 §2 "Ver pedidos",
 * O-3); o escopo de carteira (RN-CORE-04) é do provedor, como para todo perfil de escopo `carteira`.
 *
 * ADR 0009: a página leva `versao_escopo` (sha256 curto dos ids visíveis do `escopo` do provedor, calculado uma vez
 * por requisição) para o aparelho ressincronizar a entidade quando a carteira ou a equipe mudam (§4). Entidade de
 * módulo efetivo sem provedor: pull 501 e push `rejeitado/SYNC_NAO_IMPLEMENTADO`, que o motor trata como retentável (§7).
 *
 * D-3 (ADR 0009 §3): a página leva `horizonte` e o item aceito leva `em` (relógio do banco, lido DEPOIS dos provedores
 * gravarem). O aparelho mantém o item aceito sobreposto até um pull com `horizonte > em`: aí a linha já veio.
 *
 * ADR 0021: a página e as novidades levam `geracao_base` (`plataforma.tenant.geracao_base`, lida pela RLS do tenant da sessão);
 * banco sem a coluna = sem o campo. O aparelho que vê outra geração reenvia a fila, apaga a cópia local e puxa tudo.
 *
 * Novidades — RN-CORE-23 (ADR 0018): `GET /v1/sync/novidades?desde=<cursor>` → `{ entidades, cursor, horizonte,
 * modulos_mudaram, modulos? }`. Entidades elegíveis = as que o pull serviria ao usuário (módulo efetivo, provedor com
 * `puxar`, regra do promotor). Cursor ausente/ilegível, módulos efetivos (ou parâmetros) mudados ou carteira/equipe
 * mudada = todas as elegíveis; senão, cada provedor responde com `limite: 1` se tem linha visível com
 * `(updated_at, id) > (horizonte do cursor, NIL)` abaixo do horizonte atual. Sem mudança, o aparelho faz só esta requisição.
 */
import { createHash } from 'node:crypto';
import {
  ACAO_VER_PEDIDO,
  codificarCursor,
  codificarCursorNovidades,
  compararCursor,
  criarRegistroSync,
  decodificarCursor,
  decodificarCursorNovidades,
  ehEntidadeDePedido,
  ErroHttpModulo,
  MENSAGEM_ENVIO_INDISPONIVEL,
  NovidadesQuerySchema,
  PushRequestSchema,
  rejeitarItensInvalidos,
  SYNC_NAO_IMPLEMENTADO,
  TAMANHO_PAGINA_SYNC,
  UUID_NIL,
  type ContextoBase,
  type ItemPush,
  type LinhaSync,
  type NovidadesResposta,
  type PaginaSync,
  type ProvedorSync,
  type ResultadoItemPush,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import { respostaMeusModulos } from './me-modulos';
import type { Plataforma } from './tipos';

const PullQuerySchema = z.object({ entidade: z.string().min(1), cursor: z.string().optional() });

/** Hash curto (16 hex) do conjunto visível: muda quando entra ou sai um id; `'tenant'` tem versão própria. */
export function versaoDoConjunto(visiveis: ReadonlySet<string> | 'tenant'): string {
  const texto = visiveis === 'tenant' ? 'tenant' : [...visiveis].sort().join(',');
  return createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

const escoposDe = (prov: ProvedorSync) =>
  prov.escopo === undefined ? [] : typeof prov.escopo === 'string' ? [prov.escopo] : [...prov.escopo];

/** `versao_escopo` da página (ADR 0009 §4): só nos escopos que mudam no aparelho (`carteira`, `usuarios`). */
async function versaoEscopo(prov: ProvedorSync, ctx: ContextoBase): Promise<string | undefined> {
  return versaoDosEscopos(new Set(escoposDe(prov)), ctx);
}

/** Hash dos conjuntos `carteira`/`usuarios` presentes em `escopos` (ordem fixa); nenhum = `undefined`. */
async function versaoDosEscopos(escopos: ReadonlySet<string>, ctx: ContextoBase): Promise<string | undefined> {
  // ordem fixa (carteira, usuarios); `proprio` e `tenant` não mudam no aparelho e não entram
  const partes: string[] = [];
  if (escopos.has('carteira')) partes.push(versaoDoConjunto(await ctx.carteira()));
  if (escopos.has('usuarios')) partes.push(versaoDoConjunto(await ctx.usuariosVisiveis()));
  if (partes.length === 0) return undefined;
  if (partes.length === 1) return partes[0];
  return createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 16);
}

export function registrarSync(app: FastifyInstance, p: Plataforma): void {
  const provedores = new Map<string, ProvedorSync>();
  const registro = criarRegistroSync(p.manifestos);
  for (const m of p.modulos) {
    for (const prov of m.sync ?? []) {
      registro.registrar(prov.entidade);
      provedores.set(prov.entidade.nome, prov);
    }
  }

  app.get('/v1/sync/pull', async (req): Promise<PaginaSync<LinhaSync>> => {
    const q = PullQuerySchema.safeParse(req.query);
    if (!q.success) throw new ErroHttp(400, 'VALIDACAO', 'Informe a entidade do pull.');
    const prov = provedores.get(q.data.entidade);
    const dono = registro.dono(q.data.entidade) ?? null;
    const { ctx } = await p.preparar(req, dono);
    if (!dono)
      throw new ErroHttp(404, 'ENTIDADE_DESCONHECIDA', `Entidade ${q.data.entidade} não é sincronizada.`);
    if (!ctx.usuario.modulos.includes(dono)) {
      throw new ErroHttp(
        403,
        'MODULO_INATIVO',
        `O módulo ${dono} não está ativo para você. Fale com o administrador da sua empresa.`,
        { modulo: dono },
      );
    }
    // RN-PRO-01 + O-3: o promotor só puxa pedido* se o manifesto lhe der a leitura (pedido.ver); o provedor filtra a carteira
    const u = ctx.usuario;
    if (
      u.perfil === 'promotor' &&
      ehEntidadeDePedido(q.data.entidade) &&
      !p.permissoes.pode(ACAO_VER_PEDIDO, { perfil: u.perfil, modulosAtivos: u.modulos })
    ) {
      throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
    }
    if (!prov?.puxar)
      throw new ErroHttp(
        501,
        SYNC_NAO_IMPLEMENTADO,
        `O pull de ${q.data.entidade} ainda não está disponível no servidor.`,
      );
    const desde = q.data.cursor ? decodificarCursor(q.data.cursor) : null;
    if (q.data.cursor && !desde)
      throw new ErroHttp(400, 'CURSOR_INVALIDO', 'Cursor de sincronização inválido.');
    if (!p.banco)
      throw new ErroHttp(
        503,
        'BANCO_INDISPONIVEL',
        'Banco de dados indisponível. Tente de novo em instantes.',
      );
    const horizonte = await p.banco.horizonteSync();
    const ate = horizonte.toISOString();
    // o conjunto é lido antes das linhas (e o provedor reaproveita o mesmo, memorizado na requisição)
    const versao = await versaoEscopo(prov, ctx);
    const linhas = await prov.puxar(ctx, { desde, ate, limite: TAMANHO_PAGINA_SYNC + 1 });
    // defesa: mesmo que o módulo erre o SQL, nada acima do horizonte nem atrás do cursor sai daqui
    const limite = Date.parse(ate);
    const validas = linhas
      .filter((l) => Date.parse(l.updated_at) < limite && (!desde || compararCursor(l, desde) > 0))
      .sort(compararCursor);
    const itens = validas.slice(0, TAMANHO_PAGINA_SYNC);
    const ultimo = itens[itens.length - 1];
    const geracao = await p.banco.geracaoBase?.(ctx.usuario.tenant_id);
    return {
      itens,
      proximo_cursor: validas.length > TAMANHO_PAGINA_SYNC && ultimo ? codificarCursor(ultimo) : null,
      ...(versao !== undefined ? { versao_escopo: versao } : {}),
      horizonte: ate,
      ...(geracao ? { geracao_base: geracao } : {}),
    };
  });

  app.get('/v1/sync/novidades', async (req): Promise<NovidadesResposta> => {
    const q = NovidadesQuerySchema.safeParse(req.query);
    if (!q.success) throw new ErroHttp(400, 'VALIDACAO', 'Cursor de novidades inválido.');
    const { ctx, licencas, doModulo } = await p.preparar(req, null);
    if (!p.banco)
      throw new ErroHttp(503, 'BANCO_INDISPONIVEL', 'Banco de dados indisponível. Tente de novo em instantes.');
    const u = ctx.usuario;
    const verPedido = p.permissoes.pode(ACAO_VER_PEDIDO, { perfil: u.perfil, modulosAtivos: u.modulos });
    // as mesmas que o pull serviria: módulo efetivo, provedor com puxar e RN-PRO-01/O-3 para o promotor
    const elegiveis = [...provedores.values()]
      .filter((prov) => prov.puxar && u.modulos.includes(prov.entidade.modulo))
      .filter((prov) => !(u.perfil === 'promotor' && ehEntidadeDePedido(prov.entidade.nome) && !verPedido))
      .sort((a, b) => a.entidade.nome.localeCompare(b.entidade.nome));
    const ate = (await p.banco.horizonteSync()).toISOString();
    const modulos = respostaMeusModulos(p.manifestos, u.modulos, licencas.parametros, p.relogio());
    const escopo = (await versaoDosEscopos(new Set(elegiveis.flatMap(escoposDe)), ctx)) ?? null;
    const desde = decodificarCursorNovidades(q.data.desde);
    const modulosMudaram = !desde || desde.licencas !== modulos.versao_licencas;
    let entidades: string[];
    if (modulosMudaram || desde.escopo !== escopo) entidades = elegiveis.map((prov) => prov.entidade.nome);
    else {
      entidades = [];
      const de = Date.parse(desde.horizonte);
      const limite = Date.parse(ate);
      for (const prov of elegiveis) {
        const linhas = await prov.puxar!(doModulo(prov.entidade.modulo), {
          desde: { updated_at: desde.horizonte, id: UUID_NIL },
          ate,
          limite: 1,
        });
        const mudou = linhas.some((l) => {
          const t = Date.parse(l.updated_at);
          return t >= de && t < limite;
        });
        if (mudou) entidades.push(prov.entidade.nome);
      }
    }
    const geracao = await p.banco.geracaoBase?.(u.tenant_id);
    return {
      entidades,
      cursor: codificarCursorNovidades({ horizonte: ate, licencas: modulos.versao_licencas, escopo }),
      horizonte: ate,
      modulos_mudaram: modulosMudaram,
      ...(modulosMudaram ? { modulos } : {}),
      ...(geracao ? { geracao_base: geracao } : {}),
    };
  });

  app.post('/v1/sync/push', async (req): Promise<{ resultados: ResultadoItemPush[] }> => {
    // sessão ANTES do schema: sem login, o lote nem é validado (GHSA-mrhx-c7xc-m3w5; o teto de elementos é do createApp)
    const { ctx, doModulo } = await p.preparar(req, null);
    const corpo = PushRequestSchema.safeParse(req.body);
    if (!corpo.success)
      throw new ErroHttp(400, 'VALIDACAO', `Lote inválido (máx. 500 itens, id UUID do aparelho).`);
    const { validos, rejeitados } = rejeitarItensInvalidos(corpo.data, registro, ctx.usuario.modulos, {
      perfil: ctx.usuario.perfil,
    });
    const porId = new Map<string, ResultadoItemPush>(rejeitados.map((r) => [r.id, r]));
    const grupos = new Map<ProvedorSync, ItemPush[]>();
    for (const item of validos) {
      const prov = provedores.get(item.entidade)!;
      if (!prov.receber) {
        // ADR 0009 §7: entidade de escrita com provedor só de pull (ex.: pedido até a Sprint 4) — retentável no app
        porId.set(item.id, {
          id: item.id,
          status: 'rejeitado',
          codigo: SYNC_NAO_IMPLEMENTADO,
          mensagem: MENSAGEM_ENVIO_INDISPONIVEL,
        });
        continue;
      }
      grupos.set(prov, [...(grupos.get(prov) ?? []), item]);
    }
    for (const [prov, itens] of grupos) {
      try {
        for (const r of await prov.receber!(doModulo(prov.entidade.modulo), itens)) porId.set(r.id, r);
      } catch (e) {
        // 4xx do módulo (regra, não encontrado, conflito) rejeita os itens; 5xx/503: o motor tenta o lote de novo, na mesma ordem
        if (!(e instanceof ErroHttpModulo) || e.status >= 500) throw e;
        for (const i of itens)
          porId.set(i.id, { id: i.id, status: 'rejeitado', codigo: e.codigo, mensagem: e.message });
      }
    }
    // D-3: instante do banco depois de todas as gravações (updated_at = início de cada transação, sempre antes dele)
    const algumAceito = [...porId.values()].some((r) => r.status === 'aceito');
    const em = p.banco && algumAceito ? (await p.banco.instanteSync()).toISOString() : undefined;
    if (em) for (const [id, r] of porId) if (r.status === 'aceito') porId.set(id, { ...r, em });
    const resultados = corpo.data.itens.map(
      (i) =>
        porId.get(i.id) ?? {
          id: i.id,
          status: 'rejeitado' as const,
          codigo: 'SEM_RESULTADO',
          mensagem: 'O módulo não respondeu por este item.',
        },
    );
    return { resultados };
  });
}
