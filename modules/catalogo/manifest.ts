import { defineModule } from '@macuxi/platform-sdk';

/** RN-CAT-04: consulta (busca, ficha, fotos, "pergunte ao catálogo") para todos: campo (vendedor, promotor), gestão (supervisor, gerente) e BKO (analista, assistente, admin). */
const PERFIS_CONSULTA = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
/**
 * RN-CAT-05: preço de tabela e estoque — todos os perfis de consulta menos o promotor (padrão
 * `promotor_ve_preco_estoque = false`). Com o parâmetro ligado, o domínio (`podeVerPrecoEstoque`) libera o
 * promotor; mantenha igual a `PERFIS_PRECO_ESTOQUE` de domain/visibilidade.ts (o teste confere).
 */
const PERFIS_PRECO_ESTOQUE = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
/** RN-CAT-04: conteúdo, sinônimos, destaques e termos sem resultado só analista e admin. */
const PERFIS_CONTEUDO = ['analista', 'admin'] as const;

/**
 * Manifesto do Catálogo (ADR-0005): dono de preço (tabela de preço e itens), estoque (depósito e saldo),
 * conteúdo, mídia, sinônimos e busca. O cadastro base de produto (`produto`) é do Core e não é sincronizado aqui;
 * o Catálogo reage só a preço e estoque do Hub (o evento de produto do ERP é consumido pelo Core).
 * `assistente` entra nos perfis porque o Vendedor depende do Catálogo (RN-CORE-03) e o assistente de BKO trabalha
 * com pedidos; `admin` entra para cadastrar conteúdo, sinônimos e destaques no BKO.
 * Nenhuma ação de pedido aqui: "Adicionar ao pedido" é do Vendedor, registrado na extensão `produto.acoes`.
 */
export const manifest = defineModule({
  id: 'catalogo',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo'] } },
  sync: [
    // preço
    'tabela_preco',
    'tabela_preco_item',
    // tabela de preço do cliente (T-0029; pull por carteira; RN-CAT-06)
    'cliente_tabela_preco',
    // estoque por filial/depósito
    'deposito',
    'estoque_saldo',
    // conteúdo e busca
    'categoria',
    'marca',
    'produto_atributo',
    'produto_midia',
    'produto_conteudo',
    'sinonimo',
    // árvore do catálogo (RF-CAT-04, T-0061; nomes e níveis do ERP)
    'catalogo_no',
    'produto_no',
  ],
  publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1'],
  // produto: só o catalogo_no_external_id, para gravar produto_no; o cadastro do produto é do Core
  consome: ['integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'integracao.catalogo_no.atualizado@1', 'integracao.produto.atualizado@1', 'catalogo.busca.realizada@1'],
  ofereceExtensoes: ['produto.acoes'],
  // T-0052: atalho "Ver catálogo" na ficha do cliente (abre o catálogo com o preço da tabela dele)
  usaExtensoes: ['cliente.acoes'],
  // ADR 0012: o Vendedor lê o preço da tabela do cliente por consulta, nunca pela tabela (T-0029)
  ofereceConsultas: ['catalogo.precos_cliente@1'],
  // T-0052 (ADR 0012): cadastro base do produto (sku, nome, unidade, ativo) para a busca na API, sem ler `core.produto`
  usaConsultas: ['core.cadastro_resumo@1'],
  acoes: {
    // --- consulta (app Macuxi Campo e Gestão; BKO) ---
    'produto.consultar': { perfis: [...PERFIS_CONSULTA], descricao: 'Buscar, navegar, ver a ficha, favoritar e comparar produtos (RF-CAT-01..04, RF-CAT-06)' },
    'produto.ver_preco_estoque': {
      perfis: [...PERFIS_PRECO_ESTOQUE],
      descricao: 'Ver preço de tabela e estoque na vitrine, na busca e na ficha; o promotor só com promotor_ve_preco_estoque = true (RN-CAT-05)',
    },
    'produto.perguntar': { perfis: [...PERFIS_CONSULTA], descricao: 'Pergunte ao catálogo: resposta só com conteúdo cadastrado e fonte citada (RF-CAT-05, RN-CAT-02)' },
    // --- conteúdo, sinônimos e destaques (BKO; RF-CAT-07) ---
    'produto.enriquecer': { perfis: [...PERFIS_CONTEUDO], descricao: 'Enriquecer conteúdo: fotos, vídeos, argumentos, FAQ e PDFs técnicos (RF-CAT-07)' },
    'sinonimo.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Cadastrar sinônimos do tenant para a busca (RF-CAT-02, RF-CAT-07)' },
    'destaque.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Marcar produtos de campanha e destaques que ganham boost na busca (RF-CAT-01)' },
    'busca.ver_sem_resultado': { perfis: [...PERFIS_CONTEUDO], descricao: 'Ver os termos buscados sem resultado (RF-CAT-07)' },
  },
});

export default manifest;
