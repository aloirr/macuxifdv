/**
 * Equipe por CSV (T-0087, fatia E; T-0094 sem convite: RN-CORE-31/34; docs/modulos/core/equipe-csv.md).
 * Rotas `/v1/core/equipe/*` (`usuario.criar`, e `usuario.editar` para atualizar quem já existe; o super-admin do portal entra por `superAdmin: 'aceita'` com `x-macuxi-tenant`):
 * - `modelo.csv`; `importacoes` (modo `conferir` valida sem gravar; `gravar` só grava se NÃO houver erro, tudo numa transação);
 * - idempotente pelo e-mail; a árvore sai do `email_superior` (cada superior ganha uma equipe que ele responde; o subordinado
 *   entra nela); ordem gerentes → supervisores → campo; módulos por exceção do usuário (só remove) com evento
 *   `core.usuario.modulos_alterados@1`; quantidade licenciada por módulo e regra 7 conferidas no `domain`;
 * - sem senha no CSV: cada usuário novo nasce com uma senha temporária gerada pelo servidor (72 h, `trocar_senha`), enviada só por
 *   e-mail na mesma transação do lote (se o lote desfaz, nenhum e-mail sai). Sem e-mail configurado e com gente nova, `gravar`
 *   responde 503 `EMAIL_INDISPONIVEL` ANTES de gravar (ninguém conheceria as senhas); `conferir` funciona sempre;
 * - LGPD: o CSV não é guardado; nada de nome, e-mail, telefone ou senha em log ou auditoria (só ids, perfil e contagens).
 * Nunca grava `ctx.usuario.id` em coluna com FK (o super-admin não é usuário do tenant).
 */
import { randomBytes } from 'node:crypto';
import { ErroHttpModulo, ErroRegraNegocio, PERFIS, ehModulo, exigirPermissao, type ClienteBanco, type ContextoBase, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import {
  CODIGOS_EQUIPE_CSV,
  EVENTO_MODULOS_ALTERADOS,
  ImportarEquipeRequestSchema,
  type ImportarEquipeResposta,
} from '../contracts';
import {
  SENHA_TEMPORARIA_HORAS,
  conferirImportacaoDeEquipe,
  errosParaCsv,
  gerarSenhaTemporaria,
  lerCsvDeEquipe,
  modeloCsvDeEquipe,
  montarHierarquia,
  validadeDaSenhaTemporaria,
  type ContextoImportacao,
  type PlanoUsuarioEquipe,
  type UsuarioExistente,
} from '../domain';
import { appsDoPerfil, emailDisponivel, empresaDoTenant, enviarEmail } from './email';
import { gravarFiliaisDoUsuario } from './filiais-usuario';
import { hashSenha } from './seguranca';
import { erroDaHierarquiaNoBanco } from './hierarquia-cadastro';
import { equipesAtivas } from './hierarquia-leitura';

type Tx = Parameters<Parameters<ContextoBase['comTenant']>[0]>[1];
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
  const equipes = await equipesAtivas(db);
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
  const filiais = (await db.query<{ id: string; codigo: string; external_id: string | null }>('select id, codigo, external_id from core.filial where deleted_at is null order by padrao desc, codigo, id')).rows;
  return { existentes, removidos, grants, contexto: { existentes, modulosDoTenant: [...tenant], modulosDoPerfil, limites, emUso, filiais } };
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

const vazio = (modo: 'conferir' | 'gravar'): Pick<ImportarEquipeResposta, 'modo' | 'acessos_enviados' | 'email_acesso'> => ({ modo, acessos_enviados: 0, email_acesso: null });

const MSG_SEM_EMAIL = 'O envio de e-mail não está configurado. Fale com o suporte da Macuxi.';

/** Hash das senhas temporárias em lotes paralelos (o argon2 roda no pool de threads; 5000 linhas em série seria minutos). */
async function hashesEmLotes(senhas: readonly string[]): Promise<string[]> {
  const saida: string[] = [];
  for (let i = 0; i < senhas.length; i += 8) saida.push(...(await Promise.all(senhas.slice(i, i + 8).map((x) => hashSenha(x)))));
  return saida;
}

export const rotasDeEquipeCsv: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'equipe/modelo.csv',
    acao: 'usuario.criar',
    superficie: 'bko',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    tipoConteudo: 'text/csv; charset=utf-8',
    nomeArquivo: 'modelo-equipe.csv',
    executar: async () => modeloCsvDeEquipe(),
  },
  {
    metodo: 'POST',
    caminho: 'equipe/importacoes',
    acao: 'usuario.criar',
    superficie: 'bko',
    superAdmin: 'aceita',
    carteira: 'nao_se_aplica',
    corpo: ImportarEquipeRequestSchema,
    limiteCorpoBytes: 2_500_000,
    executar: async (ctx): Promise<ImportarEquipeResposta> => {
      const { csv, modo } = ctx.corpo;
      const lido = lerCsvDeEquipe(csv);
      if (!lido.ok) throw new ErroRegraNegocio(CODIGOS_EQUIPE_CSV.arquivoInvalido, lido.mensagem);
      const tenantId = ctx.usuario.tenant_id;
      const semEmail = !emailDisponivel(ctx);
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
          // ADR 0033: criar já foi conferido pela rota (`usuario.criar`); atualizar quem existe exige `usuario.editar`
          if (r.plano.some((p) => p.acao !== 'criar' && p.acao !== 'sem_mudanca')) exigirPermissao(ctx.usuario, 'usuario.editar');
          const novos = r.plano.filter((p) => p.acao === 'criar');
          // RN-CORE-34: sem e-mail ninguém conheceria as senhas geradas — recusa ANTES de gravar qualquer coisa
          if (novos.length > 0 && semEmail) throw new ErroHttpModulo(503, CODIGOS_EQUIPE_CSV.emailIndisponivel, MSG_SEM_EMAIL);
          const empresa = novos.length > 0 ? await empresaDoTenant(db) : { nome: '', codigo: '' };
          const senhasNovas = new Map(novos.map((p) => [p.email, gerarSenhaTemporaria((n) => randomBytes(n))]));
          const hashes = new Map<string, string>();
          const emails = [...senhasNovas.keys()];
          (await hashesEmLotes(emails.map((e) => senhasNovas.get(e)!))).forEach((h, k) => hashes.set(emails[k]!, h));

          // gravar: ordem do plano (gerentes → supervisores → campo), numa transação só
          const idPorEmail = new Map(est.existentes.map((u) => [u.email.toLowerCase(), u.id]));
          const equipes = new Map<string, string>();
          let acessosEnviados = 0;
          const agora = ctx.agora();
          for (const p of r.plano) {
            if (p.acao === 'sem_mudanca') continue;
            const superiorId = p.superior_email ? (idPorEmail.get(p.superior_email) ?? null) : null;
            const equipeId = superiorId ? await equipeDoSuperior(db, superiorId, equipes) : null;
            let id = p.usuario_id;
            if (p.acao === 'criar') {
              id = (
                await db.query<{ id: string }>(
                  `insert into core.usuario (tenant_id, nome, email, perfil, equipe_id, senha_hash, trocar_senha, senha_expira_em, ativo, external_id, telefone)
                   values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, true, $6, true, $7, $8) returning id`,
                  [p.nome, p.email, p.perfil, equipeId, hashes.get(p.email), validadeDaSenhaTemporaria(agora), p.external_id, p.telefone],
                )
              ).rows[0]!.id;
              idPorEmail.set(p.email, id);
              // RN-CORE-39: a conferência já exigiu a filial; cadastro e venda gravados juntos (a de cadastro entra na de venda)
              await gravarFiliaisDoUsuario(db, id as string, p.filial_id as string, [p.filial_id as string]);
              await tx.auditar({ acao: 'usuario.filial_cadastro', entidade: 'usuario', entidade_id: id, antes: null, depois: { filial_cadastro_id: p.filial_id, origem: 'csv' } });
              const envio = await enviarEmail(ctx, db, {
                modelo: 'acesso_inicial',
                usuario_id: id,
                para: p.email,
                dados: { nome: p.nome, empresa_nome: empresa.nome, codigo_empresa: empresa.codigo, login: p.email, senha: senhasNovas.get(p.email)!, validade_horas: SENHA_TEMPORARIA_HORAS, apps: appsDoPerfil(p.perfil) },
                chave_idempotencia: `${id}:acesso`,
              });
              if (envio === 'enfileirado') acessosEnviados += 1;
              await tx.auditar({ acao: 'usuario.criar', entidade: 'usuario', entidade_id: id, antes: null, depois: { perfil: p.perfil, equipe_id: equipeId, origem: 'csv', trocar_senha: true, email: envio } });
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
            acessos_enviados: acessosEnviados,
            email_acesso: novos.length > 0 ? 'enfileirado' : null,
          };
        });
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new ErroHttpModulo(409, 'EQUIPE_CSV_CONCORRENCIA', MSG_CONCORRENCIA);
        // 0069: promotor sem gerente, ou com gerente que não é o do supervisor (23514 no COMMIT), vira 422 com a frase da tela
        throw erroDaHierarquiaNoBanco(e) ?? e;
      }
    },
  },
];
