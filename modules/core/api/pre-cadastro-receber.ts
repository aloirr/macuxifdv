/**
 * Gravação do pré-cadastro de cliente (RF-CORE-10; RN-CORE-16, RN-CORE-78, RN-CORE-79; ADR 0069): uma função só para a rota do BKO
 * (`POST clientes/pre-cadastro`), a correção do BKO (`PUT clientes/:id/pre-cadastro`) e o receptor do push `cliente_pre_cadastro`.
 *  - Sem `revisao_base` = criação: idempotente pelo id; revalida os obrigatórios da lista única (`cliente.campos_obrigatorios`);
 *    documento de outro cliente vivo bloqueia (409), salvo o recusado, que o `id` novo do APK v1.0.28 substitui herdando o histórico
 *    como a revisão seguinte (ADR 0069 §4); 23505 decidido por `decidirConflitoUnicidade` (§5).
 *  - Com `revisao_base` = correção do recusado no mesmo cliente: `decidirReenvioPreCadastro` (revisão nova, repetição idempotente,
 *    409 REVISAO_DESATUALIZADA, 422 CADASTRO_NAO_RECUSADO); publica `core.cliente.pre_cadastro_revisado@1` e `core.cliente.atualizado@1`.
 * Cada revisão grava uma tentativa em `core.cliente_pre_cadastro_tentativa` (migração 0098). O hash (sha256 do canônico) nunca vai a
 * log, à auditoria nem a evento; a auditoria leva só nomes de campo, revisão e origem.
 */
import { createHash } from 'node:crypto';
import {
  ErroHttpModulo,
  ErroRegraNegocio,
  pode,
  type ClienteBanco,
  type ContextoBase,
  type ItemPush,
  type ResultadoItemPush,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import {
  EVENTO_CLIENTE_ATUALIZADO,
  EVENTO_CLIENTE_PRE_CADASTRADO,
  EVENTO_CLIENTE_PRE_CADASTRO_REVISADO,
  COLUNAS_ENDERECO_PRE_CADASTRO,
  HTTP_ERRO_PRE_CADASTRO,
  MENSAGENS_CAMPO_FALTANTE,
  MENSAGENS_ERRO_PRE_CADASTRO,
  PARAMETRO_CAMPOS_OBRIGATORIOS,
  type CodigoErroPreCadastro,
  type OrigemTentativa,
  type PreCadastroCliente,
  type PreCadastroClienteSaida,
  type StatusCadastro,
} from '../contracts';
import {
  FALTA_OBRIGATORIO_PRE_CADASTRO,
  camposAlteradosPreCadastro,
  camposExigidos,
  canonicalPreCadastro,
  decidirConflitoUnicidade,
  decidirDocumentoDuplicado,
  decidirReenvioPreCadastro,
  idDoPayloadConfere,
  validarPreCadastro,
  type DadosPreCadastro,
} from '../domain';
import { auditar } from './auditoria';
import { lerParametroCore } from './parametro-tenant';
import { carteiraDoEvento } from './rotas';

/** Dados do pré-cadastro com o id e a origem já decididos por quem chama (push = campo; PUT do BKO = bko). */
export type EntradaPreCadastro = Omit<PreCadastroCliente, 'origem'> & { origem: OrigemTentativa };

type Contexto = Pick<ContextoBase, 'usuario' | 'requestId'>;

/** Colunas de dados gravadas em `core.cliente` (as mesmas do canônico; o documento já vem só com dígitos do contrato). */
const COLUNAS_DADOS = ['razao_social', 'nome_fantasia', 'documento', 'inscricao_estadual', 'telefone', 'email', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'latitude', 'longitude', 'filial_id'] as const;
const SELECT_DADOS = `razao_social, nome_fantasia, documento, inscricao_estadual, telefone, email, logradouro, numero, bairro, cidade, uf, cep,
  latitude::float8 as latitude, longitude::float8 as longitude, filial_id`;

/** sha256 do canônico v1 (ADR 0069 §2), hexadecimal minúsculo. Nunca vai a log. */
export function hashPreCadastro(dados: DadosPreCadastro): string {
  return createHash('sha256').update(canonicalPreCadastro(dados), 'utf8').digest('hex');
}

/** Erro da regra com o HTTP e o texto do contrato (fonte única: API, receptor do push, app e BKO). */
export function erroPreCadastro(codigo: Exclude<CodigoErroPreCadastro, 'CAMPOS_OBRIGATORIOS'>): ErroHttpModulo {
  return new ErroHttpModulo(HTTP_ERRO_PRE_CADASTRO[codigo], codigo, MENSAGENS_ERRO_PRE_CADASTRO[codigo]);
}

const ENDERECO = new Set<string>(COLUNAS_ENDERECO_PRE_CADASTRO);
const MENSAGEM_POR_COLUNA = MENSAGENS_CAMPO_FALTANTE as Readonly<Record<string, string>>;

/**
 * RN-CORE-79: revalida pela lista única do tenant (`validarPreCadastro`). O 422 junta os textos "Preencha ..." do contrato (o campo de
 * endereço vira "Preencha o endereço." uma vez, o texto que o APK v1.0.28 reconhece) e os de formato; nos detalhes, só as chaves.
 */
async function exigirObrigatorios(db: ClienteBanco, dados: DadosPreCadastro): Promise<void> {
  const exigidos = camposExigidos((await lerParametroCore(db, PARAMETRO_CAMPOS_OBRIGATORIOS))[0]?.valor);
  const r = validarPreCadastro(dados, exigidos);
  if (r.ok) return;
  const textos = new Set<string>();
  for (const [coluna, erro] of Object.entries(r.erros)) {
    if (erro !== FALTA_OBRIGATORIO_PRE_CADASTRO) textos.add(`${erro}.`);
    else textos.add(MENSAGEM_POR_COLUNA[ENDERECO.has(coluna) ? 'endereco' : coluna] ?? MENSAGENS_CAMPO_FALTANTE.endereco);
  }
  throw new ErroRegraNegocio('CAMPOS_OBRIGATORIOS', [...textos].join(' '), { campos: Object.keys(r.erros) });
}

const valoresDados = (c: EntradaPreCadastro): unknown[] => COLUNAS_DADOS.map((k) => c[k] ?? null);

interface Tentativa {
  clienteId: string;
  revisao: number;
  hash: string;
  origem: OrigemTentativa;
  camposAlterados: readonly string[];
}

async function gravarTentativa(db: ClienteBanco, ctx: Contexto, t: Tentativa): Promise<void> {
  const quem = ctx.usuario.id ?? null;
  await db.query(
    `insert into core.cliente_pre_cadastro_tentativa (tenant_id, cliente_id, revisao, hash, origem, corrigido_por, corrigido_por_perfil, campos_alterados, enviado_em)
     values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7::text[], now())`,
    [t.clienteId, t.revisao, t.hash, t.origem, quem, quem ? ctx.usuario.perfil : null, t.camposAlterados],
  );
}

const saida = (id: string, status: StatusCadastro | null, revisao: number | null, jaExistia: boolean): PreCadastroClienteSaida => ({
  id,
  status_cadastro: status ?? 'aprovado',
  revisao: revisao ?? 1,
  ja_existia: jaExistia,
});

interface LinhaCliente {
  status_cadastro: StatusCadastro | null;
  revisao_cadastro: number | null;
}

/** RN-CORE-78: criação (com a substituição do recusado pelo `id` novo do APK v1.0.28) ou correção, conforme `revisao_base`. */
export async function gravarPreCadastro(db: ClienteBanco, tx: TransacaoTenant, ctx: Contexto, c: EntradaPreCadastro): Promise<PreCadastroClienteSaida> {
  return c.revisao_base == null ? criarPreCadastro(db, tx, ctx, c) : corrigirPreCadastro(db, tx, ctx, c, c.revisao_base);
}

async function criarPreCadastro(db: ClienteBanco, tx: TransacaoTenant, ctx: Contexto, c: EntradaPreCadastro): Promise<PreCadastroClienteSaida> {
  const existente = (await db.query<LinhaCliente>('select status_cadastro, revisao_cadastro from core.cliente where id = $1 and deleted_at is null', [c.id])).rows[0];
  if (existente) return saida(c.id, existente.status_cadastro, existente.revisao_cadastro, true);
  await exigirObrigatorios(db, c);
  const iguais = (await db.query<LinhaCliente & { id: string }>('select id, status_cadastro, revisao_cadastro from core.cliente where documento = $1 and deleted_at is null', [c.documento])).rows;
  const duplicado = decidirDocumentoDuplicado(iguais);
  if (duplicado.bloqueia) throw erroPreCadastro('DOCUMENTO_JA_CADASTRADO');
  const substituido = duplicado.substituir;
  const antes = substituido ? (await db.query<DadosPreCadastro>(`select ${SELECT_DADOS} from core.cliente where id = $1`, [substituido.id])).rows[0] : undefined;
  const revisao = substituido ? substituido.revisao + 1 : 1;
  let recebidoEm: Date | string;
  let filialGravada: string | null = null;
  // A substituição e o insert desfazem juntos se a unicidade estourar (corrida): nada do recusado muda sem o novo gravado.
  await db.query('savepoint pre_cadastro');
  try {
    for (const idRecusado of duplicado.remover) {
      await db.query('update core.cliente set deleted_at = now() where id = $1', [idRecusado]);
      await auditar(db, ctx, { acao: 'cliente.recusado_substituido', entidade: 'cliente', entidadeId: idRecusado, antes: { status_cadastro: 'recusado' }, depois: { substituido_por: c.id, regra: 'RN-CORE-78' } });
    }
    const gravado = (
      await db.query<{ created_at: Date | string; filial_id: string }>(
        `insert into core.cliente (id, tenant_id, ${COLUNAS_DADOS.join(', ')}, origem_cadastro, status_cadastro, revisao_cadastro)
         values ($1, plataforma.tenant_atual(), ${COLUNAS_DADOS.map((_, i) => `$${i + 2}`).join(', ')}, $${COLUNAS_DADOS.length + 2}, 'pendente', $${COLUNAS_DADOS.length + 3}) returning created_at, filial_id`,
        [c.id, ...valoresDados(c), c.origem, revisao],
      )
    ).rows[0]!;
    recebidoEm = gravado.created_at;
    // RN-CORE-39: sem filial no pedido, o banco grava a padrão; o hash e os campos alterados são os dos dados gravados
    filialGravada = gravado.filial_id;
    await db.query('release savepoint pre_cadastro');
  } catch (e) {
    if ((e as { code?: string }).code !== '23505') throw e;
    await db.query('rollback to savepoint pre_cadastro');
    const porId = (await db.query<LinhaCliente & { apagado: boolean }>('select status_cadastro, revisao_cadastro, deleted_at is not null as apagado from core.cliente where id = $1', [c.id])).rows[0] ?? null;
    const porDocumento = (await db.query<{ id: string }>('select id from core.cliente where documento = $1 and deleted_at is null', [c.documento])).rows[0] ?? null;
    const d = decidirConflitoUnicidade({ restricao: (e as { constraint?: string }).constraint, id: c.id, porId, porDocumento });
    if (d.resposta === 'relancar') throw e;
    if (d.resposta === 'erro') throw erroPreCadastro(d.codigo);
    return saida(c.id, d.status_cadastro, porId?.revisao_cadastro ?? null, true);
  }
  if (substituido) {
    // ADR 0069 §4: as tentativas do recusado passam ao novo; `cliente_id_original` é o alias (Y -> X), mantido nas já herdadas.
    await db.query('update core.cliente_pre_cadastro_tentativa set cliente_id_original = coalesce(cliente_id_original, cliente_id), cliente_id = $1 where cliente_id = $2', [c.id, substituido.id]);
  }
  if (ctx.usuario.perfil === 'vendedor' && ctx.usuario.id) {
    await db.query("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'vendedor')", [c.id, ctx.usuario.id]);
  }
  const gravados = { ...c, filial_id: filialGravada };
  const camposAlterados = antes ? camposAlteradosPreCadastro(antes, gravados) : [];
  await gravarTentativa(db, ctx, { clienteId: c.id, revisao, hash: hashPreCadastro(gravados), origem: c.origem, camposAlterados });
  await auditar(db, ctx, { acao: 'cliente.pre_cadastrar', entidade: 'cliente', entidadeId: c.id, antes: null, depois: { origem: c.origem, status_cadastro: 'pendente', revisao } });
  await tx.publicar(EVENTO_CLIENTE_PRE_CADASTRADO, { cliente_id: c.id, recebido_em: new Date(recebidoEm).toISOString() }, c.id);
  return saida(c.id, 'pendente', revisao, false);
}

async function corrigirPreCadastro(db: ClienteBanco, tx: TransacaoTenant, ctx: Contexto, pedido: EntradaPreCadastro, revisaoBase: number): Promise<PreCadastroClienteSaida> {
  const atual = (
    await db.query<DadosPreCadastro & LinhaCliente>(
      `select ${SELECT_DADOS}, status_cadastro, revisao_cadastro from core.cliente where id = $1 and deleted_at is null and revisao_cadastro is not null for update`,
      [pedido.id],
    )
  ).rows[0];
  // RN-CORE-39: sem filial no pedido, fica a do cliente (o banco nunca a deixa nula); hash e campos alterados sobre os dados que ficam
  const c: EntradaPreCadastro = { ...pedido, filial_id: pedido.filial_id ?? (atual?.filial_id as string | null | undefined) ?? null };
  const hash = hashPreCadastro(c);
  const hashAtual = atual
    ? ((await db.query<{ hash: string | null }>('select hash from core.cliente_pre_cadastro_tentativa where cliente_id = $1 and revisao = $2', [c.id, atual.revisao_cadastro])).rows[0]?.hash ?? null)
    : null;
  const d = decidirReenvioPreCadastro(atual ? { status_cadastro: atual.status_cadastro, revisao_cadastro: atual.revisao_cadastro!, hash_atual: hashAtual } : null, { revisao_base: revisaoBase, hash });
  if (d.acao === 'recusar') throw erroPreCadastro(d.codigo);
  if (d.acao === 'repetido') return saida(c.id, atual!.status_cadastro, atual!.revisao_cadastro, true);
  await exigirObrigatorios(db, c);
  const outro = (await db.query('select 1 from core.cliente where documento = $1 and id <> $2 and deleted_at is null limit 1', [c.documento, c.id])).rows[0];
  if (outro) throw erroPreCadastro('DOCUMENTO_JA_CADASTRADO');
  const camposAlterados = camposAlteradosPreCadastro(atual!, c);
  await db.query('savepoint pre_cadastro_correcao');
  try {
    await db.query(
      `update core.cliente set ${COLUNAS_DADOS.map((k, i) => `${k} = $${i + 2}`).join(', ')},
              status_cadastro = 'pendente', motivo_recusa = null, erros_recusa = null, revisao_cadastro = $${COLUNAS_DADOS.length + 2}
        where id = $1`,
      [c.id, ...valoresDados(c), d.revisao],
    );
    await db.query('release savepoint pre_cadastro_correcao');
  } catch (e) {
    // corrida do mesmo CPF/CNPJ com outro cliente gravado entre a conferência e o update
    if ((e as { code?: string; constraint?: string }).code !== '23505' || (e as { constraint?: string }).constraint !== 'cliente_documento_uk') throw e;
    await db.query('rollback to savepoint pre_cadastro_correcao');
    throw erroPreCadastro('DOCUMENTO_JA_CADASTRADO');
  }
  await gravarTentativa(db, ctx, { clienteId: c.id, revisao: d.revisao, hash, origem: c.origem, camposAlterados });
  await auditar(db, ctx, { acao: 'cliente.pre_cadastro_corrigir', entidade: 'cliente', entidadeId: c.id, antes: null, depois: { revisao: d.revisao, campos_alterados: camposAlterados, origem: c.origem } });
  const revisadoEm = (await db.query<{ agora: Date | string }>('select now() as agora')).rows[0]!.agora;
  await tx.publicar(EVENTO_CLIENTE_PRE_CADASTRO_REVISADO, { cliente_id: c.id, revisao: d.revisao, origem: c.origem, revisado_em: new Date(revisadoEm).toISOString() }, c.id);
  await tx.publicar(
    EVENTO_CLIENTE_ATUALIZADO,
    { cliente_id: c.id, campos: [...camposAlterados, 'status_cadastro', 'revisao_cadastro'], origem: c.origem, ...(await carteiraDoEvento(db, c.id)) },
    c.id,
  );
  return saida(c.id, 'pendente', d.revisao, false);
}

export const ACAO_PRE_CADASTRAR = 'cliente.pre_cadastrar';

const aceito = (id: string): ResultadoItemPush => ({ id, status: 'aceito' });
const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });

/**
 * Receptor do push `cliente_pre_cadastro` (ADR 0069 §3; RN-CORE-78): cada item na própria transação, pelo mesmo caminho da rota
 * (`gravarPreCadastro`, origem `campo`). Ação `cliente.pre_cadastrar`; a correção (`revisao_base`) só para cliente da carteira do
 * usuário (RN-CORE-04, `FORA_DA_CARTEIRA`). Licença do Core pelo SDK (`rejeitarItensInvalidos`). Aceito inclui o `ja_existia`;
 * a regra recusada vira `rejeitado` com o código e o texto do contrato.
 */
export async function receberPreCadastros(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saidaItens: ResultadoItemPush[] = [];
  const podePreCadastrar = pode(ctx.usuario.perfis, ACAO_PRE_CADASTRAR);
  let visiveis: ReadonlySet<string> | 'tenant' | null = null;
  for (const item of itens) {
    if (item.operacao === 'remover') {
      saidaItens.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'O pré-cadastro não pode ser removido pelo aparelho.'));
      continue;
    }
    if (!idDoPayloadConfere(item.id, item.payload as { id?: unknown })) {
      saidaItens.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.'));
      continue;
    }
    if (!podePreCadastrar) {
      saidaItens.push(rejeitado(item.id, 'PERFIL_SEM_ACESSO', 'Seu perfil não pode cadastrar cliente.'));
      continue;
    }
    const p = item.payload as PreCadastroCliente;
    if (p.revisao_base != null) {
      visiveis ??= await ctx.carteira();
      if (visiveis !== 'tenant' && !visiveis.has(p.id)) {
        saidaItens.push(rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.'));
        continue;
      }
    }
    try {
      await ctx.comTenant((db, tx) => gravarPreCadastro(db, tx, ctx, { ...p, origem: 'campo' }));
      saidaItens.push(aceito(item.id));
    } catch (e) {
      if (!(e instanceof ErroHttpModulo) || e.status >= 500) throw e;
      saidaItens.push(rejeitado(item.id, e.codigo, e.message));
    }
  }
  return saidaItens;
}
