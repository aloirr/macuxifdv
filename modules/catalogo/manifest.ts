import { defineModule } from '@macuxi/platform-sdk';

/** RN-CAT-04: consulta (busca, ficha, fotos, "pergunte ao catálogo") para todos: campo (vendedor, promotor), gestão (supervisor, gerente) e BKO (analista, assistente, admin). */
const PERFIS_CONSULTA = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
/**
 * RN-CAT-05 (revista): preço de tabela — todos os perfis de consulta menos o promotor (padrão
 * `promotor_ve_preco_estoque = false`); o estoque é de todos os perfis (filiais: `estoque-campo.ts`). Com o parâmetro ligado, o domínio (`podeVerPrecoEstoque`) libera o
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
 * Nenhuma ação de pedido aqui: as do Vendedor (ex.: "Adicionar ao orçamento") entram pela extensão `produto.acoes`.
 */
export const manifest = defineModule({
  id: 'catalogo',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo', 'Tabelas de preço', 'Marcas concorrentes'] } },
  sync: [
    // preço
    'tabela_preco',
    'tabela_preco_item',
    // faixas de preço por quantidade (RN-VEN-23, T-0089); o Vendedor as aplica pelas faixas[] de precos_cliente@1
    'tabela_escalonada',
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
    // referência cruzada do concorrente (RN-CAT-09, T-0085); a marca vem do cadastro de marcas do Catálogo
    'produto_referencia',
    // marcas concorrentes (RN-CAT-13, T-0113, ADR 0034): lista única do tenant, com ou sem o Promotor
    'marca_concorrente',
    'sinonimo',
    // árvore do catálogo (RF-CAT-04, T-0061; nomes e níveis do ERP)
    'catalogo_no',
    'produto_no',
    // relação entre produtos: complementar, superior, substituto (RF-CAT-03; T-0071)
    'produto_relacao',
  ],
  publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1', 'catalogo.referencia.marca_desconhecida@1', 'catalogo.marca_concorrente.alterada@1'],
  // produto: só o catalogo_no_external_id, para gravar produto_no; o cadastro do produto é do Core
  consome: ['integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'integracao.catalogo_no.atualizado@1', 'integracao.produto.atualizado@1', 'integracao.tabela_escalonada.atualizado@1', 'integracao.cliente.atualizado@1', 'catalogo.busca.realizada@1'],
  ofereceExtensoes: ['produto.acoes'],
  // T-0076: não contribui mais com 'cliente.acoes' (o "Ver catálogo" saiu do Cliente 360)
  usaExtensoes: [],
  // ADR 0012: o Vendedor lê o preço da tabela do cliente por consulta, nunca pela tabela (T-0029)
  // T-0148: foto_produto (ícone de câmera e foto ao tocar, cache no aparelho)
  // T-0084: textos (aplicação e referências) e busca do seletor do Novo pedido, com o mesmo ranking da vitrine
  ofereceConsultas: ['catalogo.precos_cliente@1', 'catalogo.sugestoes_pedido@1', 'catalogo.textos_produto@1', 'catalogo.busca_produtos@1', 'catalogo.marcas@1', 'catalogo.foto_produto@1', 'catalogo.estoque_filial@1'],
  // T-0052 (ADR 0012): cadastro base do produto (sku, nome, unidade, ativo) para a busca na API, sem ler `core.produto`
  // T-0149 (RN-CORE-39): filial do cliente, filial padrão e filiais da carteira (preço e estoque por filial, pull do aparelho, consumidores do ERP)
  usaConsultas: ['core.cadastro_resumo@1', 'core.filiais@1', 'core.filiais_do_usuario@1'],
  acoes: {
    // --- consulta (app Macuxi Campo e Gestão; BKO) ---
    'produto.consultar': { perfis: [...PERFIS_CONSULTA], descricao: 'Buscar, navegar, ver a ficha, favoritar e comparar produtos (RF-CAT-01..04, RF-CAT-06)' },
    'produto.ver_preco_estoque': {
      perfis: [...PERFIS_PRECO_ESTOQUE],
      descricao: 'Ver preço de tabela na vitrine, na busca e na ficha (o estoque é de todos os perfis); o promotor só com promotor_ve_preco_estoque = true (RN-CAT-05)',
    },
    'produto.perguntar': { perfis: [...PERFIS_CONSULTA], descricao: 'Pergunte ao catálogo: resposta só com conteúdo cadastrado e fonte citada (RF-CAT-05, RN-CAT-02)' },
    // --- conteúdo, sinônimos e destaques (BKO; RF-CAT-07) ---
    'produto.enriquecer': { perfis: [...PERFIS_CONTEUDO], descricao: 'Enriquecer conteúdo: fotos, vídeos, argumentos, FAQ e PDFs técnicos (RF-CAT-07)' },
    'sinonimo.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Cadastrar sinônimos do tenant para a busca (RF-CAT-02, RF-CAT-07)' },
    'destaque.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Marcar produtos de campanha e destaques que ganham boost na busca (RF-CAT-01)' },
    'tabela_preco.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Tabelas de preço no BKO: ver o preço da unidade e cadastrar a tabela escalonada (faixas por quantidade; RN-VEN-23)' },
    'marca.gerenciar': { perfis: [...PERFIS_CONTEUDO], descricao: 'Cadastrar, editar, inativar e reativar as marcas concorrentes do tenant (RN-CAT-13; ADR 0034)' },
    'busca.ver_sem_resultado': { perfis: [...PERFIS_CONTEUDO], descricao: 'Ver os termos buscados sem resultado (RF-CAT-07)' },
  },
});

export default manifest;
