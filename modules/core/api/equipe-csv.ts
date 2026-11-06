/**
 * Equipe por CSV com convite de 1º acesso (T-0087, fatia E; RN-CORE-31; docs/modulos/core/equipe-csv.md).
 * Rotas `/v1/core/equipe/*` (`usuario.gerir`; o super-admin do portal entra por `superAdmin: 'aceita'` com `x-macuxi-tenant`):
 * - `modelo.csv`; `importacoes` (modo `conferir` valida sem gravar; `gravar` só grava se NÃO houver erro, tudo numa transação);
 * - idempotente pelo e-mail; a árvore sai do `email_superior` (cada superior ganha uma equipe que ele responde; o subordinado
 *   entra nela); ordem gerentes → supervisores → campo; módulos por exceção do usuário (só remove) com evento
 *   `core.usuario.modulos_alterados@1`; quantidade licenciada por módulo e regra 7 conferidas no `domain`;
 * - sem senha no CSV: cada usuário novo nasce sem senha e recebe um convite (token só na resposta; no banco, o SHA-256);
 * - LGPD: o CSV não é guardado; nada de nome, e-mail, telefone ou token em log ou auditoria (só ids, perfil e contagens).
 * Nunca grava `ctx.usuario.id` em coluna com FK (o super-admin não é usuário do tenant).
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, PERFIS, ehModulo, type ClienteBanco, type ContextoBase, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import {
  CODIGOS_EQUIPE_CSV,
  EVENTO_MODULOS_ALTERADOS,
  ImportarEquipeRequestSchema,
  RenovarConviteRequestSchema,
  UsuarioConviteParamsSchema,
  type ConviteEmitido,
  type ImportarEquipeResposta,
} from '../contracts';
import {
  conferirImportacaoDeEquipe,
  convitesParaCsv,
  errosParaCsv,
  lerCsvDeEquipe,
  modeloCsvDeEquipe,
  montarHierarquia,
  prazoDoConvite,
  type ContextoImportacao,
  type PlanoUsuarioEquipe,
  type UsuarioExistente,
} from '../domain';
import { novoConvite } from './seguranca-convite';

type Tx = Parameters<Parameters<ContextoBase['comTenant']>[0]>[1];
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const MSG_CONCORRENCIA = 'Outra pessoa gravou o mesmo e-mail ou código do ERP ao mesmo tempo. Confira o arquivo e envie de novo.';

interface Estado {
  existentes: UsuarioExistente[];
  contexto: ContextoImportacao;
  removidos: Map<string, Set<string>>;
  grants: Map<string, Set<string>>;
}

/** Foto do tenant para a conferência: usuários, hierarquia, licenças do tenant e dos perfis, exceções por usuário. */
async function lerEstado(db: ClienteBanco): Promise<Estado> {
  const us = (await db.query<{ id: string; email: string; nome: string; perfil: Perfil; external_id: string | null; ativo: boolean; equipe_id: string | null; telefone: string | null }>(
    'select id, email, nome, perfil, external_id, ativo, equipe_id, telefone from core.usuario where deleted_at is null',
  )).rows;
  const equipes = (await db.query<{ id: string; equipe_pai_id: string | null; responsavel_id: string | null }>(
    'select id, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo',
  )).rows;
  const tenantRows = (await db.query<{ modulo: string; licencas: number | null }>('select modulo, licencas from plataforma.tenant_modulo where ativo and deleted_at is null')).rows;
  const perfilRows = (await db.query<{ perfil: Perfil; modulo: string }>('select perfil, modulo from plataforma.perfil_modulo where deleted_at is null')).rows;
  const remRows = (await db.query<{ usuario_id: string; modulo: string }>("select usuario_id, modulo from plataforma.usuario_modulo where efeito = 'remover' and deleted_at is null")).rows;

  const tenant = new Set<string>(['core', ...tenantRows.map((t) => t.modulo)]);
  const modulosDoPerfil: Partial<Record<Perfil, string[]>> = {};
  for (const p of PERFIS) modulosDoPerfil[p] = [];
  for (const r of perfilRows) modulosDoPerfil[r.perfil]?.push(r.modulo);
  const removidos = new Map<string, Set<string>>();
  for (const r of remRows) removidos.set(r.usuario_id, (removidos.get(r.usuario_id) ?? new Set()).add(r.modulo));

  const hier = montarHierarquia(equipes, us.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, equipe_id: u.equipe_id, ativo: u.ativo })));
  const emailDe = new Map(us.map((u) => [u.id, u.email.toLowerCase()]));
  const superiorDe = new Map(hier.map((m) => [m.id, m.superior_id ? (emailDe.get(m.superior_id) ?? null) : null]));

  const grants = new Map<string, Set<string>>();
  const existentes: UsuarioExistente[] = us.map((u) => {
    const g = new Set<string>(['core', ...(modulosDoPerfil[u.perfil] ?? []).filter((m) => tenant.has(m))]);
    grants.set(u.id, g);
    const rem = removidos.get(u.id) ?? new Set<string>();
    return { id: u.id, email: u.email, nome: u.nome, perfil: u.perfil, external_id: u.external_id, ativo: u.ativo, telefone: u.telefone, modulos: [...g].filter((m) => !rem.has(m)), superior_email: superiorDe.get(u.id) ?? null };
  });
  const emUso: Record<string, number> = {};
  for (const u of existentes) if (u.ativo) for (const m of u.modulos) emUso[m] = (emUso[m] ?? 0) + 1;
  const limites: Record<string, number> = {};
  for (const t of tenantRows) if (t.licencas !== null && t.modulo !== 'core') limites[t.modulo] = t.licencas;
  return { existentes, removidos, grants, contexto: { existentes, modulosDoTenant: [...tenant], modulosDoPerfil, limites, emUso } };
}

const caminhoDoConvite = (token: string): string => `/convite#${token}`;
const linkDoConvite = (origem: string | undefined, token: string): string | null => (origem ? `${new URL(origem).origin}${caminhoDoConvite(token)}` : null);

/** Quem gerou o convite: admin do tenant ou super-admin do portal (colunas sem FK, 0036). */
const autorDoConvite = (ctx: ContextoBase): [string, string] => (ctx.superAdmin ? [ctx.superAdmin.id, 'super_admin'] : [ctx.usuario.id, 'usuario']);

async function gravarConvite(db: ClienteBanco, tenantId: string, usuarioId: string, agora: Date, autor: [string, string]): Promise<{ token: string; expira: Date }> {
  const { token, hash } = novoConvite(tenantId);
  const expira = prazoDoConvite(agora);
  await db.query('insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em, criado_por_id, criado_por_tipo) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5)', [usuarioId, hash, expira.toISOString(), autor[0], autor[1]]);
  return { token, expira };
}

/** Equipe que o superior responde: reaproveita a que existe; senão cria "Equipe de <nome>" sob a equipe dele. */
async function equipeDoSuperior(db: ClienteBanco, superiorId: string, cache: Map<string, string>): Promise<string> {
  const c = cache.get(superiorId);
  if (c) return c;
  const ja = (await db.query<{ id: string }>('select id from core.equipe where responsavel_id = $1 and deleted_at is null and ativo order by created_at, id limit 1', [superiorId])).rows[0];
  let id = ja?.id;
  if (!id) {
    const u = (await db.query<{ nome: string; equipe_id: string | null }>('select nome, equipe_id from core.usuario where id = $1', [superiorId])).rows[0];
    id = (
      await db.query<{ id: string }>(
        'insert into core.equipe (tenant_id, nome, equipe_pai_id, responsavel_id) values (plataforma.tenant_atual(), $1, $2, $3) returning id',
        [`Equipe de ${(u?.nome ?? 'responsável').slice(0, 180)}`, u?.equipe_id ?? null, superiorId],
      )
    ).rows[0]!.id;
  }
  cache.set(superiorId, id);
  return id;
}

async function sincronizarModulos(db: ClienteBanco, tx: Tx, p: PlanoUsuarioEquipe, usuarioId: string, est: Estado): Promise<void> {
  const atuais = est.removidos.get(usuarioId) ?? new Set<string>();
  const grants = est.grants.get(usuarioId) ?? new Set<string>(); // usuário novo: nenhuma remoção anterior
  const desejados = new Set(p.modulos_removidos.filter((m) => m !== 'core'));
  const mudar = async (modulo: string, ativo: boolean) => {
    if (!ehModulo(modulo)) return;
    await tx.publicar(EVENTO_MODULOS_ALTERADOS, { nivel: 'usuario', modulo: modulo as ModuloId, ativo, perfil: null, usuario_id: usuarioId }, usuarioId);
  };
  for (const m of desejados) {
    if (atuais.has(m)) continue;
    await db.query("insert into plataforma.usuario_modulo (tenant_id, usuario_id, modulo, efeito) values (plataforma.tenant_atual(), $1, $2, 'remover')", [usuarioId, m]);
    await mudar(m, false);
  }
  for (const m of atuais) {
    if (desejados.has(m) || !(grants.size === 0 || grants.has(m))) continue;
    await db.query("update plataforma.usuario_modulo set deleted_at = now() where usuario_id = $1 and modulo = $2 and efeito = 'remover' and deleted_at is null", [usuarioId, m]);
    await mudar(m, true);
  }
}

const vazio = (modo: 'conferir' | 'gravar'): Pick<ImportarEquipeResposta, 'modo' | 'convites' | 'convites_csv'> => ({ modo, convites: [], convites_csv: '' });

export const rotasDeEquipeCsv: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'equipe/modelo.csv',
    acao: 'usuario.gerir',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    tipoConteudo: 'text/csv; charset=utf-8',
    nomeArquivo: 'modelo-equipe.csv',
    executar: async () => modeloCsvDeEquipe(),
  },
  {
    metodo: 'POST',
    caminho: 'equipe/importacoes',
    acao: 'usuario.gerir',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    corpo: ImportarEquipeRequestSchema,
    limiteCorpoBytes: 2_500_000,
    executar: async (ctx): Promise<ImportarEquipeResposta> => {
      const { csv, modo, origem } = ctx.corpo;
      const lido = lerCsvDeEquipe(csv);
      if (!lido.ok) throw new ErroRegraNegocio(CODIGOS_EQUIPE_CSV.arquivoInvalido, lido.mensagem);
      const tenantId = ctx.usuario.tenant_id;
      try {
        return await ctx.comTenant(async (db, tx) => {
          await db.query("select pg_advisory_xact_lock(hashtext('equipe_csv:' || plataforma.tenant_atual()::text))");
          const est = await lerEstado(db);
          const r = conferirImportacaoDeEquipe(lido.linhas, est.contexto);
          const base = {
            resumo: r.resumo,
            erros: r.erros,
            avisos: r.avisos,
            plano: r.plano.map((p) => ({ linha: p.linha, acao: p.acao, usuario_id: p.usuario_id, email: p.email, nome: p.nome, perfil: p.perfil, superior_email: p.superior_email, external_id: p.external_id, modulos_removidos: p.modulos_removidos })),
            erros_csv: r.erros.length > 0 ? errosParaCsv(r.erros) : '',
          };
          if (modo === 'conferir' || r.erros.length > 0) return { ...vazio(modo), ...base, gravado: false };

          // gravar: ordem do plano (gerentes → supervisores → campo), numa transação só
          const idPorEmail = new Map(est.existentes.map((u) => [u.email.toLowerCase(), u.id]));
          const equipes = new Map<string, string>();
          const convites: ConviteEmitido[] = [];
          const agora = ctx.agora();
          for (const p of r.plano) {
            if (p.acao === 'sem_mudanca') continue;
            const superiorId = p.superior_email ? (idPorEmail.get(p.superior_email) ?? null) : null;
            const equipeId = superiorId ? await equipeDoSuperior(db, superiorId, equipes) : null;
            let id = p.usuario_id;
            if (p.acao === 'criar') {
              id = (
                await db.query<{ id: string }>(
                  `insert into core.usuario (tenant_id, nome, email, perfil, equipe_id, senha_hash, ativo, external_id, telefone)
                   values (plataforma.tenant_atual(), $1, $2, $3, $4, null, true, $5, $6) returning id`,
                  [p.nome, p.email, p.perfil, equipeId, p.external_id, p.telefone],
                )
              ).rows[0]!.id;
              idPorEmail.set(p.email, id);
              const { token, expira } = await gravarConvite(db, tenantId, id, agora, autorDoConvite(ctx));
              convites.push({ usuario_id: id, nome: p.nome, email: p.email, perfil: p.perfil, caminho: caminhoDoConvite(token), link: linkDoConvite(origem, token), expira_em: expira.toISOString() });
              await tx.auditar({ acao: 'usuario.convidar', entidade: 'usuario', entidade_id: id, antes: null, depois: { perfil: p.perfil, equipe_id: equipeId, origem: 'csv', senha_definida: false } });
            } else {
              // RN-CORE-04: quem responde por equipe leva a equipe junto ao trocar de superior (o escopo é a árvore de equipes)
              if (equipeId) {
                const movidas = await db.query<{ id: string }>(
                  'update core.equipe set equipe_pai_id = $2 where responsavel_id = $1 and deleted_at is null and ativo and id <> $2 and equipe_pai_id is distinct from $2 returning id',
                  [id, equipeId],
                );
                for (const m of movidas.rows) await tx.auditar({ acao: 'equipe.mover', entidade: 'equipe', entidade_id: m.id, antes: null, depois: { equipe_pai_id: equipeId, origem: 'csv' } });
              }
              await db.query('update core.usuario set nome = $2, external_id = $3, equipe_id = coalesce($4::uuid, equipe_id), telefone = coalesce($5, telefone) where id = $1', [id, p.nome, p.external_id, equipeId, p.telefone]);
              await tx.auditar({ acao: 'usuario.editar', entidade: 'usuario', entidade_id: id, antes: null, depois: { origem: 'csv', equipe_id: equipeId } });
            }
            await sincronizarModulos(db, tx, p, id as string, est);
          }
          await tx.auditar({ acao: 'equipe.importar_csv', entidade: 'equipe', entidade_id: null, antes: null, depois: { ...r.resumo } });
          ctx.log.info({ tenant_id: tenantId, ...r.resumo }, 'equipe importada por csv');
          return {
            ...base,
            modo,
            gravado: true,
            convites,
            convites_csv: convitesParaCsv(convites.map((c) => ({ nome: c.nome, email: c.email, perfil: c.perfil, link: c.link ?? c.caminho, expira_em: c.expira_em }))),
          };
        });
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new ErroHttpModulo(409, 'EQUIPE_CSV_CONCORRENCIA', MSG_CONCORRENCIA);
        throw e;
      }
    },
  },
  {
    metodo: 'GET',
    caminho: 'equipe/convites',
    acao: 'usuario.gerir',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        // sem o token: ele só existe na resposta que o criou ou renovou
        const r = await db.query<{ usuario_id: string; nome: string; email: string; perfil: Perfil; expira_em: string; vencido: boolean }>(
          `select c.usuario_id, u.nome, u.email, u.perfil, to_char(c.expira_em at time zone 'UTC', ${ISO}) as expira_em, (c.expira_em <= now()) as vencido
             from core.usuario_convite c join core.usuario u on u.id = c.usuario_id and u.deleted_at is null
            where c.usado_em is null and c.revogado_em is null and c.deleted_at is null and u.senha_hash is null
            order by u.nome, c.id limit 5000`,
        );
        return { itens: r.rows };
      }),
  },
  {
    metodo: 'POST',
    caminho: 'equipe/convites/:usuario_id/renovar',
    acao: 'usuario.gerir',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    params: UsuarioConviteParamsSchema,
    corpo: RenovarConviteRequestSchema,
    executar: async (ctx): Promise<ConviteEmitido> =>
      ctx.comTenant(async (db, tx) => {
        const id = ctx.params.usuario_id;
        const u = (await db.query<{ nome: string; email: string; perfil: Perfil; ativo: boolean; senha_hash: string | null }>('select nome, email, perfil, ativo, senha_hash from core.usuario where id = $1 and deleted_at is null for update', [id])).rows[0];
        if (!u) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
        if (!u.ativo) throw new ErroRegraNegocio(CODIGOS_EQUIPE_CSV.usuarioSemConvite, 'Esta pessoa está desativada. Ative o usuário em Usuários antes de enviar um novo convite.');
        if (u.senha_hash) throw new ErroRegraNegocio(CODIGOS_EQUIPE_CSV.usuarioSemConvite, 'Esta pessoa já criou a senha e entra normalmente. Para trocar a senha, use "Redefinir senha" em Usuários.');
        await db.query('update core.usuario_convite set revogado_em = now() where usuario_id = $1 and usado_em is null and revogado_em is null', [id]);
        const { token, expira } = await gravarConvite(db, ctx.usuario.tenant_id, id, ctx.agora(), autorDoConvite(ctx));
        await tx.auditar({ acao: 'usuario.convidar', entidade: 'usuario', entidade_id: id, antes: null, depois: { renovado: true, senha_definida: false } });
        return { usuario_id: id, nome: u.nome, email: u.email, perfil: u.perfil, caminho: caminhoDoConvite(token), link: linkDoConvite(ctx.corpo.origem, token), expira_em: expira.toISOString() };
      }),
  },
];
