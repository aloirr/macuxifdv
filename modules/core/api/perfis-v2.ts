/**
 * Perfis pelo cargo (ADR 0073 §4.2, etapa E4b; RN-CORE-35, RN-CORE-34, RN-CORE-33, RN-CORE-04, RN-CORE-02, RN-PRO-01): perfil = nome + cargo +
 * o conjunto das permissões concedidas (`plataforma.perfil_concessao`). Escrita só com `perfil.gerir`; a API revalida tudo.
 * Toda escrita trava os perfis, monta o estado do tenant (perfis, concessões e usuários) e roda `validarAcessoPeloCargo` (SDK) antes de gravar:
 * a mesma regra existe no banco como rede de segurança (gatilho `perfil_concessao_travas`). Auditoria `perfil.criar|alterar|apagar` (RN-AUD-01).
 *
 * ADITIVO: as rotas de `perfis.ts` (com base) seguem como estão e saem na E6. Os caminhos daqui são os FINAIS de `/v1/core` e colidem com
 * os antigos, por isso `rotasDePerfisV2` ainda NÃO está em `index.ts`: a E6 troca `rotasDePerfis` por esta lista (e mantém o `historico`
 * antigo, que não muda). Enquanto o tenant está na janela de transição, `plataforma.perfil.base` (NOT NULL) é gravada com o valor de
 * compatibilidade (`perfilDeCompatibilidade`), e o espelho da 0107 refaz as concessões ao inserir o perfil ou trocar o cargo; a gravação
 * das concessões vem DEPOIS, então o que vale é o enviado.
 */
import {
  CATALOGO_PERMISSOES_VERSAO,
  ErroHttpModulo,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  MODELOS_PERFIL,
  perfilDeCompatibilidade,
  resolverPerfilPeloCargo,
  validarAcessoPeloCargo,
  type Cargo,
  type ClienteBanco,
  type ContextoBase,
  type DefinicaoChave,
  type ModeloPerfil,
  type ModelosDePerfil,
  type ModuloId,
  type PerfilPorCargo,
  type RotaModulo,
  type UsuarioPorCargo,
  type ValorPermissao,
  type ViolacaoLimite,
} from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  CatalogoRespostaSchema,
  CODIGO_REPETIDO,
  CODIGOS_ERRO_PERFIL_V2,
  CODIGOS_PERFIL,
  CriarPerfilRequestV2Schema,
  EditarPerfilRequestV2Schema,
  MENSAGEM_PERFIL_REPETIDO,
  PerfilDetalheV2Schema,
  PerfilListaRespostaV2Schema,
  PerfilOpcoesRespostaV2Schema,
  PerfilResumoV2Schema,
  type PerfilDetalheV2,
  type PerfilResumoV2,
} from '../contracts';
import {
  aplicarCopiarDe,
  codigoDoPerfil,
  conferirTravaOtimista,
  diffConcessoes,
  montarCatalogoPorArea,
  montarDetalheV2,
  moduloLicenciado,
  nomeJaUsado,
  ondeEntraPeloCargo,
  permissoesDoCorpo,
  validarNomeDoPerfil,
  valorDaConcessao,
  violacoesNovas,
  type MapaDeConcessoes,
} from '../domain';
import { auditar } from './auditoria';

/** Chaves que o aparelho depende e que a tabela nunca mostra: ficam como estão no perfil (e nascem com ele). */
const FORA_DA_TELA = new Set(['notificacao.ler', 'dispositivo.registrar_push', 'app.atualizar', 'parametro.promotor_ve_pedidos']);

interface LinhaPerfil {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  cargo: Cargo;
  ativo: boolean;
  fabrica: boolean;
  /** `updated_at` em ISO (UTC, milissegundos): a trava otimista (ADR 0073 §4.2). */
  atualizado_em: string;
}

interface Estado {
  linhas: LinhaPerfil[];
  perfis: PerfilPorCargo[];
  usuarios: UsuarioPorCargo[];
}

const semTela = (catalogo: readonly DefinicaoChave[]) => catalogo.filter((d) => !FORA_DA_TELA.has(d.chave));

const catalogoDoMotor = (ctx: ContextoBase): readonly DefinicaoChave[] => ctx.permissoes?.catalogo ?? [];

/** Módulos licenciados no tenant (RN-CORE-02); o Core é sempre licenciado. */
async function licencasDoTenant(db: ClienteBanco): Promise<Set<ModuloId>> {
  const r = await db.query<{ modulo: ModuloId }>('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null');
  return new Set<ModuloId>(['core', ...r.rows.map((x) => x.modulo)]);
}

/** Perfis vivos com as concessões e os usuários com o seu perfil. `travar` = `for update` nos perfis (escrita). */
async function carregar(db: ClienteBanco, travar: boolean): Promise<Estado> {
  const lock = travar ? ' for update' : '';
  // RN-CORE-35: escritas de perfil se serializam por tenant ANTES de ler; assim a checagem de nome/código vê o que a outra transação gravou
  if (travar) await db.query("select pg_advisory_xact_lock(hashtextextended('perfis:' || plataforma.tenant_atual()::text, 0))");
  const ps = await db.query<LinhaPerfil>(
    `select id, codigo, nome, descricao, cargo, ativo, fabrica, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as atualizado_em
       from plataforma.perfil where deleted_at is null order by codigo${lock}`,
  );
  const cs = await db.query<{ perfil_id: string; chave: string; nivel: ValorPermissao['nivel'] | null; alvos: string[] | null }>(
    'select perfil_id, chave, nivel, alvos from plataforma.perfil_concessao where deleted_at is null order by chave',
  );
  const us = await db.query<{ id: string; ativo: boolean; perfil: string | null }>(
    `select u.id, u.ativo, (array_agg(p.codigo order by p.codigo) filter (where p.codigo is not null))[1] as perfil
       from core.usuario u
       left join plataforma.usuario_perfil up on up.usuario_id = u.id and up.deleted_at is null
       left join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
      where u.deleted_at is null group by u.id, u.ativo order by u.id`,
  );
  const porPerfil = new Map<string, Record<string, ValorPermissao>>();
  for (const c of cs.rows) {
    const m = porPerfil.get(c.perfil_id) ?? {};
    m[c.chave] = valorDaConcessao(c.nivel, c.alvos);
    porPerfil.set(c.perfil_id, m);
  }
  const perfis: PerfilPorCargo[] = ps.rows.map((p) => ({ id: p.id, codigo: p.codigo, nome: p.nome, cargo: p.cargo, ativo: p.ativo, permissoes: porPerfil.get(p.id) ?? {} }));
  return { linhas: ps.rows, perfis, usuarios: us.rows };
}

/** Os 7 modelos da versão mais nova do catálogo (`plataforma.modelo_permissao`): só para "copiar de um modelo" e para o que nasce com o perfil. */
async function carregarModelos(db: ClienteBanco): Promise<ModelosDePerfil> {
  const r = await db.query<{ modelo: ModeloPerfil; cargo: Cargo; chave: string; nivel: ValorPermissao['nivel'] | null; alvos: string[] | null }>(
    `select modelo, cargo, chave, nivel, alvos from plataforma.modelo_permissao
      where deleted_at is null and versao = (select max(versao) from plataforma.modelo_permissao where deleted_at is null)`,
  );
  const m = Object.fromEntries(MODELOS_PERFIL.map((x) => [x, { cargo: 'vendedor' as Cargo, permissoes: {} as Record<string, ValorPermissao> }])) as Record<ModeloPerfil, { cargo: Cargo; permissoes: Record<string, ValorPermissao> }>;
  for (const l of r.rows) {
    m[l.modelo].cargo = l.cargo;
    m[l.modelo].permissoes[l.chave] = valorDaConcessao(l.nivel, l.alvos);
  }
  return m as unknown as ModelosDePerfil;
}

const naoEncontrado = () => new ErroNaoEncontrado(CODIGOS_PERFIL.naoEncontrado, 'Este perfil não existe mais. Atualize a lista.');
const dadosInvalidos = (mensagem: string, campo: string) => new ErroRegraNegocio(CODIGOS_PERFIL.dadosInvalidos, mensagem, { campos: [{ campo, mensagem }] });
const repetido = () => new ErroRegraNegocio(CODIGO_REPETIDO, MENSAGEM_PERFIL_REPETIDO, { regra: 'RN-CORE-35' });
const CodigoParam = z.object({ codigo: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/) });

/** 422 com o `codigo` da violação e a RN em `detalhes.regra` (a do perfil escrito primeiro). */
function recusar(violacoes: readonly ViolacaoLimite[], perfil: string | null): never {
  const ordenadas = [...violacoes].sort((a, b) => Number(b.perfil === perfil) - Number(a.perfil === perfil));
  const v = ordenadas[0]!;
  throw new ErroRegraNegocio(v.codigo, v.mensagem, {
    regra: v.regra,
    violacoes: ordenadas.slice(0, 5).map(({ codigo, regra, mensagem, perfil: p, chave }) => ({ codigo, regra, mensagem, perfil: p, chave })),
  });
}

/** `validarAcessoPeloCargo` sobre o estado depois da escrita; só segura o que a escrita traz de novo (ver `violacoesNovas`). */
function conferir(ctx: ContextoBase, antes: Estado, depois: Pick<Estado, 'perfis' | 'usuarios'>, licencas: ReadonlySet<ModuloId>, perfilEscrito: string | null): void {
  const catalogo = catalogoDoMotor(ctx);
  const comum = { catalogo: catalogo.length > 0 ? catalogo : undefined, licencas };
  const estadoAntes = { perfis: antes.perfis, usuarios: antes.usuarios };
  const doDepois = validarAcessoPeloCargo({ ...comum, antes: estadoAntes, depois, atorId: ctx.usuario.id ?? undefined });
  if (doDepois.length === 0) return;
  const jaTinha = validarAcessoPeloCargo({ ...comum, depois: estadoAntes });
  const novas = violacoesNovas(jaTinha, doDepois, perfilEscrito);
  if (novas.length > 0) recusar(novas, perfilEscrito);
}

const contagemDe = (e: Estado, codigo: string) => e.usuarios.filter((u) => u.perfil === codigo).length;

const modulosDoPerfil = async (db: ClienteBanco, codigo: string): Promise<string[]> =>
  (await db.query<{ modulo: string }>('select modulo from plataforma.perfil_modulo where perfil = $1 and deleted_at is null order by modulo', [codigo])).rows.map((r) => r.modulo);

async function detalheDe(ctx: ContextoBase, db: ClienteBanco, codigo: string): Promise<PerfilDetalheV2> {
  const e = await carregar(db, false);
  const linha = e.linhas.find((l) => l.codigo === codigo);
  const perfil = e.perfis.find((p) => p.codigo === codigo);
  if (!linha || !perfil) throw naoEncontrado();
  return PerfilDetalheV2Schema.parse(
    montarDetalheV2({
      codigo,
      nome: linha.nome,
      descricao: linha.descricao,
      cargo: linha.cargo,
      ativo: linha.ativo,
      usuarios: contagemDe(e, codigo),
      atualizado_em: linha.atualizado_em,
      permissoes: perfil.permissoes,
      catalogo: semTela(catalogoDoMotor(ctx)),
      licencas: await licencasDoTenant(db),
      perfisAtivos: e.perfis.filter((p) => p.ativo).map((p) => ({ codigo: p.codigo, nome: p.nome ?? p.codigo, cargo: p.cargo, permissoes: p.permissoes })),
      modulos: await modulosDoPerfil(db, codigo),
    }),
  );
}

function resumoDe(e: Estado, i: number): PerfilResumoV2 {
  const l = e.linhas[i]!;
  const p = e.perfis[i]!;
  return PerfilResumoV2Schema.parse({ codigo: l.codigo, nome: l.nome, descricao: l.descricao, cargo: l.cargo, ativo: l.ativo, usuarios: contagemDe(e, l.codigo), onde_entra: ondeEntraPeloCargo(l.cargo, p.permissoes) });
}

/** Grava o conjunto no perfil: o que saiu vira soft delete, o que mudou é atualizado e o que entrou é inserido (RN-CORE-35: perfil = o que está marcado). */
async function gravarConcessoes(db: ClienteBanco, perfilId: string, desejado: MapaDeConcessoes): Promise<void> {
  const atual = await db.query<{ chave: string; nivel: ValorPermissao['nivel'] | null; alvos: string[] | null }>(
    'select chave, nivel, alvos from plataforma.perfil_concessao where perfil_id = $1 and deleted_at is null',
    [perfilId],
  );
  const antes: Record<string, ValorPermissao> = {};
  for (const c of atual.rows) antes[c.chave] = valorDaConcessao(c.nivel, c.alvos);
  const { entrou, saiu, mudou } = diffConcessoes(antes, desejado);
  if (saiu.length > 0) await db.query('update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and chave = any($2::text[]) and deleted_at is null', [perfilId, saiu]);
  for (const chave of mudou) {
    const v = desejado[chave]!;
    await db.query('update plataforma.perfil_concessao set nivel = $3, alvos = $4 where perfil_id = $1 and chave = $2 and deleted_at is null', [perfilId, chave, v.nivel ?? null, v.alvos ? [...v.alvos] : null]);
  }
  for (const chave of entrou) {
    const v = desejado[chave]!;
    await db.query('insert into plataforma.perfil_concessao (tenant_id, perfil_id, chave, nivel, alvos) values (plataforma.tenant_atual(), $1, $2, $3, $4)', [perfilId, chave, v.nivel ?? null, v.alvos ? [...v.alvos] : null]);
  }
}

/** Tira o que o tenant não contratou: a cópia nasce do tamanho da empresa (a gravada antes, no PUT, é que fica guardada). */
function soLicenciadas(p: MapaDeConcessoes, catalogo: readonly DefinicaoChave[], licencas: ReadonlySet<ModuloId>): Record<string, ValorPermissao> {
  const modulo = new Map(catalogo.map((d) => [d.chave, d.modulo] as const));
  return Object.fromEntries(Object.entries(p).filter(([c]) => { const m = modulo.get(c); return !m || moduloLicenciado(m, licencas); }));
}

const ordemDaLista = (a: PerfilResumoV2, b: PerfilResumoV2) => Number(!a.ativo) - Number(!b.ativo) || a.nome.localeCompare(b.nome, 'pt-BR');

export const rotasDePerfisV2: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'permissoes/catalogo',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => CatalogoRespostaSchema.parse(montarCatalogoPorArea(semTela(catalogoDoMotor(ctx)), await licencasDoTenant(db), CATALOGO_PERMISSOES_VERSAO))),
  },
  {
    metodo: 'GET',
    caminho: 'perfis',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const e = await carregar(db, false);
        return PerfilListaRespostaV2Schema.parse({ itens: e.linhas.map((_, i) => resumoDe(e, i)).sort(ordemDaLista) });
      }),
  },
  {
    // Cadastro de usuário: quem cria ou edita usuário precisa ver os perfis ativos (nome e cargo; sem permissões)
    metodo: 'GET',
    caminho: 'perfis/opcoes',
    superficie: 'bko',
    acao: 'usuario.ver',
    carteira: 'nao_se_aplica',
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const e = await carregar(db, false);
        const itens = e.linhas
          .map((_, i) => resumoDe(e, i))
          .filter((r) => r.ativo)
          .sort(ordemDaLista)
          .map(({ codigo, nome, cargo, onde_entra }) => ({ codigo, nome, cargo, onde_entra }));
        return PerfilOpcoesRespostaV2Schema.parse({ itens });
      }),
  },
  {
    metodo: 'GET',
    caminho: 'perfis/:codigo',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    params: CodigoParam,
    executar: async (ctx) => ctx.comTenant(async (db) => detalheDe(ctx, db, ctx.params.codigo)),
  },
  {
    metodo: 'POST',
    caminho: 'perfis',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: CriarPerfilRequestV2Schema,
    executar: async (ctx) => {
      const { id, cargo, copiar_de, permissoes } = ctx.corpo;
      const nome = ctx.corpo.nome.trim();
      const descricao = ctx.corpo.descricao?.trim() || null;
      const erros = validarNomeDoPerfil(nome, descricao);
      if (erros[0]) throw dadosInvalidos(erros[0].mensagem, erros[0].campo);
      return ctx.comTenant(async (db) => {
        const e = await carregar(db, true);
        // idempotente pelo id do aparelho: repetir devolve o mesmo perfil, sem gravar nada
        const jaCriado = e.linhas.find((l) => l.id === id);
        if (jaCriado) return detalheDe(ctx, db, jaCriado.codigo);
        const usado = await db.query<{ codigo: string; deleted_at: Date | null }>('select codigo, deleted_at from plataforma.perfil where id = $1', [id]);
        // o mesmo POST em paralelo gravou entre a leitura de cima e esta: é o perfil ativo, a resposta é a idempotente
        if (usado.rows[0] && !usado.rows[0].deleted_at) return detalheDe(ctx, db, usado.rows[0].codigo);
        if (usado.rows[0]) throw dadosInvalidos('Este perfil já foi apagado. Crie de novo.', 'id');
        if (nomeJaUsado(e.linhas, nome)) throw repetido();
        const catalogo = catalogoDoMotor(ctx);
        const licencas = await licencasDoTenant(db);
        const modelos = await carregarModelos(db);
        const modeloDoCargo: ModeloPerfil = cargo === 'administrativo' ? 'assistente' : cargo;
        const copia = copiar_de ? aplicarCopiarDe(copiar_de, cargo, { modelos, perfis: e.perfis }) : null;
        if (copia && !copia.ok) throw dadosInvalidos('Escolha o perfil de origem.', 'copiar_de');
        const origem = copia?.ok ? copia.permissoes : null;
        // as chaves fixas do aparelho nascem com o perfil: da cópia ou, sem ela, do modelo do cargo
        const doModelo = aplicarCopiarDe({ modelo: modeloDoCargo }, cargo, { modelos, perfis: [] });
        const fontesFixas: MapaDeConcessoes = origem ?? (doModelo.ok ? doModelo.permissoes : {});
        const fixas = soLicenciadas(Object.fromEntries(Object.entries(fontesFixas).filter(([c]) => FORA_DA_TELA.has(c))), catalogo, licencas);
        const concedidas: Record<string, ValorPermissao> = permissoes ? { ...permissoesDoCorpo(permissoes), ...fixas } : { ...soLicenciadas(origem ?? {}, catalogo, licencas), ...fixas };
        const codigosUsados = new Set((await db.query<{ codigo: string }>('select codigo from plataforma.perfil')).rows.map((r) => r.codigo));
        const raiz = codigoDoPerfil(nome);
        let codigo = raiz;
        for (let n = 2; codigosUsados.has(codigo); n++) codigo = `${raiz.slice(0, 36)}_${n}`;
        const novo: PerfilPorCargo = { id, codigo, nome, cargo, ativo: true, permissoes: concedidas };
        conferir(ctx, e, { perfis: [...e.perfis, novo], usuarios: e.usuarios }, licencas, codigo);
        const efetivas = resolverPerfilPeloCargo(novo).permissoes;
        // ponto de retorno: o 23505 aborta a transação, e a leitura do que ganhou a corrida precisa dela viva
        await db.query('savepoint perfil_novo');
        try {
          await db.query(
            'insert into plataforma.perfil (id, tenant_id, codigo, nome, descricao, base, fabrica, ativo, cargo) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, false, true, $6)',
            [id, codigo, nome, descricao, perfilDeCompatibilidade(cargo, efetivas), cargo],
          );
          await db.query('release savepoint perfil_novo');
        } catch (erro) {
          const { code, constraint } = erro as { code?: string; constraint?: string };
          if (code !== '23505') throw erro;
          await db.query('rollback to savepoint perfil_novo');
          if (constraint === 'perfil_codigo_uk') throw repetido(); // dois nomes que dão o mesmo código (RN-CORE-35)
          if (constraint === 'perfil_pkey') {
            // o mesmo POST em paralelo já gravou: devolve o perfil, como o POST repetido
            const visivel = await db.query<{ codigo: string }>('select codigo from plataforma.perfil where id = $1 and deleted_at is null', [id]);
            if (visivel.rows[0]) return detalheDe(ctx, db, visivel.rows[0].codigo);
            // o id é chave global: o de outro tenant não aparece (RLS); a resposta não revela de quem é
            throw dadosInvalidos('Este identificador já foi usado. Crie o perfil de novo.', 'id');
          }
          throw erro;
        }
        await gravarConcessoes(db, id, concedidas);
        const origemModulos = copiar_de ? ('perfil' in copiar_de ? copiar_de.perfil : copiar_de.modelo) : modeloDoCargo;
        await db.query(
          `insert into plataforma.perfil_modulo (tenant_id, perfil, modulo)
           select plataforma.tenant_atual(), $1, modulo from plataforma.perfil_modulo where perfil = $2 and deleted_at is null`,
          [codigo, origemModulos],
        );
        await auditar(db, ctx, { acao: 'perfil.criar', entidade: 'perfil', entidadeId: id, antes: null, depois: { codigo, nome, cargo, copiado_de: copiar_de ?? null, permissoes: Object.keys(concedidas).sort() } });
        return detalheDe(ctx, db, codigo);
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
    corpo: EditarPerfilRequestV2Schema,
    executar: async (ctx) => {
      const c0 = ctx.corpo;
      return ctx.comTenant(async (db) => {
        const e = await carregar(db, true);
        const i = e.linhas.findIndex((l) => l.codigo === ctx.params.codigo);
        const linha = e.linhas[i];
        const atual = e.perfis[i];
        if (!linha || !atual) throw naoEncontrado();
        const nome = (c0.nome ?? linha.nome).trim();
        const descricao = c0.descricao === undefined ? linha.descricao : c0.descricao?.trim() || null;
        const ativo = c0.ativo ?? linha.ativo;
        const cargo = c0.cargo ?? linha.cargo;
        const erros = validarNomeDoPerfil(nome, descricao);
        if (erros[0]) throw dadosInvalidos(erros[0].mensagem, erros[0].campo);
        if (linha.fabrica && !ativo) throw new ErroRegraNegocio(CODIGOS_ERRO_PERFIL_V2.padraoFixo, 'Os perfis padrão não podem ser desativados.', { regra: 'RN-CORE-35' });
        if (ativo && nomeJaUsado(e.linhas, nome, linha.id)) throw repetido();
        const desejado: Record<string, ValorPermissao> = permissoesDoCorpo(c0.permissoes);
        // as chaves que a tabela não mostra ficam como estão: não vêm no corpo e não podem virar revogação
        for (const c of FORA_DA_TELA) {
          if (atual.permissoes[c]) desejado[c] = atual.permissoes[c]!;
          else delete desejado[c];
        }
        const diff = diffConcessoes(atual.permissoes, desejado);
        const mudouCadastro = nome !== linha.nome || descricao !== linha.descricao || ativo !== linha.ativo || cargo !== linha.cargo;
        const mudou = mudouCadastro || diff.entrou.length + diff.saiu.length + diff.mudou.length > 0;
        // repetir o mesmo corpo não muda nada (idempotente), mesmo com `atualizado_em` de antes da primeira gravação
        if (!mudou) return detalheDe(ctx, db, linha.codigo);
        const trava = conferirTravaOtimista(linha.atualizado_em, c0.atualizado_em);
        if (!trava.ok) throw new ErroHttpModulo(trava.status, trava.codigo, 'Outra pessoa alterou este perfil enquanto você editava. Recarregue a página e refaça a mudança.');
        const licencas = await licencasDoTenant(db);
        const depois: PerfilPorCargo = { ...atual, nome, cargo, ativo, permissoes: desejado };
        conferir(ctx, e, { perfis: e.perfis.map((p, k) => (k === i ? depois : p)), usuarios: e.usuarios }, licencas, linha.codigo);
        // o cargo só entra no `set` quando muda (o espelho da 0107 reage a `update of cargo`); as concessões vêm depois
        await db.query(
          `update plataforma.perfil set nome = $2, descricao = $3, ativo = $4${cargo !== linha.cargo ? ', cargo = $5' : ''} where id = $1`,
          cargo !== linha.cargo ? [linha.id, nome, descricao, ativo, cargo] : [linha.id, nome, descricao, ativo],
        );
        await gravarConcessoes(db, linha.id, desejado);
        await auditar(db, ctx, {
          acao: 'perfil.alterar',
          entidade: 'perfil',
          entidadeId: linha.id,
          antes: { codigo: linha.codigo, nome: linha.nome, descricao: linha.descricao, ativo: linha.ativo, cargo: linha.cargo, permissoes: Object.fromEntries([...diff.saiu, ...diff.mudou].map((c) => [c, atual.permissoes[c]])) },
          depois: { codigo: linha.codigo, nome, descricao, ativo, cargo, permissoes: Object.fromEntries([...diff.entrou, ...diff.mudou].map((c) => [c, desejado[c]])) },
        });
        return detalheDe(ctx, db, linha.codigo);
      });
    },
  },
  {
    metodo: 'DELETE',
    caminho: 'perfis/:codigo',
    superficie: 'bko',
    acao: 'perfil.gerir',
    carteira: 'nao_se_aplica',
    status: 204,
    params: CodigoParam,
    executar: async (ctx) =>
      ctx.comTenant(async (db) => {
        const e = await carregar(db, true);
        const i = e.linhas.findIndex((l) => l.codigo === ctx.params.codigo);
        const linha = e.linhas[i];
        const atual = e.perfis[i];
        if (!linha || !atual) throw naoEncontrado();
        if (linha.fabrica) throw new ErroRegraNegocio(CODIGOS_ERRO_PERFIL_V2.padraoFixo, 'Os perfis padrão não podem ser apagados.', { regra: 'RN-CORE-35' });
        conferir(ctx, e, { perfis: e.perfis.filter((_, k) => k !== i), usuarios: e.usuarios }, await licencasDoTenant(db), linha.codigo);
        await db.query('update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and deleted_at is null', [linha.id]);
        await db.query('update plataforma.perfil set deleted_at = now() where id = $1', [linha.id]);
        await auditar(db, ctx, { acao: 'perfil.apagar', entidade: 'perfil', entidadeId: linha.id, antes: { codigo: linha.codigo, nome: linha.nome, cargo: linha.cargo, permissoes: Object.keys(atual.permissoes).sort() }, depois: null });
        return null;
      }),
  },
];
