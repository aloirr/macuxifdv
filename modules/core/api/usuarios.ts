/**
 * Usuários no BKO (RF-CORE-02; T-0067). Leitura: supervisor/gerente (recortada pelo escopo, `usuariosVisiveis`, RN-CORE-04) e
 * admin (`usuario.ver`). Escrita pelas chaves do motor de permissões (ADR 0033: `usuario.criar|editar|desativar`, `senha.redefinir`; fábrica = admin; a API revalida). Criar e redefinir a senha (T-0094, RN-CORE-34): a senha é temporária (72 h,
 * `trocar_senha`), vai por e-mail na mesma transação (`ctx.email`) e encerra as sessões (`sessao_versao + 1`); nunca vai a log,
 * auditoria nem resposta. Nunca apaga: desativar põe `ativo = false`,
 * revoga as sessões e limpa o push; o acesso cai na próxima requisição porque `autenticar` confere `ativo` a cada chamada.
 * Superior imediato não é coluna: deriva da equipe (`montarHierarquia`). Toda alteração é auditada (RN-AUD-01) na mesma
 * transação, sem senha, hash, nome nem e-mail em claro. A senha é hasheada em argon2id (`hashSenha`) e nunca vai a log.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, matrizDeFabrica, type ClienteBanco, type ContextoBase, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { COLUNA_CODIGO_FDV_PRONTA, sqlCodigoFdv } from './codigo-fdv';
import {
  AtivarUsuarioRequestSchema,
  CODIGOS_USUARIO,
  CriarUsuarioRequestSchema,
  CriarUsuarioRespostaSchema,
  CODIGOS_EQUIPE_CSV,
  EditarUsuarioRequestSchema,
  EquipeOpcaoSchema,
  RedefinirSenhaRequestSchema,
  UsuarioItemSchema,
  UsuarioListaQuerySchema,
  MENSAGEM_DESCONTO_PEDIDO_OBRIGATORIO,
  limiteDescontoCompleto,
  type CriarUsuarioResposta,
  type DesbloquearUsuarioResposta,
  type EquipeOpcao,
  type RedefinirSenhaResposta,
  type UsuarioItem,
} from '../contracts';
import {
  recusarCodigoFdvNoCorpo,
  SENHA_TEMPORARIA_HORAS,
  avaliarAlteracaoDeUsuario,
  type UsuarioDoEstado,
  diffAuditavelDeUsuario,
  montarHierarquia,
  normalizarEmail,
  recortarUsuarios,
  superiorImediatoNaEquipe,
  validarDadosDeUsuario,
  faltasNaSenha,
  gerarSenhaTemporaria,
  hierarquiaDoCargo,
  podeRedefinirSenha,
  estadoDoLogin,
  validadeDaSenhaTemporaria,
  validarSenhaInicial,
  type EquipeLinha,
  type ErroDeCampo,
  type UsuarioAuditavel,
  ERRO_SEM_PERFIL,
  ehUsuarioProvisorio,
} from '../domain';
import { auditar } from './auditoria';
import { codigosDoUsuario, conferirPerfisDoUsuario, gravarPerfisDoUsuario, perfisEscolhidos, principalDe, refsDoUsuario } from './usuario-perfis';
import { carregar } from './perfis';
import { perfisDoUsuarioNoLogin } from './perfis-do-usuario';
import { appsDosPerfis, emailDisponivel, empresaDoTenant, enviarEmail } from './email';
import { hashSenha } from './seguranca';
import { cargoDoPerfil, conferirHierarquia, erroDaHierarquiaNoBanco, hierarquiaAtual, posicionarNaEquipe } from './hierarquia-cadastro';
import { conferirFiliaisDoUsuario, exigirQuemEditaFilial, filiaisDoUsuario, filiaisDosUsuarios, gravarFiliaisDoUsuario } from './filiais-usuario';

type Visiveis = ReadonlySet<string> | 'tenant';
const IdParam = z.object({ id: z.string().uuid() });
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const LIMITE = 1000;

const naoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
const descontoPedidoObrigatorio = () => new ErroRegraNegocio(CODIGOS_USUARIO.dadosInvalidos, MENSAGEM_DESCONTO_PEDIDO_OBRIGATORIO, { campo: 'desconto_maximo_pedido_permil' });
const recusarCodigoFdv = (corpo: Record<string, unknown>): void => {
  const e = recusarCodigoFdvNoCorpo(corpo);
  if (e) throw new ErroRegraNegocio(e.codigo, e.mensagem, { campos: [{ campo: e.campo, mensagem: e.mensagem }] });
};
const dadosInvalidos = (erros: ErroDeCampo[]) => new ErroRegraNegocio(CODIGOS_USUARIO.dadosInvalidos, erros[0]!.mensagem, { campos: erros });
const emailDuplicado = () => new ErroHttpModulo(409, CODIGOS_USUARIO.emailDuplicado, 'Já existe um usuário com este e-mail nesta empresa. Use outro e-mail ou edite o usuário existente.');
const externalDuplicado = (provisorio = false) =>
  new ErroHttpModulo(
    409,
    CODIGOS_USUARIO.externalIdDuplicado,
    provisorio
      ? 'Este código já é de um usuário provisório criado pela carga do ERP. Use Vincular vendedor do ERP na lista de Usuários.'
      : 'Já existe um usuário com este código do ERP nesta empresa. Confira o código ou deixe o campo vazio.',
  );

/** Traduz a violação dos índices únicos (corrida entre duas gravações) para o 409 legível. */
function traduzirErroDeBanco(e: unknown): never {
  const hierarquia = erroDaHierarquiaNoBanco(e);
  if (hierarquia) throw hierarquia;
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
  codigo_fdv?: string | null;
  provisorio?: boolean;
  ultimo_login_em: string | null;
  trocar_senha: boolean;
  senha_expira_em: string | null;
  sem_senha: boolean;
  desconto_limita_item: boolean;
  desconto_limita_pedido: boolean;
  desconto_maximo_pedido_permil: number | null;
  cargo?: string | null;
  supervisor_id?: string | null;
  gerente_id?: string | null;
  /** Colunas do bloqueio do login; viram `bloqueio`/`bloqueio_ate` em `montarItens` e não vão à resposta. */
  bloqueado_admin?: boolean;
  bloqueio_ate_login?: string | null;
}

const SELECT_USUARIO = `select u.id, u.nome, u.nome_curto, u.email, u.perfil, u.equipe_id, e.nome as equipe_nome, u.ativo, u.external_id, ${sqlCodigoFdv()} as codigo_fdv, (lower(u.email) like '%@sem-email.invalid') as provisorio,
         to_char(u.ultimo_login_em at time zone 'UTC', ${ISO}) as ultimo_login_em,
         u.trocar_senha, to_char(u.senha_expira_em at time zone 'UTC', ${ISO}) as senha_expira_em, (u.senha_hash is null) as sem_senha,
         u.desconto_limita_item, u.desconto_limita_pedido, u.desconto_maximo_pedido_permil, h.cargo, h.supervisor_id, h.gerente_id,
         (u.bloqueado_em is not null) as bloqueado_admin, to_char(u.bloqueio_ate at time zone 'UTC', ${ISO}) as bloqueio_ate_login
    from core.usuario u left join core.equipe e on e.id = u.equipe_id and e.deleted_at is null
    left join core.v_usuario_hierarquia h on h.usuario_id = u.id`;

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

/** Perfis de cada usuário (principal primeiro: a base igual a `core.usuario.perfil`; depois por nome). */
async function perfisDosUsuarios(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, { codigo: string; nome: string; base: Perfil }[]>> {
  const m = new Map<string, { codigo: string; nome: string; base: Perfil }[]>();
  if (ids.length === 0) return m;
  const r = await db.query<{ usuario_id: string; codigo: string; nome: string; base: Perfil; principal: boolean }>(
    `select up.usuario_id, p.codigo, p.nome, p.base, (p.base = u.perfil) as principal
       from plataforma.usuario_perfil up
       join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
       join core.usuario u on u.id = up.usuario_id
      where up.deleted_at is null and up.usuario_id = any($1::uuid[]) order by (p.base = u.perfil) desc, p.nome`,
    [[...ids]],
  );
  for (const l of r.rows) m.set(l.usuario_id, [...(m.get(l.usuario_id) ?? []), { codigo: l.codigo, nome: l.nome, base: l.base }]);
  return m;
}

/** O bloqueio do login pela mesma regra do login (`estadoDoLogin`), sem o inativo, que já vem em `ativo`. */
export function bloqueioDaLinha(l: { bloqueado_admin?: boolean; bloqueio_ate_login?: string | null }, agora: Date): Pick<UsuarioItem, 'bloqueio' | 'bloqueio_ate'> {
  const bloqueioAte = l.bloqueio_ate_login ? new Date(l.bloqueio_ate_login) : null;
  const estado = estadoDoLogin({ ativo: true, bloqueadoEm: l.bloqueado_admin ? agora : null, bloqueioAte, agora });
  if (estado === 'bloqueado_admin') return { bloqueio: 'admin', bloqueio_ate: null };
  if (estado === 'bloqueado_tentativas') return { bloqueio: 'tentativas', bloqueio_ate: l.bloqueio_ate_login ?? null };
  return { bloqueio: null, bloqueio_ate: null };
}

async function montarItens(db: ClienteBanco, linhas: readonly LinhaUsuario[], visiveis: Visiveis, agora: Date = new Date()): Promise<UsuarioItem[]> {
  const hierarquia = montarHierarquia(
    await equipesAtivas(db),
    linhas.map((l) => ({ id: l.id, nome: l.nome, perfil: l.perfil, equipe_id: l.equipe_id, ativo: l.ativo })),
  );
  const superiorDe = new Map(hierarquia.map((m) => [m.id, superiorVisivel(m.superior_id, visiveis)]));
  const nomes = await nomesDe(db, [...superiorDe.values()].filter((x): x is string => x !== null));
  const perfisDe = await perfisDosUsuarios(db, linhas.map((l) => l.id));
  const filiaisDe = await filiaisDosUsuarios(db, linhas.map((l) => l.id)); // T-0176 / RN-CORE-39
  const idsProvisorios = linhas.filter((l) => l.provisorio === true).map((l) => l.id);
  const carteiraDe = new Map<string, number>(); // RN-CORE-58: clientes da carteira de cada provisório
  if (idsProvisorios.length > 0) {
    const c = await db.query<{ usuario_id: string; n: string }>('select usuario_id, count(distinct cliente_id) as n from core.carteira where usuario_id = any($1::uuid[]) and deleted_at is null group by usuario_id', [idsProvisorios]);
    for (const l of c.rows) carteiraDe.set(l.usuario_id, Number(l.n));
  }
  return linhas.map(({ bloqueado_admin, bloqueio_ate_login, ...l }) => {
    const sup = superiorDe.get(l.id) ?? null;
    const filiais = filiaisDe.get(l.id);
    return UsuarioItemSchema.parse({ ...l, ...(l.provisorio === true ? { clientes_carteira: carteiraDe.get(l.id) ?? 0 } : {}), filial_cadastro_id: filiais?.filial_cadastro_id ?? null, filial_venda_ids: filiais?.filial_venda_ids ?? [], sem_filial: filiais?.sem_filial ?? true, ...bloqueioDaLinha({ bloqueado_admin, bloqueio_ate_login }, agora), perfis: perfisDe.get(l.id) ?? [], superior_id: sup, superior_nome: sup ? (nomes.get(sup) ?? null) : null });
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
const COLUNAS_BRUTAS = 'id, nome, nome_curto, email, perfil, equipe_id, ativo, external_id, desconto_limita_item, desconto_limita_pedido, desconto_maximo_pedido_permil';

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
    const x = await db.query<{ email: string }>('select email from core.usuario where external_id = $1 and deleted_at is null and ($2::uuid is null or id <> $2)', [externalId, exceto]);
    if (x.rows.length > 0) throw externalDuplicado(ehUsuarioProvisorio(x.rows[0]!.email));
  }
}

/**
 * Usuários que a conferência de limites (RN-CORE-35) precisa ver, travados contra duas alterações simultâneas: os admins ativos
 * (`validarAcessoDoTenant` olha o último admin), o ator e o alvo. O ator pode ser o super-admin do portal (não é usuário do tenant).
 */
async function usuariosDoEstado(db: ClienteBanco, atorId: string, alvoId: string): Promise<UsuarioDoEstado[]> {
  const r = await db.query<{ id: string; perfil: Perfil; ativo: boolean }>(
    "select id, perfil, ativo from core.usuario where deleted_at is null and (perfil = 'admin' or id = any($1::uuid[])) order by id for update",
    [[atorId, alvoId]],
  );
  return r.rows;
}

async function conferirAlteracao(ctx: ContextoBase, db: ClienteBanco, alvo: UsuarioBruto, depois: { perfil: Perfil; ativo: boolean; perfis?: readonly string[] }): Promise<void> {
  const motor = ctx.permissoes ?? { catalogo: [], matriz: matrizDeFabrica([]) };
  const usuarios = await usuariosDoEstado(db, ctx.usuario.id, alvo.id); // trava os admins, o ator e o alvo
  // T-0111: o estado real do tenant (perfis personalizados, sobreposições), não só o principal e o padrão de fábrica
  const estado = await carregar(db, true);
  const r = avaliarAlteracaoDeUsuario({
    ator: { id: ctx.usuario.id, perfis: ctx.usuario.perfis ?? [] },
    alvo: { id: alvo.id, perfil: alvo.perfil as Perfil, ativo: alvo.ativo, perfis: await refsDoUsuario(db, alvo.id, alvo.perfil as Perfil) },
    depois,
    usuarios,
    estado: { perfis: estado.perfis, usuarios: estado.usuarios },
    matriz: motor.matriz,
    catalogo: motor.catalogo,
  });
  if (!r.ok) throw new ErroRegraNegocio(r.codigo, r.mensagem, { regra: r.regra });
}

export const rotasDeUsuarios: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'usuarios',
    superficie: 'bko',
    acao: 'usuario.ver',
    carteira: 'nao_se_aplica',
    query: UsuarioListaQuerySchema,
    executar: async (ctx) => {
      const visiveis = await ctx.usuariosVisiveis();
      const { q, perfil, equipe_id, ativo, provisorio } = ctx.query;
      const valores: unknown[] = [];
      const onde = ['u.deleted_at is null'];
      const param = (v: unknown) => {
        valores.push(v);
        return `$${valores.length}`;
      };
      if (visiveis !== 'tenant') onde.push(`u.id = any(${param([...visiveis])}::uuid[])`);
      if (q) {
        const p = param(`%${q.replace(/[\\%_]/g, (m: string) => `\\${m}`)}%`);
        onde.push(`(u.nome ilike ${p} or u.email ilike ${p} or u.external_id ilike ${p}${COLUNA_CODIGO_FDV_PRONTA ? ` or u.codigo_fdv ilike ${p}` : ''})`);
      }
      if (perfil) onde.push(`exists (select 1 from plataforma.usuario_perfil up join plataforma.perfil pf on pf.id = up.perfil_id where up.usuario_id = u.id and up.deleted_at is null and pf.codigo = ${param(perfil)})`);
      if (equipe_id) onde.push(`u.equipe_id = ${param(equipe_id)}`);
      if (ativo) onde.push(`u.ativo = ${param(ativo === 'true')}`);
      if (provisorio) onde.push("lower(u.email) like '%@sem-email.invalid'");
      return ctx.comTenant(async (db) => {
        const r = await db.query<LinhaUsuario>(`${SELECT_USUARIO} where ${onde.join(' and ')} order by u.nome, u.id limit ${LIMITE}`, valores);
        // o filtro SQL já recortou; `recortarUsuarios` é a mesma regra do domínio, aplicada de novo como cinto de segurança
        return { itens: await montarItens(db, recortarUsuarios(r.rows, visiveis), visiveis, ctx.agora()) };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'equipes',
    superficie: 'bko',
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
    superficie: 'bko',
    acao: 'usuario.criar',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: CriarUsuarioRequestSchema,
    executar: async (ctx): Promise<CriarUsuarioResposta> => {
      const c = ctx.corpo;
      recusarCodigoFdv(c);
      const email = normalizarEmail(c.email);
      const nome = c.nome.trim();
      const externalId = c.external_id?.trim() ?? null;
      const codigosPedidos = c.perfis ?? (c.perfil ? [c.perfil] : []);
      // o BKO manda `perfis` (um só) e a hierarquia do cargo; o campo legado `perfil` (scripts, testes antigos) só confere o que vier
      const comHierarquia = c.perfis !== undefined || c.supervisor_id !== null || c.gerente_id !== null || c.equipe_nome !== null;
      if (codigosPedidos.length === 0) throw dadosInvalidos([{ campo: 'perfil', mensagem: ERRO_SEM_PERFIL }]);
      const erros = validarDadosDeUsuario({ nome, email, perfil: c.perfil ?? 'vendedor', external_id: externalId });
      if (erros.length > 0) throw dadosInvalidos(erros);
      if (!limiteDescontoCompleto(c)) throw descontoPedidoObrigatorio();
      const fraca = validarSenhaInicial(c.senha, email);
      if (fraca) throw new ErroRegraNegocio(CODIGOS_USUARIO.senhaFraca, fraca, { faltas: faltasNaSenha(c.senha) });
      const senhaHash = await hashSenha(c.senha);
      try {
        return await ctx.comTenant(async (db) => {
          await exigirEquipe(db, c.equipe_id);
          await exigirUnicos(db, email, externalId, null);
          const escolhidos = await perfisEscolhidos(db, codigosPedidos);
          const principal = principalDe(escolhidos);
          await conferirPerfisDoUsuario(ctx, db, randomUUID(), escolhidos.map((x) => x.codigo), c.ativo);
          const cargo = await cargoDoPerfil(db, escolhidos[0]!.codigo);
          const hierarquia = comHierarquia ? await conferirHierarquia(db, cargo, c, externalId) : null;
          // T-0176 / RN-CORE-39: cadastro obrigatória em qualquer perfil (422); só admin e analista informam (403); a de cadastro entra na de venda
          exigirQuemEditaFilial(ctx.usuario.perfis);
          const filiais = await conferirFiliaisDoUsuario(db, { cadastro: c.filial_cadastro_id, venda: c.filial_venda_ids ?? [] });
          const r = await db.query<{ id: string }>(
            `insert into core.usuario (tenant_id, nome, nome_curto, email, perfil, equipe_id, senha_hash, trocar_senha, senha_expira_em, ativo, external_id, desconto_limita_item, desconto_limita_pedido, desconto_maximo_pedido_permil)
             values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11, $12) returning id`,
            [nome, c.nome_curto?.trim() || null, email, principal, c.equipe_id, senhaHash, validadeDaSenhaTemporaria(ctx.agora()), c.ativo, externalId, c.desconto_limita_item, c.desconto_limita_pedido, c.desconto_maximo_pedido_permil],
          );
          const id = r.rows[0]!.id;
          await gravarPerfisDoUsuario(db, id, escolhidos.map((x) => x.codigo));
          await gravarFiliaisDoUsuario(db, id, filiais.cadastro, filiais.venda);
          const equipeFinal = hierarquia ? await posicionarNaEquipe(db, id, cargo, hierarquia, c.equipe_id) : c.equipe_id;
          const empresa = await empresaDoTenant(db);
          // a senha só sai na carga cifrada do e-mail (mesma transação: criou <=> enfileirou)
          const envio = await enviarEmail(ctx, db, {
            modelo: 'acesso_inicial',
            usuario_id: id,
            para: email,
            dados: { nome, empresa_nome: empresa.nome, codigo_empresa: empresa.codigo, login: email, senha: c.senha, validade_horas: SENHA_TEMPORARIA_HORAS, apps: appsDosPerfis(await perfisDoUsuarioNoLogin(db, id, principal)) },
            chave_idempotencia: `${id}:acesso`,
          });
          await auditar(db, ctx, { acao: 'usuario.criar', entidade: 'usuario', entidadeId: id, antes: null, depois: { perfil: principal, perfis: escolhidos.map((x) => x.codigo), cargo, equipe_id: equipeFinal, supervisor_id: hierarquia?.supervisor_id ?? null, gerente_id: hierarquia?.gerente_id ?? null, filial_cadastro_id: filiais.cadastro, filial_venda_ids: filiais.venda, ativo: c.ativo, external_id: externalId, desconto_limita_item: c.desconto_limita_item, desconto_limita_pedido: c.desconto_limita_pedido, desconto_maximo_pedido_permil: c.desconto_maximo_pedido_permil, senha_definida: true, trocar_senha: true, email: envio } });
          return CriarUsuarioRespostaSchema.parse({ ...(await itemPorId(db, id)), email_acesso: envio });
        });
      } catch (e) {
        return traduzirErroDeBanco(e);
      }
    },
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id',
    superficie: 'bko',
    acao: 'usuario.editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: EditarUsuarioRequestSchema,
    executar: async (ctx) => {
      const c = ctx.corpo;
      recusarCodigoFdv(c);
      try {
        return await ctx.comTenant(async (db) => {
          const antes = await buscarParaAlterar(db, ctx.params.id);
          const codigosAntes = await codigosDoUsuario(db, antes.id);
          // campo legado `perfil` sem `perfis` que muda a base vale como perfis: [perfil]: valida e grava o MESMO estado (o trigger da 0041 soma vínculos antigos)
          const codigosPedidos = c.perfis ?? (c.perfil && c.perfil !== antes.perfil ? [c.perfil] : null);
          const escolhidos = codigosPedidos ? await perfisEscolhidos(db, codigosPedidos) : null;
          const perfisMudaram = !!escolhidos && escolhidos.map((x) => x.codigo).sort().join(',') !== codigosAntes.join(',');
          const depois: UsuarioAuditavel = {
            nome: c.nome?.trim() ?? antes.nome,
            nome_curto: c.nome_curto === undefined ? antes.nome_curto : c.nome_curto?.trim() || null,
            email: c.email === undefined ? antes.email : normalizarEmail(c.email),
            perfil: escolhidos ? principalDe(escolhidos) : (c.perfil ?? antes.perfil),
            equipe_id: c.equipe_id === undefined ? antes.equipe_id : c.equipe_id,
            ativo: antes.ativo,
            external_id: c.external_id === undefined ? antes.external_id : (c.external_id?.trim() ?? null),
            desconto_limita_item: c.desconto_limita_item ?? antes.desconto_limita_item,
            desconto_limita_pedido: c.desconto_limita_pedido ?? antes.desconto_limita_pedido,
            desconto_maximo_pedido_permil: c.desconto_maximo_pedido_permil === undefined ? antes.desconto_maximo_pedido_permil : c.desconto_maximo_pedido_permil,
          };
          const erros = validarDadosDeUsuario(depois);
          if (erros.length > 0) throw dadosInvalidos(erros);
          if (!limiteDescontoCompleto({ desconto_limita_item: depois.desconto_limita_item ?? true, desconto_limita_pedido: depois.desconto_limita_pedido ?? false, desconto_maximo_pedido_permil: depois.desconto_maximo_pedido_permil ?? null })) throw descontoPedidoObrigatorio();
          await conferirAlteracao(ctx, db, antes, { perfil: depois.perfil as Perfil, ativo: depois.ativo, ...(escolhidos ? { perfis: escolhidos.map((x) => x.codigo) } : {}) });
          if (escolhidos && perfisMudaram) await conferirPerfisDoUsuario(ctx, db, antes.id, escolhidos.map((x) => x.codigo), depois.ativo);
          // RN-CORE-55/57 (0069): o BKO manda o perfil e a hierarquia do cargo; o que não vier fica como está
          const mexeNaHierarquia = c.perfis !== undefined || c.supervisor_id !== undefined || c.gerente_id !== undefined || c.equipe_nome !== undefined;
          const atual = mexeNaHierarquia ? await hierarquiaAtual(db, antes.id) : null;
          const cargo = atual ? (escolhidos ? await cargoDoPerfil(db, escolhidos[0]!.codigo) : atual.cargo) : null;
          const hierarquia = atual
            ? await conferirHierarquia(db, cargo, {
                supervisor_id: c.supervisor_id === undefined ? atual.supervisor_id : c.supervisor_id,
                gerente_id: c.gerente_id === undefined ? atual.gerente_id : c.gerente_id,
                equipe_nome: c.equipe_nome === undefined ? atual.equipe_nome : c.equipe_nome,
              }, depois.external_id)
            : null;
          const hierarquiaAntes = atual ? hierarquiaDoCargo(cargo, atual) : null;
          const hierarquiaMudou = !!hierarquia && JSON.stringify(hierarquia) !== JSON.stringify(hierarquiaAntes);
          // T-0176 / RN-CORE-39: troca de filiais (só admin e analista) ou de perfil revalida a regra do cargo final
          const filiaisAntes = await filiaisDoUsuario(db, antes.id);
          let filiaisDepois: { cadastro: string; venda: string[] } | null = null;
          if (c.filial_cadastro_id !== undefined || c.filial_venda_ids !== undefined) {
            exigirQuemEditaFilial(ctx.usuario.perfis);
            filiaisDepois = await conferirFiliaisDoUsuario(db, { cadastro: c.filial_cadastro_id ?? filiaisAntes.filial_cadastro_id, venda: c.filial_venda_ids ?? filiaisAntes.filial_venda_ids });
          }
          const filiaisMudaram = !!filiaisDepois && (filiaisDepois.cadastro !== filiaisAntes.filial_cadastro_id || [...filiaisDepois.venda].sort().join(',') !== [...filiaisAntes.filial_venda_ids].sort().join(','));
          const diff = diffAuditavelDeUsuario(antes, depois);
          if (diff.campos_alterados.length === 0 && !perfisMudaram && !hierarquiaMudou && !filiaisMudaram) return itemPorId(db, antes.id);
          if (depois.equipe_id !== antes.equipe_id) await exigirEquipe(db, depois.equipe_id);
          await exigirUnicos(db, depois.email.toLowerCase(), depois.external_id, antes.id);
          await db.query('update core.usuario set nome = $2, nome_curto = $3, email = $4, perfil = $5, equipe_id = $6, external_id = $7, desconto_limita_item = $8, desconto_limita_pedido = $9, desconto_maximo_pedido_permil = $10 where id = $1', [
            antes.id,
            depois.nome,
            depois.nome_curto,
            depois.email,
            depois.perfil,
            depois.equipe_id,
            depois.external_id,
            depois.desconto_limita_item,
            depois.desconto_limita_pedido,
            depois.desconto_maximo_pedido_permil,
          ]);
          if (escolhidos && perfisMudaram) {
            await gravarPerfisDoUsuario(db, antes.id, escolhidos.map((x) => x.codigo));
            diff.campos_alterados.push('perfis');
            diff.antes.perfis = codigosAntes;
            diff.depois.perfis = escolhidos.map((x) => x.codigo).sort();
          }
          if (filiaisMudaram && filiaisDepois) {
            await gravarFiliaisDoUsuario(db, antes.id, filiaisDepois.cadastro, filiaisDepois.venda);
            diff.campos_alterados.push('filiais');
            diff.antes.filiais = { filial_cadastro_id: filiaisAntes.filial_cadastro_id, filial_venda_ids: filiaisAntes.filial_venda_ids };
            diff.depois.filiais = { filial_cadastro_id: filiaisDepois.cadastro, filial_venda_ids: filiaisDepois.venda };
          }
          if (hierarquia && (hierarquiaMudou || perfisMudaram)) {
            await posicionarNaEquipe(db, antes.id, cargo, hierarquia, depois.equipe_id);
            diff.campos_alterados.push('hierarquia');
            diff.antes.hierarquia = { supervisor_id: hierarquiaAntes?.supervisor_id ?? null, gerente_id: hierarquiaAntes?.gerente_id ?? null };
            diff.depois.hierarquia = { supervisor_id: hierarquia.supervisor_id, gerente_id: hierarquia.gerente_id };
          }
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
    superficie: 'bko',
    acao: 'usuario.desativar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: AtivarUsuarioRequestSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const antes = await buscarParaAlterar(db, ctx.params.id);
        const { ativo } = ctx.corpo;
        if (antes.ativo === ativo) return itemPorId(db, antes.id); // idempotente: sem auditoria nem nova revogação
        await conferirAlteracao(ctx, db, antes, { perfil: antes.perfil as Perfil, ativo });
        // T-0095: desativar no BKO marca `desligado_no_bko_em`; a carga do ERP não reativa enquanto estiver preenchida (reativar limpa)
        await db.query(
          'update core.usuario set ativo = $2, desligado_no_bko_em = case when $2::boolean then null else now() end, sessao_versao = case when $2::boolean then sessao_versao else sessao_versao + 1 end where id = $1',
          [antes.id, ativo],
        );
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
    // Desbloquear o login (spec docs/design/telas/usuario-bloqueio.md §6.2): zera tentativas, bloqueio por tentativas e do admin.
    // Não mexe em `ativo`, na senha nem nas sessões. Idempotente: quem já está livre volta 200 sem auditoria nova.
    metodo: 'DELETE',
    caminho: 'usuarios/:id/bloqueio',
    superficie: 'bko',
    acao: 'usuario.desbloquear',
    carteira: 'nao_se_aplica',
    params: IdParam,
    executar: (ctx): Promise<DesbloquearUsuarioResposta> =>
      ctx.comTenant(async (db) => {
        const r = await db.query<{ id: string; bloqueado_admin: boolean; bloqueio_ate_login: string | null; tentativas_falhas: number }>(
          `select id, (bloqueado_em is not null) as bloqueado_admin, to_char(bloqueio_ate at time zone 'UTC', ${ISO}) as bloqueio_ate_login, tentativas_falhas
             from core.usuario where id = $1 and deleted_at is null for update`,
          [ctx.params.id],
        );
        const antes = r.rows[0];
        if (!antes) throw naoEncontrado();
        const bloqueio = bloqueioDaLinha(antes, ctx.agora());
        if (bloqueio.bloqueio !== null) {
          await db.query('update core.usuario set tentativas_falhas = 0, bloqueio_ate = null, bloqueado_em = null where id = $1', [antes.id]);
          // RN-AUD-01: só o id, sem nome nem e-mail
          await auditar(db, ctx, {
            acao: 'usuario.desbloquear',
            entidade: 'usuario',
            entidadeId: antes.id,
            antes: { ...bloqueio, tentativas_falhas: Number(antes.tentativas_falhas) },
            depois: { bloqueio: null, bloqueio_ate: null, tentativas_falhas: 0 },
          });
        }
        return { id: antes.id, bloqueio: null };
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'usuarios/:id/senha',
    superficie: 'bko',
    acao: 'senha.redefinir',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: RedefinirSenhaRequestSchema,
    executar: (ctx): Promise<RedefinirSenhaResposta> =>
      ctx.comTenant(async (db) => {
        const alvo = await buscarParaAlterar(db, ctx.params.id);
        // P7: nunca a própria conta nem um admin; o alvo precisa estar ativo (o super-admin do portal age como admin)
        // T-0111: o perfil real do alvo (personalizado inclusive); a lista da chave tem de cobri-lo
        const refsDoAlvo = await refsDoUsuario(db, alvo.id, alvo.perfil as Perfil);
        const pode = podeRedefinirSenha({ id: ctx.usuario.id, perfis: ctx.usuario.perfis ?? [] }, { id: alvo.id, perfis: refsDoAlvo, ativo: alvo.ativo });
        if (!pode.ok) throw new ErroRegraNegocio(pode.codigo, pode.mensagem, { regra: 'RN-CORE-35' });
        const informada = ctx.corpo.senha;
        // sem senha informada o servidor gera: ninguém a conhece além do e-mail — sem e-mail configurado, recusa antes de mexer
        if (informada === undefined && !emailDisponivel(ctx)) {
          throw new ErroHttpModulo(503, CODIGOS_EQUIPE_CSV.emailIndisponivel, 'O envio de e-mail não está configurado. Informe uma senha para passar à pessoa ou fale com o suporte da Macuxi.');
        }
        if (informada !== undefined) {
          const fraca = validarSenhaInicial(informada, alvo.email);
          if (fraca) throw new ErroRegraNegocio(CODIGOS_USUARIO.senhaFraca, fraca, { faltas: faltasNaSenha(informada) });
        }
        const senha = informada ?? gerarSenhaTemporaria((n) => randomBytes(n));
        const senhaHash = await hashSenha(senha);
        const semSenha = ((await db.query<{ sem_senha: boolean }>('select (senha_hash is null) as sem_senha from core.usuario where id = $1', [alvo.id])).rows[0]?.sem_senha ?? false) === true;
        // zera tentativas e bloqueio temporário; a senha antiga e todas as sessões deixam de valer (sessao_versao + 1 derruba o token na hora)
        const v = await db.query<{ sessao_versao: number }>(
          `update core.usuario
              set senha_hash = $2, trocar_senha = true, senha_expira_em = $3,
                  senha_temporaria_hash = null, senha_temporaria_expira_em = null, senha_temporaria_criada_em = null,
                  tentativas_falhas = 0, bloqueio_ate = null, sessao_versao = sessao_versao + 1
            where id = $1
          returning sessao_versao`,
          [alvo.id, senhaHash, validadeDaSenhaTemporaria(ctx.agora())],
        );
        const versao = Number(v.rows[0]?.sessao_versao ?? 0);
        await db.query('update core.sessao set revogado_em = now() where usuario_id = $1 and revogado_em is null', [alvo.id]);
        const empresa = await empresaDoTenant(db);
        const envio = await enviarEmail(ctx, db, {
          modelo: semSenha ? 'acesso_inicial' : 'nova_senha',
          usuario_id: alvo.id,
          para: alvo.email,
          dados: { nome: alvo.nome, empresa_nome: empresa.nome, codigo_empresa: empresa.codigo, login: alvo.email, senha, validade_horas: SENHA_TEMPORARIA_HORAS, apps: appsDosPerfis(await perfisDoUsuarioNoLogin(db, alvo.id, alvo.perfil as Perfil)), ...(semSenha ? {} : { motivo: 'redefinida' as const }) },
          chave_idempotencia: `${alvo.id}:redefinida:${versao}`,
        });
        // RN-AUD-01: o fato, nunca a senha nem o hash
        await auditar(db, ctx, { acao: 'usuario.senha_redefinir', entidade: 'usuario', entidadeId: alvo.id, antes: null, depois: { trocar_senha: true, sessoes_revogadas: true, gerada: informada === undefined, email: envio } });
        return { ok: true as const, email_acesso: envio };
      }),
  },
];
