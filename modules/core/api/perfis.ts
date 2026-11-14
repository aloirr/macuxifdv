/**
 * Perfis de acesso no BKO (T-0111; ADR 0033; RN-CORE-01/04/33/35, RN-PRO-01; contrato `contracts/perfis.ts`). Escrita só com `perfil.gerir`
 * (no padrão, o admin). Tabelas da 0041: `plataforma.perfil`, `perfil_permissao` (só a diferença da fábrica; vazia = padrão), `usuario_perfil`.
 * Toda escrita trava as linhas, monta o estado do tenant (perfis + usuários) e roda `avaliarEstadoDePerfis` (os limites do SDK) antes de gravar;
 * a mesma regra existe no banco como rede de segurança. Auditoria `perfil.criar|alterar` (RN-AUD-01): antes/depois das sobreposições, sem dado pessoal.
 */
import { randomUUID } from 'node:crypto';
import {
  ErroNaoEncontrado,
  ErroRegraNegocio,
  escopoMaximoDaBase,
  matrizDeFabrica,
  PERFIS,
  podeEntrar,
  resolverPerfil,
  travaDaChave,
  type ClienteBanco,
  type ContextoBase,
  type DefinicaoChave,
  type MatrizFabrica,
  type NivelPermissao,
  type Perfil,
  type PerfilDeAcesso,
  type PermissoesDoPerfil,
  type RotaModulo,
  type SobreposicaoPermissao,
  type ValorPermissao,
} from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  ChaveDoPerfilSchema,
  CODIGO_REPETIDO,
  CODIGOS_PERFIL,
  MENSAGEM_PERFIL_REPETIDO,
  CriarPerfilRequestSchema,
  EditarPerfilRequestSchema,
  PerfilDetalheSchema,
  PerfilHistoricoQuerySchema,
  PerfilListaRespostaSchema,
  PerfilOpcoesRespostaSchema,
  PerfilResumoSchema,
  type PerfilDetalhe,
  type PerfilResumo,
  type ValorDaChave,
} from '../contracts';
import { cargoDaBase, type Cargo } from '@macuxi/platform-sdk';
import { avaliarEstadoDePerfis, codigoDoPerfil, diffAuditavelDePerfil, sobreposicoesDoDesejado, validarNomeDoPerfil } from '../domain';
import { auditar } from './auditoria';

/** Chaves básicas que a página nunca edita (os apps dependem delas) e o parâmetro que virou `pedido.ver` (spec §5.13). */
const FORA_DA_TELA = new Set(['notificacao.ler', 'dispositivo.registrar_push', 'parametro.promotor_ve_pedidos']);

interface LinhaPerfil {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  base: Perfil;
  fabrica: boolean;
  ativo: boolean;
  /** 0069: NOT NULL no banco; sem a coluna (leitura antiga), vale o cargo da base. */
  cargo?: Cargo | null;
}
interface LinhaPermissao {
  perfil_id: string;
  chave: string;
  concedida: boolean;
  nivel: NivelPermissao | null;
  alvos: string[] | null;
}

export const motorDe = (ctx: ContextoBase): { catalogo: readonly DefinicaoChave[]; matriz: MatrizFabrica } => ctx.permissoes ?? { catalogo: [], matriz: matrizDeFabrica([]) };

const sobreposicaoDe = (l: LinhaPermissao): SobreposicaoPermissao => ({
  chave: l.chave,
  concedida: l.concedida,
  ...(l.nivel ? { nivel: l.nivel } : {}),
  ...(l.alvos ? { alvos: l.alvos } : {}),
});

interface Carga {
  linhas: LinhaPerfil[];
  perfis: PerfilDeAcesso[];
  usuarios: { id: string; ativo: boolean; perfis: string[] }[];
}

/** Perfis vivos com as sobreposições e os usuários com seus perfis. `travar` = `for update` nos perfis (escrita). */
export async function carregar(db: ClienteBanco, travar: boolean): Promise<Carga> {
  const lock = travar ? ' for update' : '';
  const ps = await db.query<LinhaPerfil>(`select id, codigo, nome, descricao, base, fabrica, ativo, cargo from plataforma.perfil where deleted_at is null order by codigo${lock}`);
  const sobre = await db.query<LinhaPermissao>('select perfil_id, chave, concedida, nivel, alvos from plataforma.perfil_permissao where deleted_at is null order by chave');
  const us = await db.query<{ id: string; ativo: boolean; perfis: string[] }>(
    `select u.id, u.ativo, coalesce(array_agg(p.codigo order by p.codigo) filter (where p.codigo is not null), '{}') as perfis
       from core.usuario u
       left join plataforma.usuario_perfil up on up.usuario_id = u.id and up.deleted_at is null
       left join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
      where u.deleted_at is null group by u.id, u.ativo order by u.id`,
  );
  const porId = new Map<string, SobreposicaoPermissao[]>();
  for (const s of sobre.rows) porId.set(s.perfil_id, [...(porId.get(s.perfil_id) ?? []), sobreposicaoDe(s)]);
  const perfis: PerfilDeAcesso[] = ps.rows.map((p) => ({ codigo: p.codigo, base: p.base, ativo: p.ativo, fabrica: p.fabrica, sobreposicoes: porId.get(p.id) ?? [] }));
  return { linhas: ps.rows, perfis, usuarios: us.rows };
}

const naoEncontrado = () => new ErroNaoEncontrado(CODIGOS_PERFIL.naoEncontrado, 'Este perfil não existe mais.');

const LUGARES = ['campo', 'gestao', 'bko', 'portal'] as const;

function resumoDe(l: LinhaPerfil, p: PerfilDeAcesso, matriz: MatrizFabrica, usuarios: number): PerfilResumo {
  const r = resolverPerfil(p, matriz);
  return PerfilResumoSchema.parse({ codigo: l.codigo, nome: l.nome, descricao: l.descricao, base: l.base, fabrica: l.fabrica, ativo: l.ativo, usuarios, onde_entra: LUGARES.filter((x) => podeEntrar([r], x)), cargo: cargoDe(l) });
}

const cargoDe = (l: LinhaPerfil): Cargo => l.cargo ?? cargoDaBase(l.base);

const valorDe = (v: ValorPermissao | undefined): ValorDaChave => ({ concedida: !!v, nivel: v?.nivel ?? null, alvos: v?.alvos ? [...v.alvos] : null });

const ordemDaBase = (b: Perfil) => PERFIS.indexOf(b);

function detalheDe(ctx: ContextoBase, c: Carga, codigo: string, modulos: string[]): PerfilDetalhe {
  const { catalogo, matriz } = motorDe(ctx);
  const i = c.linhas.findIndex((l) => l.codigo === codigo);
  const linha = c.linhas[i];
  const perfil = c.perfis[i];
  if (!linha || !perfil) throw naoEncontrado();
  const resolvido = resolverPerfil(perfil, matriz);
  const contagem = c.usuarios.filter((u) => u.perfis.includes(codigo)).length;
  const chaves = catalogo
    .filter((d) => !FORA_DA_TELA.has(d.chave))
    .map((d) =>
      ChaveDoPerfilSchema.parse({
        chave: d.chave,
        area: d.area,
        modulo: d.modulo,
        descricao: d.descricao,
        nivel: d.nivel ?? null,
        alvos: d.alvos === true,
        fabrica: valorDe(matriz[perfil.base][d.chave]),
        atual: valorDe(resolvido.permissoes[d.chave]),
        trava: travaDaChave(perfil.base, d.chave),
      }),
    );
  return PerfilDetalheSchema.parse({
    perfil: resumoDe(linha, perfil, matriz, contagem),
    chaves,
    alvos_possiveis: c.linhas.filter((l) => l.ativo).map((l) => ({ codigo: l.codigo, nome: l.nome, base: l.base, fabrica: l.fabrica, onde_entra: [], cargo: cargoDe(l) })),
    escopo_maximo: escopoMaximoDaBase(perfil.base),
    modulos,
  });
}

const modulosDoPerfil = async (db: ClienteBanco, codigo: string): Promise<string[]> =>
  (await db.query<{ modulo: string }>('select modulo from plataforma.perfil_modulo where perfil = $1 and deleted_at is null order by modulo', [codigo])).rows.map((r) => r.modulo);

function recusar(violacoes: { codigo: string; regra: string; mensagem: string; perfil?: string; chave?: string }[]): never {
  const v = violacoes[0]!;
  throw new ErroRegraNegocio(v.codigo, v.mensagem, {
    regra: v.regra,
    violacoes: violacoes.slice(0, 5).map(({ codigo, regra, mensagem, perfil, chave }) => ({ codigo, regra, mensagem, perfil, chave })),
  });
}

function conferir(ctx: ContextoBase, antes: Carga, depoisPerfis: PerfilDeAcesso[]): void {
  const { catalogo, matriz } = motorDe(ctx);
  const r = avaliarEstadoDePerfis({
    atorId: ctx.usuario.id,
    antes: { perfis: antes.perfis, usuarios: antes.usuarios },
    depois: { perfis: depoisPerfis, usuarios: antes.usuarios },
    matriz,
    catalogo: catalogo.length > 0 ? catalogo : undefined,
  });
  if (!r.ok) recusar(r.violacoes);
}

async function gravarSobreposicoes(db: ClienteBanco, perfilId: string, sobre: readonly SobreposicaoPermissao[]): Promise<void> {
  await db.query('delete from plataforma.perfil_permissao where perfil_id = $1', [perfilId]);
  for (const s of sobre) {
    await db.query(
      'insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5)',
      [perfilId, s.chave, s.concedida, s.concedida ? (s.nivel ?? null) : null, s.concedida && s.alvos ? [...s.alvos] : null],
    );
  }
}

const dadosInvalidos = (mensagem: string, campo: string) => new ErroRegraNegocio(CODIGOS_PERFIL.dadosInvalidos, mensagem, { campos: [{ campo, mensagem }] });
const CodigoParam = z.object({ codigo: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/) });

export const rotasDePerfis: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'perfis',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const c = await carregar(db, false);
        const { matriz } = motorDe(ctx);
        const itens = c.linhas
          .map((l, i) => resumoDe(l, c.perfis[i]!, matriz, c.usuarios.filter((u) => u.perfis.includes(l.codigo)).length))
          .sort((a, b) => Number(!a.ativo) - Number(!b.ativo) || Number(!a.fabrica) - Number(!b.fabrica) || (a.fabrica ? ordemDaBase(a.base) - ordemDaBase(b.base) : a.nome.localeCompare(b.nome, 'pt-BR')));
        return PerfilListaRespostaSchema.parse({ itens });
      }),
  },
  {
    // Cadastro de usuário: quem cria ou edita usuário precisa ver os perfis ativos (nome e base; sem permissões)
    metodo: 'GET',
    caminho: 'perfis/opcoes',
    superficie: 'bko',
    acao: 'usuario.ver',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const c = await carregar(db, false);
        const { matriz } = motorDe(ctx);
        const ativos = c.linhas
          .map((l, i) => ({ l, p: c.perfis[i]! }))
          .filter(({ l }) => l.ativo)
          .map(({ l, p }) => ({ codigo: l.codigo, nome: l.nome, base: l.base, fabrica: l.fabrica, onde_entra: resumoDe(l, p, matriz, 0).onde_entra, cargo: cargoDe(l) }));
        ativos.sort((a, b) => Number(!a.fabrica) - Number(!b.fabrica) || (a.fabrica ? ordemDaBase(a.base) - ordemDaBase(b.base) : a.nome.localeCompare(b.nome, 'pt-BR')));
        return PerfilOpcoesRespostaSchema.parse({ itens: ativos });
      }),
  },
  {
    metodo: 'GET',
    caminho: 'perfis/:codigo',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    params: CodigoParam,
    executar: async (ctx) => ctx.comTenant(async (db) => detalheDe(ctx, await carregar(db, false), ctx.params.codigo, await modulosDoPerfil(db, ctx.params.codigo))),
  },
  {
    metodo: 'POST',
    caminho: 'perfis',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: CriarPerfilRequestSchema,
    executar: async (ctx) => {
      const { base, copiar_de, cargo } = ctx.corpo;
      const nome = ctx.corpo.nome.trim();
      const descricao = ctx.corpo.descricao?.trim() || null;
      const erros = validarNomeDoPerfil(nome, descricao);
      if (erros[0]) throw dadosInvalidos(erros[0].mensagem, erros[0].campo);
      return ctx.comTenant(async (db) => {
        const c = await carregar(db, true);
        if (c.linhas.some((l) => l.ativo && l.nome.toLowerCase() === nome.toLowerCase())) throw new ErroRegraNegocio(CODIGO_REPETIDO, MENSAGEM_PERFIL_REPETIDO, { regra: 'RN-CORE-35' });
        const origem = copiar_de ? c.perfis.find((p) => p.codigo === copiar_de) : undefined;
        if (copiar_de && (!origem || origem.base !== base)) throw dadosInvalidos('Escolha o perfil base.', 'base');
        // o código é único entre TODOS os perfis, apagados inclusive: confere também os que saíram
        const usados = new Set((await db.query<{ codigo: string }>('select codigo from plataforma.perfil')).rows.map((r) => r.codigo));
        const raiz = codigoDoPerfil(nome);
        let codigo = raiz;
        for (let n = 2; usados.has(codigo); n++) codigo = `${raiz.slice(0, 36)}_${n}`;
        const sobre = origem ? origem.sobreposicoes : [];
        const novo: PerfilDeAcesso = { codigo, base, ativo: true, fabrica: false, sobreposicoes: sobre };
        conferir(ctx, c, [...c.perfis, novo]);
        const id = randomUUID();
        await db.query(
          'insert into plataforma.perfil (id, tenant_id, codigo, nome, descricao, base, fabrica, ativo, cargo) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, false, true, $6)',
          [id, codigo, nome, descricao, base, cargo],
        );
        await gravarSobreposicoes(db, id, sobre);
        await db.query(
          `insert into plataforma.perfil_modulo (tenant_id, perfil, modulo)
           select plataforma.tenant_atual(), $1, modulo from plataforma.perfil_modulo where perfil = $2 and deleted_at is null`,
          [codigo, origem?.codigo ?? base],
        );
        await auditar(db, ctx, { acao: 'perfil.criar', entidade: 'perfil', entidadeId: id, antes: null, depois: { codigo, nome, base, cargo, copiado_de: origem?.codigo ?? null, sobreposicoes: sobre } });
        return detalheDe(ctx, await carregar(db, false), codigo, await modulosDoPerfil(db, codigo));
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'perfis/:codigo',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    params: CodigoParam,
    corpo: EditarPerfilRequestSchema,
    executar: async (ctx) => {
      const c0 = ctx.corpo;
      return ctx.comTenant(async (db) => {
        const c = await carregar(db, true);
        const i = c.linhas.findIndex((l) => l.codigo === ctx.params.codigo);
        const linha = c.linhas[i];
        const atual = c.perfis[i];
        if (!linha || !atual) throw naoEncontrado();
        const { matriz } = motorDe(ctx);
        // nome e situação dos 7 padrão não mudam (spec §5.1); o resto da identificação vale só para os personalizados
        const nome = linha.fabrica ? linha.nome : (c0.nome ?? linha.nome).trim();
        const descricao = c0.descricao === undefined ? linha.descricao : c0.descricao?.trim() || null;
        const ativo = linha.fabrica ? true : (c0.ativo ?? linha.ativo);
        const erros = validarNomeDoPerfil(nome, descricao);
        if (erros[0]) throw dadosInvalidos(erros[0].mensagem, erros[0].campo);
        if (!linha.fabrica && c.linhas.some((l) => l.id !== linha.id && l.ativo && l.nome.toLowerCase() === nome.toLowerCase())) {
          throw new ErroRegraNegocio(CODIGO_REPETIDO, MENSAGEM_PERFIL_REPETIDO, { regra: 'RN-CORE-35' });
        }
        const fabrica = matriz[atual.base];
        const desejado: Record<string, ValorPermissao> = {};
        for (const p of c0.permissoes) {
          const nivel = p.nivel ?? fabrica[p.chave]?.nivel;
          const alvos = p.alvos ?? fabrica[p.chave]?.alvos;
          desejado[p.chave] = { ...(nivel ? { nivel } : {}), ...(alvos ? { alvos: [...alvos] } : {}) };
        }
        // as chaves que a página não mostra (FORA_DA_TELA) ficam como estão: não vêm no corpo e não podem virar revogação
        const vigente = resolverPerfil(atual, matriz).permissoes;
        for (const chave of FORA_DA_TELA) {
          if (vigente[chave]) desejado[chave] = vigente[chave];
          else delete desejado[chave];
        }
        const sobre = sobreposicoesDoDesejado(atual.base, desejado as PermissoesDoPerfil, matriz);
        const depois: PerfilDeAcesso = { ...atual, ativo, sobreposicoes: sobre };
        conferir(ctx, c, c.perfis.map((p, k) => (k === i ? depois : p)));
        const diff = diffAuditavelDePerfil({ nome: linha.nome, descricao: linha.descricao, ativo: linha.ativo, sobreposicoes: atual.sobreposicoes }, { nome, descricao, ativo, sobreposicoes: sobre });
        if (diff.campos_alterados.length > 0) {
          await db.query('update plataforma.perfil set nome = $2, descricao = $3, ativo = $4 where id = $1', [linha.id, nome, descricao, ativo]);
          if (diff.campos_alterados.includes('sobreposicoes')) await gravarSobreposicoes(db, linha.id, sobre);
          await auditar(db, ctx, { acao: 'perfil.alterar', entidade: 'perfil', entidadeId: linha.id, antes: { codigo: linha.codigo, ...diff.antes }, depois: { codigo: linha.codigo, ...diff.depois } });
        }
        return detalheDe(ctx, await carregar(db, false), linha.codigo, await modulosDoPerfil(db, linha.codigo));
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'perfis/:codigo/historico',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    params: CodigoParam,
    query: PerfilHistoricoQuerySchema,
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const p = await db.query<{ id: string }>('select id from plataforma.perfil where codigo = $1 and deleted_at is null', [ctx.params.codigo]);
        if (!p.rows[0]) throw naoEncontrado();
        const { antes, limite } = ctx.query;
        const r = await db.query<{ id: string; em: string; usuario_nome: string | null; acao: string; antes: unknown; depois: unknown }>(
          `select a.id, to_char(a.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as em, u.nome as usuario_nome, a.acao, a.antes, a.depois
             from plataforma.auditoria a left join core.usuario u on u.id = a.usuario_id
            where a.modulo = 'core' and a.entidade = 'perfil' and a.entidade_id = $1 and ($2::timestamptz is null or a.ocorrido_em < $2::timestamptz)
            order by a.ocorrido_em desc, a.id desc limit $3`,
          [p.rows[0].id, antes ?? null, limite + 1],
        );
        const itens = r.rows.slice(0, limite);
        return { itens, proximo: r.rows.length > limite ? (itens[itens.length - 1]?.em ?? null) : null };
      }),
  },
];
