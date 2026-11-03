/**
 * Usuários no BKO (RF-CORE-02; T-0067). Leitura: supervisor/gerente (recortada pelo escopo, `usuariosVisiveis`, RN-CORE-04) e
 * admin (`usuario.ver`). Escrita só do admin (`usuario.gerir`; a API revalida). Nunca apaga: desativar põe `ativo = false`,
 * revoga as sessões e limpa o push; o acesso cai na próxima requisição porque `autenticar` confere `ativo` a cada chamada.
 * Superior imediato não é coluna: deriva da equipe (`montarHierarquia`). Toda alteração é auditada (RN-AUD-01) na mesma
 * transação, sem senha, hash, nome nem e-mail em claro. A senha é hasheada em argon2id (`hashSenha`) e nunca vai a log.
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AtivarUsuarioRequestSchema,
  CODIGOS_USUARIO,
  CriarUsuarioRequestSchema,
  EditarUsuarioRequestSchema,
  EquipeOpcaoSchema,
  RedefinirSenhaRequestSchema,
  UsuarioItemSchema,
  UsuarioListaQuerySchema,
  type EquipeOpcao,
  type UsuarioItem,
} from '../contracts';
import {
  avaliarAlteracaoDeUsuario,
  diffAuditavelDeUsuario,
  montarHierarquia,
  normalizarEmail,
  recortarUsuarios,
  superiorImediatoNaEquipe,
  validarDadosDeUsuario,
  validarSenhaInicial,
  type EquipeLinha,
  type ErroDeCampo,
  type UsuarioAuditavel,
} from '../domain';
import { auditar } from './auditoria';
import { hashSenha } from './seguranca';

type Visiveis = ReadonlySet<string> | 'tenant';
const IdParam = z.object({ id: z.string().uuid() });
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const LIMITE = 1000;

const naoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
const dadosInvalidos = (erros: ErroDeCampo[]) => new ErroRegraNegocio(CODIGOS_USUARIO.dadosInvalidos, erros[0]!.mensagem, { campos: erros });
const emailDuplicado = () => new ErroHttpModulo(409, CODIGOS_USUARIO.emailDuplicado, 'Já existe um usuário com este e-mail nesta empresa. Use outro e-mail ou edite o usuário existente.');
const externalDuplicado = () => new ErroHttpModulo(409, CODIGOS_USUARIO.externalIdDuplicado, 'Já existe um usuário com este código do ERP nesta empresa. Confira o código ou deixe o campo vazio.');

/** Traduz a violação dos índices únicos (corrida entre duas gravações) para o 409 legível. */
function traduzirErroDeBanco(e: unknown): never {
  const x = e as { code?: string; constraint?: string };
  if (x?.code === '23505') {
    if (x.constraint === 'usuario_email_uk') throw emailDuplicado();
    if (x.constraint === 'usuario_external_uk') throw externalDuplicado();
  }
  throw e;
}

interface LinhaUsuario {
  id: string;
  nome: string;
  nome_curto: string | null;
  email: string;
  perfil: Perfil;
  equipe_id: string | null;
  equipe_nome: string | null;
  ativo: boolean;
  external_id: string | null;
  ultimo_login_em: string | null;
}

const SELECT_USUARIO = `select u.id, u.nome, u.nome_curto, u.email, u.perfil, u.equipe_id, e.nome as equipe_nome, u.ativo, u.external_id,
         to_char(u.ultimo_login_em at time zone 'UTC', ${ISO}) as ultimo_login_em
    from core.usuario u left join core.equipe e on e.id = u.equipe_id and e.deleted_at is null`;

async function equipesAtivas(db: ClienteBanco): Promise<EquipeLinha[]> {
  return (await db.query<EquipeLinha>('select id, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo')).rows;
}

async function nomesDe(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await db.query<{ id: string; nome: string }>('select id, nome from core.usuario where id = any($1::uuid[]) and deleted_at is null', [[...new Set(ids)]]);
  return new Map(r.rows.map((l) => [l.id, l.nome]));
}

/** Superior só aparece se estiver no escopo de quem lê (não revela quem está acima; mesma regra de `recortarHierarquia`). */
const superiorVisivel = (id: string | null, v: Visiveis): string | null => (id && (v === 'tenant' || v.has(id)) ? id : null);

async function montarItens(db: ClienteBanco, linhas: readonly LinhaUsuario[], visiveis: Visiveis): Promise<UsuarioItem[]> {
  const hierarquia = montarHierarquia(
    await equipesAtivas(db),
    linhas.map((l) => ({ id: l.id, nome: l.nome, perfil: l.perfil, equipe_id: l.equipe_id, ativo: l.ativo })),
  );
  const superiorDe = new Map(hierarquia.map((m) => [m.id, superiorVisivel(m.superior_id, visiveis)]));
  const nomes = await nomesDe(db, [...superiorDe.values()].filter((x): x is string => x !== null));
  return linhas.map((l) => {
    const sup = superiorDe.get(l.id) ?? null;
    return UsuarioItemSchema.parse({ ...l, superior_id: sup, superior_nome: sup ? (nomes.get(sup) ?? null) : null });
  });
}

async function itemPorId(db: ClienteBanco, id: string): Promise<UsuarioItem> {
  const r = await db.query<LinhaUsuario>(`${SELECT_USUARIO} where u.id = $1 and u.deleted_at is null`, [id]);
  if (!r.rows[0]) throw naoEncontrado();
  return (await montarItens(db, r.rows, 'tenant'))[0]!;
}

interface UsuarioBruto extends UsuarioAuditavel {
  id: string;
}
const COLUNAS_BRUTAS = 'id, nome, nome_curto, email, perfil, equipe_id, ativo, external_id';

async function buscarParaAlterar(db: ClienteBanco, id: string): Promise<UsuarioBruto> {
  const r = await db.query<UsuarioBruto>(`select ${COLUNAS_BRUTAS} from core.usuario where id = $1 and deleted_at is null for update`, [id]);
  if (!r.rows[0]) throw naoEncontrado();
  return r.rows[0];
}

async function exigirEquipe(db: ClienteBanco, equipeId: string | null): Promise<void> {
  if (!equipeId) return;
  const r = await db.query('select 1 from core.equipe where id = $1 and deleted_at is null and ativo', [equipeId]);
  if (r.rows.length === 0) throw new ErroRegraNegocio(CODIGOS_USUARIO.equipeInvalida, 'Equipe não encontrada ou inativa. Escolha outra equipe da lista.');
}

async function exigirUnicos(db: ClienteBanco, email: string, externalId: string | null, exceto: string | null): Promise<void> {
  const e = await db.query('select 1 from core.usuario where lower(email) = $1 and deleted_at is null and ($2::uuid is null or id <> $2)', [email, exceto]);
  if (e.rows.length > 0) throw emailDuplicado();
  if (externalId !== null) {
    const x = await db.query('select 1 from core.usuario where external_id = $1 and deleted_at is null and ($2::uuid is null or id <> $2)', [externalId, exceto]);
    if (x.rows.length > 0) throw externalDuplicado();
  }
}

/** Admins ativos do tenant, travados para a conferência do "último admin" (evita duas desativações simultâneas). */
async function contarAdminsAtivos(db: ClienteBanco): Promise<number> {
  const r = await db.query("select id from core.usuario where perfil = 'admin' and ativo and deleted_at is null for update");
  return r.rows.length;
}

async function conferirAlteracao(ctx: ContextoBase, db: ClienteBanco, alvo: UsuarioBruto, depois: { perfil: Perfil; ativo: boolean }): Promise<void> {
  const r = avaliarAlteracaoDeUsuario({
    ator: ctx.usuario,
    alvo: { id: alvo.id, perfil: alvo.perfil as Perfil, ativo: alvo.ativo },
    depois,
    adminsAtivos: await contarAdminsAtivos(db),
  });
  if (!r.ok) throw new ErroRegraNegocio(r.codigo, r.mensagem);
}

export const rotasDeUsuarios: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'usuarios',
    acao: 'usuario.ver',
    carteira: 'nao_se_aplica',
    query: UsuarioListaQuerySchema,
    executar: async (ctx) => {
      const visiveis = await ctx.usuariosVisiveis();
      const { q, perfil, equipe_id, ativo } = ctx.query;
      const valores: unknown[] = [];
      const onde = ['u.deleted_at is null'];
      const param = (v: unknown) => {
        valores.push(v);
        return `$${valores.length}`;
      };
      if (visiveis !== 'tenant') onde.push(`u.id = any(${param([...visiveis])}::uuid[])`);
      if (q) {
        const p = param(`%${q.replace(/[\\%_]/g, (m: string) => `\\${m}`)}%`);
        onde.push(`(u.nome ilike ${p} or u.email ilike ${p})`);
      }
      if (perfil) onde.push(`u.perfil = ${param(perfil)}`);
      if (equipe_id) onde.push(`u.equipe_id = ${param(equipe_id)}`);
      if (ativo) onde.push(`u.ativo = ${param(ativo === 'true')}`);
      return ctx.comTenant(async (db) => {
        const r = await db.query<LinhaUsuario>(`${SELECT_USUARIO} where ${onde.join(' and ')} order by u.nome, u.id limit ${LIMITE}`, valores);
        // o filtro SQL já recortou; `recortarUsuarios` é a mesma regra do domínio, aplicada de novo como cinto de segurança
        return { itens: await montarItens(db, recortarUsuarios(r.rows, visiveis), visiveis) };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'equipes',
    acao: 'usuario.ver',
    carteira: 'nao_se_aplica',
    executar: async (ctx) => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const r = await db.query<{ id: string; nome: string; equipe_pai_id: string | null; responsavel_id: string | null }>(
          'select id, nome, equipe_pai_id, responsavel_id from core.equipe where deleted_at is null and ativo order by nome, id',
        );
        let linhas = r.rows;
        if (visiveis !== 'tenant') {
          // quem não vê o tenant todo só enxerga as equipes de quem está no seu escopo
          const dele = await db.query<{ equipe_id: string }>('select distinct equipe_id from core.usuario where id = any($1::uuid[]) and equipe_id is not null and deleted_at is null', [[...visiveis]]);
          const ids = new Set(dele.rows.map((l) => l.equipe_id));
          linhas = linhas.filter((l) => ids.has(l.id));
        }
        const todas: EquipeLinha[] = r.rows;
        const superior = new Map(linhas.map((l) => [l.id, superiorVisivel(superiorImediatoNaEquipe(todas, l.id), visiveis)]));
        const nomes = await nomesDe(db, [...superior.values(), ...linhas.map((l) => superiorVisivel(l.responsavel_id, visiveis))].filter((x): x is string => x !== null));
        const itens: EquipeOpcao[] = linhas.map((l) => {
          const resp = superiorVisivel(l.responsavel_id, visiveis);
          const sup = superior.get(l.id) ?? null;
          return EquipeOpcaoSchema.parse({
            id: l.id,
            nome: l.nome,
            equipe_pai_id: l.equipe_pai_id,
            responsavel_id: resp,
            responsavel_nome: resp ? (nomes.get(resp) ?? null) : null,
            superior_id: sup,
            superior_nome: sup ? (nomes.get(sup) ?? null) : null,
          });
        });
        return { itens };
      });
    },
  },
  {
    metodo: 'POST',
    caminho: 'usuarios',
    acao: 'usuario.gerir',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: CriarUsuarioRequestSchema,
    executar: async (ctx) => {
      const c = ctx.corpo;
      const email = normalizarEmail(c.email);
      const nome = c.nome.trim();
      const externalId = c.external_id?.trim() ?? null;
      const erros = validarDadosDeUsuario({ nome, email, perfil: c.perfil, external_id: externalId });
      if (erros.length > 0) throw dadosInvalidos(erros);
      const fraca = validarSenhaInicial(c.senha, email);
      if (fraca) throw new ErroRegraNegocio(CODIGOS_USUARIO.senhaFraca, fraca);
      const senhaHash = await hashSenha(c.senha);
      try {
        return await ctx.comTenant(async (db) => {
          await exigirEquipe(db, c.equipe_id);
          await exigirUnicos(db, email, externalId, null);
          const r = await db.query<{ id: string }>(
            `insert into core.usuario (tenant_id, nome, nome_curto, email, perfil, equipe_id, senha_hash, ativo, external_id)
             values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
            [nome, c.nome_curto?.trim() || null, email, c.perfil, c.equipe_id, senhaHash, c.ativo, externalId],
          );
          const id = r.rows[0]!.id;
          await auditar(db, ctx, { acao: 'usuario.criar', entidade: 'usuario', entidadeId: id, antes: null, depois: { perfil: c.perfil, equipe_id: c.equipe_id, ativo: c.ativo, external_id: externalId, senha_definida: true } });
          return itemPorId(db, id);
        });
      } catch (e) {
        return traduzirErroDeBanco(e);
      }
    },
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id',
    acao: 'usuario.gerir',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: EditarUsuarioRequestSchema,
    executar: async (ctx) => {
      const c = ctx.corpo;
      try {
        return await ctx.comTenant(async (db) => {
          const antes = await buscarParaAlterar(db, ctx.params.id);
          const depois: UsuarioAuditavel = {
            nome: c.nome?.trim() ?? antes.nome,
            nome_curto: c.nome_curto === undefined ? antes.nome_curto : c.nome_curto?.trim() || null,
            email: c.email === undefined ? antes.email : normalizarEmail(c.email),
            perfil: c.perfil ?? antes.perfil,
            equipe_id: c.equipe_id === undefined ? antes.equipe_id : c.equipe_id,
            ativo: antes.ativo,
            external_id: c.external_id === undefined ? antes.external_id : (c.external_id?.trim() ?? null),
          };
          const erros = validarDadosDeUsuario(depois);
          if (erros.length > 0) throw dadosInvalidos(erros);
          await conferirAlteracao(ctx, db, antes, { perfil: depois.perfil as Perfil, ativo: depois.ativo });
          const diff = diffAuditavelDeUsuario(antes, depois);
          if (diff.campos_alterados.length === 0) return itemPorId(db, antes.id);
          if (depois.equipe_id !== antes.equipe_id) await exigirEquipe(db, depois.equipe_id);
          await exigirUnicos(db, depois.email.toLowerCase(), depois.external_id, antes.id);
          await db.query('update core.usuario set nome = $2, nome_curto = $3, email = $4, perfil = $5, equipe_id = $6, external_id = $7 where id = $1', [
            antes.id,
            depois.nome,
            depois.nome_curto,
            depois.email,
            depois.perfil,
            depois.equipe_id,
            depois.external_id,
          ]);
          await auditar(db, ctx, { acao: 'usuario.editar', entidade: 'usuario', entidadeId: antes.id, antes: { ...diff.antes, campos_alterados: diff.campos_alterados }, depois: diff.depois });
          return itemPorId(db, antes.id);
        });
      } catch (e) {
        return traduzirErroDeBanco(e);
      }
    },
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id/ativo',
    acao: 'usuario.gerir',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: AtivarUsuarioRequestSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const antes = await buscarParaAlterar(db, ctx.params.id);
        const { ativo } = ctx.corpo;
        if (antes.ativo === ativo) return itemPorId(db, antes.id); // idempotente: sem auditoria nem nova revogação
        await conferirAlteracao(ctx, db, antes, { perfil: antes.perfil as Perfil, ativo });
        await db.query('update core.usuario set ativo = $2 where id = $1', [antes.id, ativo]);
        if (!ativo) {
          // o acesso já cai na próxima requisição (autenticar confere `ativo`); aqui também mata o refresh e o push
          await db.query('update core.sessao set revogado_em = now() where usuario_id = $1 and revogado_em is null', [antes.id]);
          await db.query('update core.dispositivo set push_token = null, push_plataforma = null where usuario_id = $1', [antes.id]);
        }
        await auditar(db, ctx, {
          acao: ativo ? 'usuario.ativar' : 'usuario.desativar',
          entidade: 'usuario',
          entidadeId: antes.id,
          antes: { ativo: antes.ativo },
          depois: ativo ? { ativo } : { ativo, sessoes_revogadas: true },
        });
        return itemPorId(db, antes.id);
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id/senha',
    acao: 'usuario.gerir',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: RedefinirSenhaRequestSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const alvo = await buscarParaAlterar(db, ctx.params.id);
        const fraca = validarSenhaInicial(ctx.corpo.senha, alvo.email);
        if (fraca) throw new ErroRegraNegocio(CODIGOS_USUARIO.senhaFraca, fraca);
        const senhaHash = await hashSenha(ctx.corpo.senha);
        // zera a contagem de falhas e o bloqueio temporário; a senha antiga não vale mais em nenhuma sessão
        await db.query('update core.usuario set senha_hash = $2, tentativas_falhas = 0, bloqueio_ate = null where id = $1', [alvo.id, senhaHash]);
        await db.query('update core.sessao set revogado_em = now() where usuario_id = $1 and revogado_em is null', [alvo.id]);
        await auditar(db, ctx, { acao: 'usuario.senha_redefinir', entidade: 'usuario', entidadeId: alvo.id, antes: null, depois: { senha_alterada: true, sessoes_revogadas: true } });
        return { ok: true };
      }),
  },
];
