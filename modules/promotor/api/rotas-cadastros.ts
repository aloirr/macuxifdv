/**
 * Rotas REST dos cadastros de trade do BKO (`/v1/promotor/cadastros/*`; T-0069, RF-PRO-11). O `createApp` aplica login,
 * LICENÇA do módulo, perfil (leitura: `PERFIS_RELATORIO`; escrita: ação `*.gerenciar` do manifesto = analista e admin,
 * então o supervisor recebe 403), Zod do corpo (que chama o domain: RN-PRO-03/06/10) e tenant do token (RLS).
 * Por cadastro: listar, criar (idempotente pelo `id` do cliente), editar (PUT por id) e desativar (DELETE por id =
 * desativação lógica, nunca apaga). Toda escrita grava auditoria (RN-AUD-01, só ids, códigos e valores, sem nomes) na mesma
 * transação. As escritas renovam `updated_at` (e `deleted_at` ao desativar) nas MESMAS tabelas que o pull lê
 * (`sync-cadastros.ts`): a promotora recebe a mudança no próximo pull, sem migração. RN-PRO-01: nada de pedido aqui.
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { ErroHttpModulo, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  ACAO_CADASTRO,
  CADASTROS_BKO,
  CAMINHO_CADASTRO,
  CAMINHO_PARAMETROS_TRADE,
  EDICAO_CADASTRO,
  FiltroCadastro,
  IdCadastroParams,
  PERFIS_RELATORIO,
  type CadastroBko,
  type ParametrosTradeApi,
} from '../contracts';
import { mesmoConteudo } from '../domain';
import { parametrosDoTenant } from './parametros';
import type { LinhaCadastro, RepositorioPromotor, SessaoTenant } from './repositorio';

/** O que cada cadastro aponta para outros (validado antes de gravar, com mensagem em português). */
const REFERENCIAS: Readonly<Record<CadastroBko, { categoria?: boolean; concorrente?: boolean; cliente?: boolean; produto?: boolean }>> = {
  categoria_gondola: {},
  checklist_loja: { cliente: true },
  mix_obrigatorio: { categoria: true, cliente: true, produto: true },
  meta_share: { categoria: true, cliente: true },
  concorrente: {},
  produto_concorrente: { categoria: true, concorrente: true, produto: true },
};

const naoEncontrado = () => new ErroHttpModulo(404, 'CADASTRO_NAO_ENCONTRADO', 'Cadastro não encontrado. Recarregue a lista.');

/** RN-AUD-01: só ids, códigos e valores (nunca o nome da categoria, do concorrente ou do produto). */
export function resumoParaAuditoria(c: CadastroBko, l: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const alvo = { cliente_id: l.cliente_id ?? null, segmento: l.segmento ?? null, vigencia_inicio: l.vigencia_inicio, vigencia_fim: l.vigencia_fim ?? null };
  switch (c) {
    case 'categoria_gondola':
      return { ordem: l.ordem, ativo: l.ativo };
    case 'concorrente':
      return { ativo: l.ativo };
    case 'produto_concorrente':
      return { concorrente_id: l.concorrente_id, produto_id: l.produto_id ?? null, categoria_gondola_id: l.categoria_gondola_id ?? null, ativo: l.ativo };
    case 'meta_share':
      return { categoria_gondola_id: l.categoria_gondola_id, meta_pct: l.meta_pct, ...alvo };
    case 'mix_obrigatorio':
      return { produto_id: l.produto_id, categoria_gondola_id: l.categoria_gondola_id ?? null, ...alvo };
    case 'checklist_loja': {
      const itens = (l.itens as { obrigatoria: boolean }[] | undefined) ?? [];
      return { etapas: itens.length, obrigatorias: itens.filter((i) => i.obrigatoria).length, ...alvo };
    }
  }
}

/** Categoria e concorrente têm de existir e estar vivos; loja e produto, no Core (ADR 0012). */
async function conferirReferencias(repo: RepositorioPromotor, s: SessaoTenant, tx: TransacaoTenant, c: CadastroBko, d: Readonly<Record<string, unknown>>): Promise<void> {
  const ref = REFERENCIAS[c];
  const vivo = async (cad: CadastroBko, id: unknown, msg: string) => {
    if (typeof id !== 'string') return;
    const l = await repo.cadastro(s, cad, id);
    if (!l || l.deleted_at) throw new ErroHttpModulo(422, 'REFERENCIA_INVALIDA', msg);
  };
  if (ref.categoria) await vivo('categoria_gondola', d.categoria_gondola_id, 'A categoria escolhida não existe ou foi desativada. Escolha outra.');
  if (ref.concorrente) await vivo('concorrente', d.concorrente_id, 'O concorrente escolhido não existe ou foi desativado. Escolha outro.');
  const cliente = ref.cliente && typeof d.cliente_id === 'string' ? d.cliente_id : null;
  const produto = ref.produto && typeof d.produto_id === 'string' ? d.produto_id : null;
  if (!cliente && !produto) return;
  const r = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: cliente ? [cliente] : [], produto_ids: produto ? [produto] : [], usuario_ids: [] });
  if (cliente && !r.clientes.some((x) => x.id === cliente)) throw new ErroHttpModulo(422, 'REFERENCIA_INVALIDA', 'A loja escolhida não foi encontrada no cadastro de clientes.');
  if (produto && !r.produtos.some((x) => x.id === produto)) throw new ErroHttpModulo(422, 'REFERENCIA_INVALIDA', 'O produto escolhido não foi encontrado no cadastro de produtos.');
}

export function criarRotasCadastros(repo: RepositorioPromotor): RotaModulo[] {
  const sessao = (ctx: ContextoBase, db: SessaoTenant['db']): SessaoTenant => ({ db, tenant_id: ctx.usuario.tenant_id });

  const rotas: RotaModulo[] = [];
  for (const c of CADASTROS_BKO) {
    const base = CAMINHO_CADASTRO[c];
    const acao = ACAO_CADASTRO[c];
    const corpo = EDICAO_CADASTRO[c];

    rotas.push({
      metodo: 'GET',
      caminho: base,
      perfis: [...PERFIS_RELATORIO],
      carteira: 'nao_se_aplica',
      query: FiltroCadastro,
      async executar(ctx) {
        const f = ctx.query as FiltroCadastro;
        return ctx.comTenant(async (db) => ({ itens: await repo.listarCadastro(sessao(ctx, db), c, f.incluir_removidos === 'true') }));
      },
    });

    rotas.push({
      metodo: 'POST',
      caminho: base,
      acao,
      carteira: 'nao_se_aplica',
      corpo,
      status: 201,
      async executar(ctx) {
        const dados = ctx.corpo as Record<string, unknown> & { id: string };
        return ctx.comTenant(async (db, tx) => {
          const s = sessao(ctx, db);
          // idempotente pelo id do cliente: repetir o POST devolve o cadastro já criado; mesmo id com outro conteúdo = conflito
          const existente = await repo.cadastro(s, c, dados.id);
          if (existente) {
            if (Object.keys(dados).every((k) => mesmoConteudo(existente[k], dados[k]))) return existente;
            throw new ErroHttpModulo(409, 'ID_EM_USO', 'Esse identificador já foi usado em outro cadastro. Recarregue a página e tente de novo.');
          }
          await conferirReferencias(repo, s, tx, c, dados);
          const gravada = await repo.inserirCadastro(s, c, dados, ctx.agora().toISOString());
          await tx.auditar({ acao: `${c}.criar`, entidade: c, entidade_id: gravada.id, depois: resumoParaAuditoria(c, gravada) });
          return gravada;
        });
      },
    });

    rotas.push({
      metodo: 'PUT',
      caminho: `${base}/:id`,
      acao,
      carteira: 'nao_se_aplica',
      params: IdCadastroParams,
      corpo,
      async executar(ctx) {
        const dados = ctx.corpo as Record<string, unknown> & { id: string };
        const { id } = ctx.params as { id: string };
        if (dados.id !== id) throw new ErroHttpModulo(422, 'ID_DIVERGENTE', 'O identificador do corpo é diferente do endereço. Recarregue a página.');
        return ctx.comTenant(async (db, tx) => {
          const s = sessao(ctx, db);
          const atual = await repo.cadastro(s, c, id);
          if (!atual) throw naoEncontrado();
          if (atual.deleted_at) throw new ErroHttpModulo(409, 'CADASTRO_DESATIVADO', 'Esse cadastro foi desativado e não pode ser editado. Crie um novo.');
          // reenvio igual (PUT idempotente): nada muda, não renova updated_at nem audita
          if (Object.keys(dados).every((k) => mesmoConteudo(atual[k], dados[k]))) return atual;
          await conferirReferencias(repo, s, tx, c, dados);
          const gravada = await repo.atualizarCadastro(s, c, id, dados, ctx.agora().toISOString());
          await tx.auditar({ acao: `${c}.editar`, entidade: c, entidade_id: id, antes: resumoParaAuditoria(c, atual), depois: resumoParaAuditoria(c, gravada) });
          return gravada;
        });
      },
    });

    rotas.push({
      metodo: 'DELETE',
      caminho: `${base}/:id`,
      acao,
      carteira: 'nao_se_aplica',
      params: IdCadastroParams,
      async executar(ctx) {
        const { id } = ctx.params as { id: string };
        return ctx.comTenant(async (db, tx) => {
          const s = sessao(ctx, db);
          const atual = await repo.cadastro(s, c, id);
          if (!atual) throw naoEncontrado();
          if (atual.deleted_at) return atual; // já desativado: idempotente
          const gravada: LinhaCadastro = await repo.desativarCadastro(s, c, id, ctx.agora().toISOString());
          await tx.auditar({ acao: `${c}.desativar`, entidade: c, entidade_id: id, antes: resumoParaAuditoria(c, atual), depois: { desativado: true } });
          return gravada;
        });
      },
    });
  }

  rotas.push({
    metodo: 'GET',
    caminho: CAMINHO_PARAMETROS_TRADE,
    perfis: [...PERFIS_RELATORIO],
    carteira: 'nao_se_aplica',
    // somente leitura nesta versão: os valores são do tenant (`ctx.parametros()`), com o padrão do domain quando ausentes
    async executar(ctx): Promise<ParametrosTradeApi> {
      const p = parametrosDoTenant(ctx);
      return {
        validade_critica_dias: p.validade_critica_dias,
        validade_proxima_dias: p.validade_proxima_dias,
        peso_parcial_conformidade: p.peso_parcial_conformidade,
        permanencia_min_min: p.permanencia_min_min,
        variacao_preco_max_pct: p.variacao_preco_max_pct,
      };
    },
  });

  return rotas;
}
