/**
 * Base de DEMONSTRAÇÃO (dono: banco-dados) — demonstração com o gestor externo usando o app novo com a API real
 * (pedido do Alexandre R-20261031-233442, item 1). Diferente do seed da Fase M (que imita o mockup), esta base é
 * montada para o roteiro da demo: um tenant fictício pequeno e coerente, com tudo o que o app Campo e o Gestão mostram.
 *
 * - Tenant "Distribuidora Exemplo", código da empresa `demo`, fuso America/Manaus; módulos core, catálogo, vendedor e
 *   promotor (licença do tenant + módulos por perfil).
 * - Usuários (e-mails @exemplo.com.br): vendedor, vendedor2, supervisor, gerente, promotor, analista e admin. Senha de
 *   todos = MACUXI_SENHA_DEMO (padrão "demo-macuxi"), gravada só como hash argon2id; nunca é impressa. O seed grava o HASH
 *   direto (não passa pela RN-CORE-32, que vale na criação e na troca pela API): "demo-macuxi" continua valendo (decisão
 *   R-20261107-174523); a carga deixa a senha definitiva (0040: trocar_senha falso, sem temporária).
 *   Equipes: "Regional Norte" (gerente) é pai da "Equipe Manaus" (supervisora): o gerente vê a equipe (RN-CORE-04).
 * - 30 clientes de Manaus (endereço, bairro, coordenadas), contato principal com telefone fictício, financeiro e
 *   títulos (8 com título vencido, 1 bloqueado), 12 meses de histórico, pedidos em vários estados e visitas passadas.
 * - T-0029 (fatia do pedido): tabelas de preço "Varejo" (todos os produtos) e "Atacado" (~7% menor, SEM 3 produtos:
 *   "Sem preço para este cliente", RN-CAT-06), uma por cliente (supermercado e atacarejo no Atacado), vigência desde o
 *   1º dia do mês anterior; condições À vista (padrão), 28 dias, 28/56 e 30/60/90 (cliente com título vencido só À vista
 *   e 28 dias, RN-VEN-14); alçadas do Vendedor em plataforma.parametro (5/10/15%, acima do gerente = analista); pedidos
 *   recalculados pela tabela do cliente com a MESMA regra do servidor (revalidarPedido do domínio do Vendedor), com
 *   número, retratos e linha do tempo: aprovados na alçada, 2 aguardando o supervisor (um de cada vendedor), 1 aguardando
 *   o gerente, 1 rejeitado e 1 cancelado. T-0155: 3 dos aprovados já faturados pelo ERP (FATURAMENTOS_DEMO: p01 Faturado, p08
 *   Faturado parcial, p02 Faturado com devolução parcial), com nota, resumo, linha do tempo e a fila do ERP (integracao.ts).
 * - 0013 (T-0047, T-0059, R-20261102-092329/093007/094644): todos os clientes com CNPJ FICTÍCIO gerado (dígito
 *   verificador correto) e IE (um "ISENTO"); o Atacado Boto Rosa SEM CEP (cadastro incompleto, RN-CORE-17: só orçamento);
 *   endereço principal de todos e um de entrega em 5; 2 transportadoras; pedidos FOB (com transportadora) em 4 clientes e CIF no resto;
 *   33 produtos (+ linha automotiva e detergente 5 L para a busca em linguagem natural: "óleo para moto 150
 *   cilindradas") com custo/preço de venda (margem 20–40%), 3 com desconto máximo próprio (padrão 15%), UN e CX com
 *   fator (preço próprio da CX preparado, desligado até a consulta de preço filtrar a unidade), árvore de 3 níveis, conteúdo, atributos, sinônimos, documento de busca
 *   do servidor e estoque em 2 depósitos (com rupturas e saldos baixos). Pedidos com CNPJ no retrato, frete e entrega.
 * - Rota de HOJE (no fuso do tenant, calculada na hora do seed): 6 paradas do vendedor, 4 da vendedor2 e 4 do promotor.
 * - Metas do mês corrente (Lucas, Camila e Joana), todas do tipo 'pedido' (0019, RN-CORE-21: a demo só tem 3 pedidos faturados
 *   pelo ERP, uma meta de faturamento ficaria quase zerada), indicador diário coerente com os pedidos, motivos extras (os padrões vêm
 *   do gatilho core.semear_tenant) e 2 notificações. Metas do mês anterior de Lucas e Camila (mesmos indicadores, valores
 *   um pouco menores) para o "copiar do mês anterior" do BKO (T-0068); o Gestor projeta por usuário|mês, o mês corrente
 *   não muda. Meta viva gravada pelo ensaio no mesmo (usuário, período, indicador) é mantida (o seed pula a dele).
 * - Hierarquia (BKO de usuários, T-0067): Lucas, Camila, Joana e Renata na Equipe Manaus, cuja responsável é a Renata
 *   (supervisora); a equipe-pai Regional Norte tem o Marcelo (gerente) como responsável — supervisor e gerente de cada
 *   usuário saem de core.equipe (responsavel_id e equipe_pai_id), sem coluna nova.
 * - Medidas (medidas.ts, 0018, T-0063/T-0070): UN, CX, FD, LT e BD ativas, as demais da lista inicial inativas, e a caixa
 *   de embarque de cada produto como embalagem (embalagem_medida/embalagem_quantidade), gravadas dentro do laço.
 *
 * - Módulos em arquivos próprios, gravados na MESMA transação, logo antes do commit: Promotor (promotor.ts, 0015:
 *   cadastros de trade e visitas de loja da Joana) e Gestor (gestor.ts, 0014: licença para supervisor, gerente,
 *   analista e admin + projeção montada pelo domain do Gestor) e Pesquisa (pesquisa.ts, 0016: 2 questionários
 *   publicados e 16 respostas) e Treinamento (treinamento.ts, 0017: licença para os 7 perfis, 3 trilhas, jornada de
 *   Lucas, Camila e Joana e o desafio do mês) e o plano de RV (plano-rv.ts, 0028: vendedor, R$ 2.000,00, se a 0028 estiver
 *   aplicada) e o monitor da Integração ERP (integracao.ts, 0010: licença para admin e analista, Conectores ERP Matriz e
 *   ERP Filial, política 1.2.1, 5 lotes e uma inativação aguardando). Por isso a carga exige as migrações até a 0020 (medidas da 0018,
 *   core.meta.tipo da 0019 e catalogo.produto_relacao da 0020).
 * - T-0071 (0020, referência do novo pedido R-20261103-130003): Mini Box Japiim vira o cliente da referência (cód. C5110,
 *   Mercadinho, Av. Ajuricaba 1200 + endereço de entrega, sem título vencido nem bloqueio — o vencido/bloqueado passou para a
 *   Mercearia do Porto); AGU-500 FD R$ 17,90, CAF-500 UN R$ 18,90 com CX c/ 12 (o preço próprio de R$ 215,46 saiu na
 *   T-0089 pela RN-VEN-15: CX = UN × fator, R$ 226,80), BIS-400 com CX c/ 20 (R$ 117,80 = UN × fator), açúcar a R$ 4,99 e 3 produtos novos (filtro de papel, leite em pó
 *   e água 1,5 L); relacionados (catalogo.produto_relacao): complementares do café e versão superior da água; o Lucas com
 *   pedidos recentes em 2 mercadinhos (clientes parecidos do Mini Box) — 11 pedidos na base, o próximo número é o 000012.
 * - T-0084/T-0085 (0033; desenhos T-0084 §10 e T-0085 §7): 4 autopeças novas no FIM da lista (pastilha e disco de freio
 *   dianteiros, filtro de óleo e amortecedor traseiro) e a árvore sistema › grupo › linha delas (Freios › Pastilhas ›
 *   Dianteiras, Freios › Discos › Dianteiros, Filtros › Filtros de óleo › Linha leve, Suspensão › Amortecedores ›
 *   Traseiros). Aplicação (descrição 2, RN-CAT-11) em 5 das 12 autopeças (~40%): "Fiat Uno 1.0/1.4 2010–2014; Fiat Palio
 *   1.0/1.4 2012–2016" na pastilha, "VW Gol G5/G6 1.0/1.6 2009–2016; VW Voyage 1.0/1.6 2009–2016" no filtro, "a partir de
 *   2018" no amortecedor, um texto com mais de 300 caracteres SEM separador na lâmpada H4 (corte do orçamento, RN-VEN-19) e
 *   o óleo 4T; os demais produtos (inclusive os não automotivos) ficam SEM aplicação (controle). Sinônimos VW = Volkswagen e
 *   GM = Chevrolet. "Oferece junto" (produto_relacao complementar): pastilha → disco e fluido; filtro → óleo 5W30. As
 *   marcas próprias do fluido e da câmara mudaram (Dotflex e Pneumaq) para não coincidir com as marcas CONCORRENTES
 *   fictícias da referência cruzada (Freiomax, Rodaforte, Filtrobom e Vialume, no cadastro do Promotor). Referências,
 *   etiquetas e o documento de busca da 0033: catalogo-cadastro.ts.
 * - T-0089 (0037; desenho T-0089 §7, B4): formas de pagamento e prazos (Pix e Dinheiro à vista; Cartão 30 e 30/60; Boleto
 *   28, 28/56 e 30/60/90), prazo médio máximo 45 nos clientes (30 na Panificadora Pão Dourado), formas restritas na
 *   Conveniência Rota 10 (sem boleto), 3 faixas escalonadas no BIS-400 e a forma padrão "À vista" da 0037 apagada:
 *   pagamento.ts. As condições antigas (acima) continuam, para o APK antigo; o título vencido já está nos 8 clientes.
 * - T-0149 (0056; desenho T-0149 §3.5): filiais Manaus '0001' (padrão) e Boa Vista '0002', 4 clientes na Boa Vista, preço da
 *   Boa Vista 5% acima nas duas tabelas, depósito CD Boa Vista com estoque próprio (café 500 g zerado lá) e o retrato da
 *   filial nos pedidos: filial.ts. Na v1.0.3 a Boa Vista fica fora (SEED_BOA_VISTA_DEMO desligada, R-20261110-111746): só a
 *   padrão completada e o retrato dela nos pedidos; volta na v1.0.4.
 * - T-0147 (0057; desenho T-0147 §3): tipos de foto do PDV (Fachada, CNH do sócio e Contrato social) e a fachada de 5
 *   clientes (metadados 'aguardando': os bytes não estão no armazenamento): fotos-pdv.ts.
 *
 * Idempotente: upsert por id determinístico (`idDeterministico('demo:<chave>')`). Rodar de novo no mesmo dia não
 * duplica nada; em outro dia cria a rota do novo dia (as anteriores ficam como histórico) e move as datas relativas.
 * `recriar: true` apaga TODAS as linhas do tenant demo (inclusive o que o app gravou no ensaio) e carrega do zero.
 * Só roda contra o Postgres local ou o servidor da demo com MACUXI_AMBIENTE=demo (exigirBancoDemo). Nunca toca linha de outro tenant.
 */
import type { ClientBase } from 'pg';
import { politicaDosParametros, revalidarPedido } from '../../../modules/vendedor/domain/aprovacao';
import type { OrderStatus } from '../../../modules/vendedor/domain/order';
import { STATUS_QUE_CONTAM_NA_META } from '../../../modules/vendedor/domain/pedidos-da-meta';
import { decidirNotaDevolucao, itensDoFaturamento, planejarRetornoErp, resumoFaturamento } from '../../../modules/vendedor/domain/retorno-erp';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { anoMes, hojeNoFuso, instante, menorData, somarDias } from '../../src/datas';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeChave, idDeterministico, idMotivoPadrao, type CodigoMotivoPadrao } from '../../src/ids';
import { hashSenha, verificarSenha } from '../../src/senha';
import { carregarDemoGestor } from './gestor';
import { gravarDemoCatalogoCadastro } from './catalogo-cadastro';
import { gravarDemoMedidas } from './medidas';
import { gravarDemoFilial } from './filial';
import { gravarDemoFotosPdv } from './fotos-pdv';
import { gravarDemoPagamento } from './pagamento';
import { gravarPesquisaDemo } from './pesquisa';
import { gravarDemoIntegracao } from './integracao';
import { gravarDemoPlanoRv } from './plano-rv';
import { gravarDemoPromotor } from './promotor';
import { gravarTreinamentoDemo } from './treinamento';

export const TENANT_DEMO = 'dd000000-0000-4000-8000-000000000001';
export const CODIGO_DEMO = 'demo';
export const FUSO_DEMO = 'America/Manaus';
export const SENHA_DEMO_PADRAO = 'demo-macuxi';
export const MODULOS_DEMO = ['core', 'catalogo', 'vendedor', 'promotor'] as const;
/**
 * Última migração de que a base depende (0013: catálogo, unidades, frete, faturamento; 0018: medidas; 0019: core.meta.tipo;
 * 0020: produto_relacao; 0050: pedido_devolucao, T-0155).
 */
const MIGRACAO_MINIMA = '0050_vendedor_pedido_devolucao';
/** Tipo das metas da demo (0019, RN-CORE-21): pedido — só 3 pedidos faturados pelo ERP na demo (T-0155), a de faturamento ficaria quase zerada. */
export const TIPO_METAS_DEMO = 'pedido' as const;

const T = TENANT_DEMO;
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

// ---------------------------------------------------------------------------------------------------------------
// Usuários
export type ChaveUsuario = 'vendedor' | 'vendedor2' | 'supervisor' | 'gerente' | 'promotor' | 'analista' | 'admin';
type Perfil = 'vendedor' | 'supervisor' | 'gerente' | 'promotor' | 'analista' | 'assistente' | 'admin';
interface UsuarioDemo {
  nome: string;
  curto: string;
  email: string;
  perfil: Perfil;
  /** Equipe do usuário: Equipe Manaus, Regional Norte (o gerente) ou nenhuma (analista, admin). */
  equipe: 'manaus' | 'regional' | null;
  externo: string | null;
}

/** Logins da demonstração (nomes fictícios). */
export const USUARIOS_DEMO: Record<ChaveUsuario, UsuarioDemo> = {
  vendedor: { nome: 'Lucas Andrade', curto: 'Lucas A.', email: 'vendedor@exemplo.com.br', perfil: 'vendedor', equipe: 'manaus', externo: '201' },
  vendedor2: { nome: 'Camila Freitas', curto: 'Camila F.', email: 'vendedor2@exemplo.com.br', perfil: 'vendedor', equipe: 'manaus', externo: '202' },
  supervisor: { nome: 'Renata Barros', curto: 'Renata B.', email: 'supervisor@exemplo.com.br', perfil: 'supervisor', equipe: 'manaus', externo: null },
  gerente: { nome: 'Marcelo Tavares', curto: 'Marcelo T.', email: 'gerente@exemplo.com.br', perfil: 'gerente', equipe: 'regional', externo: null },
  promotor: { nome: 'Joana Prado', curto: 'Joana P.', email: 'promotor@exemplo.com.br', perfil: 'promotor', equipe: 'manaus', externo: '301' },
  analista: { nome: 'Paulo Ribeiro', curto: 'Paulo R.', email: 'analista@exemplo.com.br', perfil: 'analista', equipe: null, externo: null },
  admin: { nome: 'Sérgio Moura', curto: 'Sérgio M.', email: 'admin@exemplo.com.br', perfil: 'admin', equipe: null, externo: null },
};
export const idUsuarioDemo = (chave: ChaveUsuario) => id(`usuario:${USUARIOS_DEMO[chave].email}`);

/**
 * Módulos por perfil (RN-CORE-01: efetivos = tenant ∩ perfil). Vendedor e Catálogo para vendedor, supervisor, gerente,
 * analista, assistente e admin (T-0029 §10); o promotor nunca ganha o Vendedor (RN-PRO-01).
 */
const PERFIL_MODULOS: Record<Perfil, readonly (typeof MODULOS_DEMO)[number][]> = {
  vendedor: ['core', 'catalogo', 'vendedor'],
  supervisor: ['core', 'catalogo', 'vendedor', 'promotor'],
  gerente: ['core', 'catalogo', 'vendedor', 'promotor'],
  promotor: ['core', 'catalogo', 'promotor'],
  analista: ['core', 'catalogo', 'vendedor', 'promotor'],
  assistente: ['core', 'catalogo', 'vendedor'],
  admin: ['core', 'catalogo', 'vendedor', 'promotor'],
};

/** Alçadas de desconto do Vendedor (doc 03, parâmetros do tenant; RN-VEN-10). Valor jsonb. */
export const ALCADAS_DEMO = {
  'alcada.vendedor_pct': 5,
  'alcada.supervisor_pct': 10,
  'alcada.gerente_pct': 15,
  'alcada.acima_gerente': 'analista',
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Produtos (ADR-0005: preço e estoque são do Catálogo; aqui só o cadastro + o preço de tabela usado nos pedidos)
/** [sku, nome, marca, categoria, unidade, preço de tabela em centavos] — marcas fictícias. */
const PRODUTOS: Array<[string, string, string, string, string, number]> = [
  ['CAF-500', 'Café torrado e moído 500 g', 'Aroma da Serra', 'Mercearia', 'UN', 1_890],
  ['ARR-5K', 'Arroz tipo 1 5 kg', 'Grão Nobre', 'Mercearia', 'UN', 2_690],
  ['FEI-1K', 'Feijão carioca 1 kg', 'Grão Nobre', 'Mercearia', 'UN', 899],
  // T-0071: R$ 4,99 (complementar do café na referência do novo pedido; era R$ 4,79)
  ['ACU-1K', 'Açúcar cristal 1 kg', 'Doce Vale', 'Mercearia', 'UN', 499],
  ['OLE-900', 'Óleo de soja 900 ml', 'Campo Verde', 'Mercearia', 'UN', 749],
  ['FAR-1K', 'Farinha de mandioca 1 kg', 'Sabor do Norte', 'Mercearia', 'UN', 690],
  ['MAC-500', 'Macarrão espaguete 500 g', 'Bella Massa', 'Mercearia', 'UN', 459],
  ['MOL-340', 'Molho de tomate 340 g', 'Bella Massa', 'Mercearia', 'UN', 329],
  ['SAR-125', 'Sardinha em óleo 125 g', 'Rio Mar', 'Mercearia', 'UN', 699],
  ['LEI-1L', 'Leite UHT integral 1 L', 'Leite Bom', 'Laticínios', 'UN', 549],
  ['MAR-500', 'Margarina com sal 500 g', 'Leite Bom', 'Laticínios', 'UN', 899],
  ['BIS-400', 'Biscoito cream cracker 400 g', 'Crocante', 'Biscoitos', 'UN', 589],
  ['BIS-140', 'Biscoito recheado chocolate 140 g', 'Crocante', 'Biscoitos', 'UN', 289],
  ['REF-2L', 'Refrigerante de guaraná 2 L', 'Guaraná da Floresta', 'Bebidas', 'UN', 799],
  ['REF-350', 'Refrigerante de guaraná lata 350 ml (fardo 12)', 'Guaraná da Floresta', 'Bebidas', 'FD', 3_990],
  ['AGU-500', 'Água mineral 500 ml (fardo 12)', 'Fonte Clara', 'Bebidas', 'FD', 1_790],
  ['SUC-1L', 'Suco de cupuaçu 1 L', 'Sabor do Norte', 'Bebidas', 'UN', 899],
  ['ACA-1K', 'Polpa de açaí 1 kg', 'Sabor do Norte', 'Congelados', 'UN', 2_290],
  ['DET-500', 'Detergente líquido 500 ml', 'Brilho', 'Limpeza', 'UN', 239],
  ['SAB-1K', 'Sabão em pó 1 kg', 'Brilho', 'Limpeza', 'UN', 1_290],
  ['DES-2L', 'Desinfetante 2 L', 'Brilho', 'Limpeza', 'UN', 990],
  ['PAP-4', 'Papel higiênico folha dupla 4 rolos', 'Macio', 'Higiene', 'UN', 849],
  ['SBN-90', 'Sabonete 90 g', 'Flor da Mata', 'Higiene', 'UN', 249],
  ['CRD-90', 'Creme dental 90 g', 'Sorriso', 'Higiene', 'UN', 459],
  // 0013 (T-0047): linha automotiva e o detergente de 5 L, para a busca em linguagem natural ("óleo para moto 150
  // cilindradas", "detergente neutro 5 litros com estoque") ter o que achar no ensaio
  ['DET-5L', 'Detergente líquido neutro 5 L', 'Brilho', 'Limpeza', 'UN', 1_590],
  ['OLE-4T-1L', 'Óleo para motor 4T 20W50 1 L (motos 125 a 160 cc)', 'Motorvia', 'Automotivo', 'UN', 3_290],
  ['OLE-4T-SEMI', 'Óleo semissintético 4T 10W40 1 L para motos', 'Motorvia', 'Automotivo', 'UN', 3_890],
  ['OLE-5W30', 'Óleo sintético 5W30 1 L para carros flex', 'Lubrion', 'Automotivo', 'UN', 4_590],
  // T-0085: marca própria Dotflex (era Freiomax, que virou marca CONCORRENTE fictícia da referência cruzada)
  ['FLU-DOT4', 'Fluido de freio DOT 4 500 ml', 'Dotflex', 'Automotivo', 'UN', 2_490],
  ['ADI-RAD', 'Aditivo para radiador concentrado 1 L', 'Lubrion', 'Automotivo', 'UN', 1_890],
  ['VEL-150', 'Vela de ignição para moto 150 cc', 'Faísca', 'Automotivo', 'UN', 1_590],
  // T-0085: marca própria Pneumaq (era Rodaforte, que virou marca CONCORRENTE fictícia da referência cruzada)
  ['CAM-18', 'Câmara de ar aro 18 para moto', 'Pneumaq', 'Automotivo', 'UN', 2_990],
  ['LAM-H4', 'Lâmpada de farol H4 12 V 60/55 W', 'Luzmax', 'Automotivo', 'UN', 2_190],
  // T-0071 (0020): complementares do café e versão superior da água, para as sugestões do novo pedido (desenho §5). No FIM da
  // lista: margem e saldo usam o índice do produto, os anteriores não mudam
  ['FIL-103', 'Filtro de papel 103 c/ 30', 'Aroma da Serra', 'Mercearia', 'UN', 549],
  ['LPO-400', 'Leite em pó integral 400 g', 'Leite Bom', 'Laticínios', 'UN', 1_690],
  ['AGU-1500', 'Água mineral 1,5 L (fardo 6)', 'Fonte Clara', 'Bebidas', 'FD', 1_990],
  // T-0084/T-0085 (0033): autopeças do Catálogo do cadastro (aplicação, oferece junto, referência cruzada). No FIM da lista
  ['PST-D01', 'Pastilha de freio dianteira', 'Norfreio', 'Automotivo', 'UN', 8_990],
  ['DSC-D01', 'Disco de freio dianteiro ventilado', 'Norfreio', 'Automotivo', 'UN', 15_990],
  ['FOL-G01', 'Filtro de óleo', 'Purifil', 'Automotivo', 'UN', 2_890],
  ['AMR-T01', 'Amortecedor traseiro', 'Suspentec', 'Automotivo', 'UN', 21_990],
];
const PRECO = new Map(PRODUTOS.map(([sku, , , , , preco]) => [sku, preco]));
const PRODUTO = new Map(PRODUTOS.map(([sku, nome, , , unidade]) => [sku, { nome, unidade }]));

// ---------------------------------------------------------------------------------------------------------------
// Cadastro do produto (0013): custo/preço de venda (RN-CORE-18), desconto máximo próprio (RN-VEN-11), unidades de venda
// (RN-VEN-15), árvore do catálogo (RF-CAT-04), conteúdo, atributos e sinônimos (RF-CAT-01..03), estoque (RN-CAT-07)
/** Produtos com desconto máximo próprio (fora dos pedidos da demo com desconto, para não contradizer o RN-VEN-11). */
export const DESCONTO_MAXIMO_PROPRIO_DEMO: Record<string, number> = { 'OLE-4T-1L': 25, 'VEL-150': 5, 'DET-5L': 10 };
/** Margem esperada (%) do produto i: de 20% a 40%, estável. custo = preço de venda × (1 − margem). */
const margemDemo = (i: number) => 20 + ((i * 7) % 21);

/**
 * DESLIGADO na T-0089 (RN-VEN-15, redação de 2026-11-06, R-20261106-064758): não existe preço próprio da embalagem; o preço da
 * CX é sempre o da UN × fator. A base demo não cria linhas de catalogo.tabela_preco_item com unidade não nula (a API e o APK
 * novo as ignoram). Linhas antigas numa base já carregada não são apagadas pelo seed; o plano B demo-recriar-base recria sem elas.
 */
export const PRECO_PROPRIO_CX_LIGADO = false;
/** Caixas de embarque (RN-VEN-15): [sku, fator]. O preço da CX é o da UN × fator. */
const CAIXAS: Array<[string, number]> = [
  // T-0071: café CX c/ 12 (18,90 × 12 = R$ 226,80) e biscoito cream cracker CX c/ 20 (R$ 117,80)
  ['CAF-500', 12], ['BIS-400', 20], ['ARR-5K', 6], ['FEI-1K', 10], ['OLE-900', 20], ['LEI-1L', 12], ['DET-500', 24],
  ['BIS-140', 24], ['OLE-4T-1L', 12], ['DET-5L', 4],
];

/**
 * Árvore do catálogo: [código, nome, código do pai]. Categoria › Família › Grupo (3 níveis); as autopeças da T-0085 são
 * grupos de Automotivo com um nível a mais (Automotivo › Freios › Pastilhas › Dianteiras). T-0142: a raiz tem só
 * Alimentos, Bebidas, Limpeza e higiene e Automotivo. Todo produto fica numa folha (nó sem filhos).
 */
const ARVORE: Array<[string, string, string | null]> = [
  ['ALI', 'Alimentos', null],
  ['ALI-MER', 'Mercearia', 'ALI'],
  ['ALI-MER-GRA', 'Grãos, farinhas e açúcar', 'ALI-MER'],
  ['ALI-MER-MAS', 'Massas e molhos', 'ALI-MER'],
  ['ALI-MER-OLE', 'Óleos e conservas', 'ALI-MER'],
  ['ALI-MER-CAF', 'Café', 'ALI-MER'],
  ['ALI-LAT', 'Laticínios', 'ALI'],
  ['ALI-LAT-LEI', 'Leites e margarinas', 'ALI-LAT'],
  ['ALI-BIS', 'Biscoitos', 'ALI'],
  ['ALI-BIS-SAL', 'Salgados', 'ALI-BIS'],
  ['ALI-BIS-DOC', 'Recheados', 'ALI-BIS'],
  ['ALI-CON', 'Congelados', 'ALI'],
  ['ALI-CON-POL', 'Polpas de fruta', 'ALI-CON'],
  ['BEB', 'Bebidas', null],
  ['BEB-REF', 'Refrigerantes', 'BEB'],
  ['BEB-REF-GUA', 'Guaraná', 'BEB-REF'],
  ['BEB-AGS', 'Águas e sucos', 'BEB'],
  ['BEB-AGS-AGU', 'Águas', 'BEB-AGS'],
  ['BEB-AGS-SUC', 'Sucos', 'BEB-AGS'],
  ['LIH', 'Limpeza e higiene', null],
  ['LIH-LIM', 'Limpeza', 'LIH'],
  ['LIH-LIM-LOU', 'Louça', 'LIH-LIM'],
  ['LIH-LIM-ROU', 'Roupa', 'LIH-LIM'],
  ['LIH-LIM-CAS', 'Casa', 'LIH-LIM'],
  ['LIH-HIG', 'Higiene', 'LIH'],
  ['LIH-HIG-PES', 'Higiene pessoal', 'LIH-HIG'],
  ['LIH-HIG-PAP', 'Papel', 'LIH-HIG'],
  ['AUT', 'Automotivo', null],
  ['AUT-LUB', 'Lubrificantes e fluidos', 'AUT'],
  ['AUT-LUB-MOT', 'Óleo para moto', 'AUT-LUB'],
  ['AUT-LUB-CAR', 'Óleo para carro', 'AUT-LUB'],
  ['AUT-LUB-FLU', 'Fluidos e aditivos', 'AUT-LUB'],
  ['AUT-PEC', 'Peças e acessórios', 'AUT'],
  ['AUT-PEC-MOT', 'Peças de moto', 'AUT-PEC'],
  ['AUT-PEC-ILU', 'Iluminação', 'AUT-PEC'],
  // T-0085 (RF-CAT-09): sistema › grupo › linha das autopeças novas (no FIM: a ordem dos nós anteriores não muda).
  // T-0142: Freios, Filtros e Suspensão são grupos de Automotivo (eram raiz e apareciam no mesmo nível dele); códigos e ids iguais
  ['FRE', 'Freios', 'AUT'],
  ['FRE-PAS', 'Pastilhas', 'FRE'],
  ['FRE-PAS-DIA', 'Dianteiras', 'FRE-PAS'],
  ['FRE-DIS', 'Discos', 'FRE'],
  ['FRE-DIS-DIA', 'Dianteiros', 'FRE-DIS'],
  ['FIL', 'Filtros', 'AUT'],
  ['FIL-OLE', 'Filtros de óleo', 'FIL'],
  ['FIL-OLE-LEV', 'Linha leve', 'FIL-OLE'],
  ['SUS', 'Suspensão', 'AUT'],
  ['SUS-AMO', 'Amortecedores', 'SUS'],
  ['SUS-AMO-TRA', 'Traseiros', 'SUS-AMO'],
];
/** Grupo (folha da árvore) de cada produto. */
const GRUPO: Record<string, string> = {
  'ARR-5K': 'ALI-MER-GRA', 'FEI-1K': 'ALI-MER-GRA', 'FAR-1K': 'ALI-MER-GRA', 'ACU-1K': 'ALI-MER-GRA', 'MAC-500': 'ALI-MER-MAS', 'MOL-340': 'ALI-MER-MAS',
  'OLE-900': 'ALI-MER-OLE', 'SAR-125': 'ALI-MER-OLE', 'CAF-500': 'ALI-MER-CAF', 'FIL-103': 'ALI-MER-CAF', 'LPO-400': 'ALI-LAT-LEI', 'AGU-1500': 'BEB-AGS-AGU', 'LEI-1L': 'ALI-LAT-LEI', 'MAR-500': 'ALI-LAT-LEI', 'BIS-400': 'ALI-BIS-SAL',
  'BIS-140': 'ALI-BIS-DOC', 'ACA-1K': 'ALI-CON-POL', 'REF-2L': 'BEB-REF-GUA', 'REF-350': 'BEB-REF-GUA', 'AGU-500': 'BEB-AGS-AGU', 'SUC-1L': 'BEB-AGS-SUC',
  'DET-500': 'LIH-LIM-LOU', 'DET-5L': 'LIH-LIM-LOU', 'SAB-1K': 'LIH-LIM-ROU', 'DES-2L': 'LIH-LIM-CAS', 'SBN-90': 'LIH-HIG-PES', 'CRD-90': 'LIH-HIG-PES',
  'PAP-4': 'LIH-HIG-PAP', 'OLE-4T-1L': 'AUT-LUB-MOT', 'OLE-4T-SEMI': 'AUT-LUB-MOT', 'OLE-5W30': 'AUT-LUB-CAR', 'FLU-DOT4': 'AUT-LUB-FLU',
  'ADI-RAD': 'AUT-LUB-FLU', 'VEL-150': 'AUT-PEC-MOT', 'CAM-18': 'AUT-PEC-MOT', 'LAM-H4': 'AUT-PEC-ILU',
  'PST-D01': 'FRE-PAS-DIA', 'DSC-D01': 'FRE-DIS-DIA', 'FOL-G01': 'FIL-OLE-LEV', 'AMR-T01': 'SUS-AMO-TRA',
};

/** Atributos filtráveis: sku -> [nome, valor, valor numérico, unidade]. */
const ATRIBUTOS: Record<string, Array<[string, string, number | null, string | null]>> = {
  'OLE-4T-1L': [['Viscosidade', '20W50', null, null], ['Motor', '4 tempos', 4, null], ['Cilindrada', '125 a 160', 150, 'cc'], ['Volume', '1', 1, 'L']],
  'OLE-4T-SEMI': [['Viscosidade', '10W40', null, null], ['Motor', '4 tempos', 4, null], ['Cilindrada', '150 a 300', 250, 'cc'], ['Base', 'semissintético', null, null], ['Volume', '1', 1, 'L']],
  'OLE-5W30': [['Viscosidade', '5W30', null, null], ['Base', 'sintético', null, null], ['Combustível', 'flex', null, null], ['Volume', '1', 1, 'L']],
  'FLU-DOT4': [['Tipo', 'DOT 4', null, null], ['Volume', '500', 500, 'ml']],
  'ADI-RAD': [['Tipo', 'concentrado', null, null], ['Volume', '1', 1, 'L']],
  'VEL-150': [['Cilindrada', '150', 150, 'cc'], ['Rosca', '10', 10, 'mm']],
  'CAM-18': [['Aro', '18', 18, 'pol'], ['Veículo', 'moto', null, null]],
  'LAM-H4': [['Tipo', 'H4', null, null], ['Tensão', '12', 12, 'V'], ['Potência', '60/55', 60, 'W']],
  'PST-D01': [['Posição', 'dianteira', null, null], ['Material', 'semimetálica', null, null]],
  'DSC-D01': [['Posição', 'dianteira', null, null], ['Tipo', 'ventilado', null, null], ['Diâmetro', '240', 240, 'mm']],
  'FOL-G01': [['Rosca', '3/4"-16 UNF', null, null], ['Altura', '86', 86, 'mm']],
  'AMR-T01': [['Posição', 'traseira', null, null], ['Tipo', 'pressurizado a gás', null, null]],
  'DET-5L': [['Fragrância', 'neutro', null, null], ['Volume', '5', 5, 'L']],
  'DET-500': [['Fragrância', 'neutro', null, null], ['Volume', '500', 500, 'ml']],
  'OLE-900': [['Tipo', 'soja', null, null], ['Volume', '900', 900, 'ml']],
  'CAF-500': [['Torra', 'média', null, null], ['Peso', '500', 500, 'g']],
  'ARR-5K': [['Tipo', 'tipo 1', null, null], ['Peso', '5', 5, 'kg']],
  'REF-2L': [['Sabor', 'guaraná', null, null], ['Volume', '2', 2, 'L']],
  'SUC-1L': [['Sabor', 'cupuaçu', null, null], ['Volume', '1', 1, 'L']],
};

/**
 * Conteúdo (ficha): sku -> [descrição, aplicação (descrição 2; null = sem), argumentos de venda, FAQ]. Os demais ganham uma
 * descrição e argumentos padrão, SEM aplicação. T-0084 (RN-CAT-11): aplicação só em 5 das 12 autopeças (~40%), com os
 * casos do Uno (pastilha), do Gol (filtro), do "a partir de 2018" (amortecedor) e do texto acima de 300 caracteres sem
 * separador (lâmpada H4, para o corte do orçamento em 300, RN-VEN-19); o resto fica sem, como controle (antes da 0033 todo
 * produto tinha um texto em `aplicacoes`, que agora sairia no orçamento e no PDF).
 */
const CONTEUDO: Record<string, [string, string | null, string, Array<{ pergunta: string; resposta: string }>]> = {
  'OLE-4T-1L': [
    'Óleo mineral para motores 4 tempos de motocicletas, viscosidade SAE 20W50, frasco de 1 litro.',
    'Motos de 125 a 160 cilindradas (125 cc, 150 cc e 160 cc), uso urbano e estrada. Troca a cada 1.000 a 1.500 km.',
    'O mais vendido para moto 150 no Norte; aguenta calor e trânsito pesado; caixa com 12 frascos.',
    [
      { pergunta: 'Serve para moto 150 cilindradas?', resposta: 'Sim. É indicado para motos 4 tempos de 125 a 160 cc.' },
      { pergunta: 'De quantos em quantos km troco?', resposta: 'A cada 1.000 a 1.500 km, ou conforme o manual da moto.' },
    ],
  ],
  'OLE-4T-SEMI': [
    'Óleo semissintético para motores 4 tempos, SAE 10W40, 1 litro.',
    null,
    'Troca mais espaçada que o mineral; protege na partida a frio.',
    [{ pergunta: 'Posso usar em moto 150?', resposta: 'Pode, se o manual permitir 10W40.' }],
  ],
  'OLE-5W30': ['Óleo sintético SAE 5W30 para motores de carros flex.', null, 'Economia de combustível; padrão das montadoras.', []],
  'FLU-DOT4': ['Fluido de freio DOT 4, 500 ml.', null, 'Ponto de ebulição alto: mais segurança na descida.', []],
  'ADI-RAD': ['Aditivo concentrado para o sistema de arrefecimento, 1 litro.', null, 'Evita ferrugem e superaquecimento.', []],
  'VEL-150': ['Vela de ignição para motos de 150 cc.', null, 'Partida fácil e consumo menor.', []],
  'CAM-18': ['Câmara de ar para pneu de moto aro 18.', null, 'Borracha reforçada; válvula reta.', []],
  'LAM-H4': [
    'Lâmpada halógena H4 12 V 60/55 W para farol.',
    // T-0084: mais de 300 caracteres e SEM separador (; | • quebra de linha), para o corte na palavra inteira do orçamento
    'Faróis de carros e motos com encaixe H4 de 12 V, como Fiat Uno Mille, Palio, Siena, Strada e Fiorino, VW Gol, Parati, ' +
      'Saveiro, Voyage e Fox, Chevrolet Celta, Corsa Classic, Prisma e Onix, Ford Ka, Fiesta e EcoSport, Renault Clio, Sandero e ' +
      'Logan, Honda CG 125, 150 e 160 Titan, Fan e Start, Yamaha Factor, YBR e Fazer 250 e as demais motos de baixa cilindrada com farol H4 de 60/55 W',
    'Luz alta e baixa na mesma lâmpada.',
    [],
  ],
  'DET-5L': ['Detergente líquido neutro em galão de 5 litros.', null, 'Rende mais que o de 500 ml; preço por litro menor.', []],
  'CAF-500': ['Café torrado e moído, torra média, 500 g.', null, 'Campeão de giro na mercearia.', []],
  'REF-2L': ['Refrigerante de guaraná, garrafa de 2 litros.', null, 'Marca regional com boa saída no fim de semana.', []],
  // T-0084/T-0085 (0033): os casos do critério 3 da T-0084 (busca "pastilha uno 2012" e "filtro gol 2014")
  'PST-D01': [
    'Pastilha de freio dianteira semimetálica, jogo para as duas rodas.',
    'Fiat Uno 1.0/1.4 2010–2014; Fiat Palio 1.0/1.4 2012–2016',
    'Baixo ruído e pouco pó; troque junto com o disco quando ele estiver abaixo da espessura mínima.',
    [{ pergunta: 'Serve no Uno 2012?', resposta: 'Sim. Serve no Fiat Uno 1.0 e 1.4 de 2010 a 2014.' }],
  ],
  'DSC-D01': ['Disco de freio dianteiro ventilado de 240 mm, unidade.', null, 'Liga com alto teor de carbono: menos vibração na frenagem.', []],
  'FOL-G01': [
    'Filtro de óleo blindado, rosca 3/4"-16 UNF.',
    'VW Gol G5/G6 1.0/1.6 2009–2016; VW Voyage 1.0/1.6 2009–2016',
    'Troque a cada troca de óleo; válvula antirretorno.',
    [],
  ],
  'AMR-T01': ['Amortecedor traseiro pressurizado a gás, unidade.', 'Chevrolet Onix 1.0 a partir de 2018', 'Mais estabilidade com o carro carregado.', []],
};

/** Campanha (is_campaign) e destaque no catálogo. */
const EM_CAMPANHA = new Set(['CAF-500', 'REF-2L', 'OLE-4T-1L']);
const EM_DESTAQUE = new Set(['OLE-4T-1L', 'DET-5L']);

/** Sinônimos do tenant (busca offline e online): termo -> lista (só [a-z0-9_]). */
const SINONIMOS: Array<[string, string[]]> = [
  ['moto', ['motocicleta', 'motos']],
  ['cc', ['cilindradas', 'cilindrada']],
  ['refri', ['refrigerante']],
  ['oleo', ['lubrificante']],
  ['galao', ['5l', '5_litros']],
  // T-0084 (RN-CAT-12): siglas de montadora na aplicação ("filtro volkswagen gol" acha "VW Gol"; vale nos dois sentidos)
  ['vw', ['volkswagen']],
  ['gm', ['chevrolet']],
];

/**
 * Relacionados do produto (0020, T-0071; catalogo.produto_relacao): [produto, relacionado, tipo, ordem]. Os complementares do
 * café e a versão superior da água são os da referência do novo pedido ("Combina com o pedido" e "Leve mais").
 */
export const RELACOES_DEMO: Array<[string, string, 'complementar' | 'superior' | 'substituto', number]> = [
  ['CAF-500', 'ACU-1K', 'complementar', 1],
  ['CAF-500', 'FIL-103', 'complementar', 2],
  ['CAF-500', 'LPO-400', 'complementar', 3],
  ['AGU-500', 'AGU-1500', 'superior', 1],
  // ficha do produto (substituto em ruptura): os dois óleos de moto
  ['OLE-4T-1L', 'OLE-4T-SEMI', 'substituto', 1],
  // T-0085 (RF-CAT-09): "oferece junto" = complementar (até 5 por produto, domain e API do Catálogo)
  ['PST-D01', 'DSC-D01', 'complementar', 1],
  ['PST-D01', 'FLU-DOT4', 'complementar', 2],
  ['FOL-G01', 'OLE-5W30', 'complementar', 1],
];

/** Depósitos e saldo (na unidade base) por produto i: CD Manaus e Loja Centro; alguns zerados (ruptura) e alguns baixos. */
const DEPOSITOS: Array<[string, string]> = [
  ['CD-MAO', 'CD Manaus'],
  ['LJ-CENTRO', 'Loja Centro'],
];
const saldoDemo = (i: number, d: number): number => {
  if (i % 11 === 5) return 0; // ruptura nos dois
  if (d === 1 && i % 4 === 0) return 0;
  if (i % 7 === 3) return 3 + d * 2; // baixo (RN-CAT-07: até 10)
  return 40 + ((i * 37 + d * 53) % 260);
};

/** Transportadoras (RF-VEN-13): [chave, nome, telefone]; CNPJ fictício gerado (dígito verificador correto). */
const TRANSPORTADORAS: Array<[string, string, string]> = [
  ['rio-negro', 'Transportes Rio Negro Ltda', '9232001100'],
  ['expresso-amazonas', 'Expresso Amazonas Cargas Ltda', '9232002200'],
];

/** Dígitos verificadores de CNPJ (módulo 11). */
function digitosCnpj(base12: string): string {
  const dv = (s: string, pesos: number[]) => {
    const soma = [...s].reduce((t, c, i) => t + Number(c) * pesos[i]!, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}
/**
 * CNPJ FICTÍCIO da demo (R-20261102-092329): raiz gerada (não copiada de empresa real) a partir de uma semente, filial
 * 0001, dígitos verificadores corretos. Prefixo 7 e semente diferentes para clientes e transportadoras.
 */
export function cnpjDemo(semente: number): string {
  const raiz = String(70_000_000 + ((semente * 1_234_577) % 29_999_999)).padStart(8, '0');
  return digitosCnpj(`${raiz}0001`);
}
/** Inscrição estadual fictícia do AM (9 dígitos, começa com 04) ou ISENTO. */
const cepDemo = (n: number) => `6900${String(1000 + n * 13).padStart(4, '0')}`;
const ieDemo = (n: number) => (n === ISENTO_IE ? 'ISENTO' : `04${String(1_000_000 + n * 104_729).slice(-7)}`);

// ---------------------------------------------------------------------------------------------------------------
// Preço (schema catalogo, 0008) e condições de pagamento (schema vendedor, 0009) — T-0029 §10
type ChaveTabela = 'varejo' | 'atacado';
/** Tabelas de preço: Varejo = preço de tabela do seed; Atacado ≈ 7% menor e SEM os produtos abaixo (RN-CAT-06). */
export const TABELAS_PRECO_DEMO: Record<ChaveTabela, { codigo: string; nome: string }> = {
  varejo: { codigo: 'VAREJO', nome: 'Varejo' },
  atacado: { codigo: 'ATACADO', nome: 'Atacado' },
};
/** Produtos fora da tabela Atacado: no cliente de atacado aparecem "Sem preço para este cliente" (não vendáveis). */
export const SEM_PRECO_NO_ATACADO = ['ACA-1K', 'SUC-1L', 'CRD-90'] as const;
const precoNaTabela = (tabela: ChaveTabela, sku: string): number | null => {
  const base = PRECO.get(sku)!;
  if (tabela === 'varejo') return base;
  return (SEM_PRECO_NO_ATACADO as readonly string[]).includes(sku) ? null : Math.round(base * 0.93);
};
/** Supermercado e atacarejo compram no Atacado; os demais segmentos no Varejo. */
const tabelaDoSegmento = (segmento: string): ChaveTabela => (segmento === 'Supermercado' || segmento === 'Atacarejo' ? 'atacado' : 'varejo');

type CodigoCondicao = 'AVISTA' | '28D' | '28-56' | '30-60-90';
/** Condições de pagamento do tenant (À vista é a padrão). */
export const CONDICOES_DEMO: Array<{ codigo: CodigoCondicao; descricao: string; padrao: boolean }> = [
  { codigo: 'AVISTA', descricao: 'À vista', padrao: true },
  { codigo: '28D', descricao: '28 dias', padrao: false },
  { codigo: '28-56', descricao: '28/56 dias', padrao: false },
  { codigo: '30-60-90', descricao: '30/60/90 dias', padrao: false },
];
const DESCRICAO_CONDICAO = new Map(CONDICOES_DEMO.map((x) => [x.codigo, x.descricao]));
export const idCondicaoDemo = (codigo: CodigoCondicao) => id(`condicao_pagamento:${codigo}`);
export const idTransportadoraDemo = (chave: string) => id(`transportadora:${chave}`);
export const idEnderecoDemo = (n: number, tipo: 'principal' | 'entrega') => id(`cliente_endereco:${n}:${tipo}`);
export const idProdutoDemo = (sku: string) => id(`produto:${sku}`);
export const idPedidoDemo = (chave: string) => id(`pedido:${chave}`);

// ---------------------------------------------------------------------------------------------------------------
// Clientes (Manaus)
/** Centro aproximado dos bairros de Manaus usados (coordenadas públicas de bairro; os pontos são deslocados). */
const BAIRROS: Record<string, [number, number]> = {
  Centro: [-3.1316, -60.0233], Adrianópolis: [-3.101, -60.009], Aleixo: [-3.089, -59.995], Flores: [-3.074, -60.012],
  'Parque 10 de Novembro': [-3.085, -60.013], Chapada: [-3.1, -60.025], Cachoeirinha: [-3.118, -60.011], 'Praça 14 de Janeiro': [-3.125, -60.015],
  'São Geraldo': [-3.11, -60.03], 'Dom Pedro': [-3.08, -60.035], Planalto: [-3.07, -60.045], Alvorada: [-3.082, -60.048],
  Compensa: [-3.105, -60.065], 'Ponta Negra': [-3.07, -60.095], Tarumã: [-3.01, -60.06], 'Cidade Nova': [-3.03, -59.99],
  'Novo Aleixo': [-3.055, -59.97], Japiim: [-3.118, -59.985], Petrópolis: [-3.11, -59.995], Coroado: [-3.095, -59.97],
  'São José Operário': [-3.075, -59.945], Educandos: [-3.14, -60.01], 'Distrito Industrial': [-3.125, -59.96], 'Armando Mendes': [-3.09, -59.945],
  'Santa Etelvina': [-2.995, -60.02], 'Colônia Terra Nova': [-3.005, -60.005], 'Lírio do Vale': [-3.07, -60.055], Redenção: [-3.06, -60.05],
  Raiz: [-3.125, -59.995], 'Nossa Senhora das Graças': [-3.105, -60.018],
};

type Dono = 'vendedor' | 'vendedor2';
/** [nome fantasia, segmento, bairro, logradouro, dono da carteira, também na carteira do promotor]. Nomes fictícios. */
const CLIENTES: Array<[string, string, string, string, Dono, boolean]> = [
  ['Supermercado Bom Preço', 'Supermercado', 'Centro', 'Rua dos Andradas', 'vendedor', true],
  ['Mercadinho São Jorge', 'Mercadinho', 'São Geraldo', 'Rua Pará', 'vendedor', false],
  ['Panificadora Pão Dourado', 'Padaria', 'Nossa Senhora das Graças', 'Rua Rio Içá', 'vendedor', false],
  ['Conveniência Rota 10', 'Conveniência', 'Parque 10 de Novembro', 'Av. Perimetral', 'vendedor', false],
  ['Supermercado Família', 'Supermercado', 'Flores', 'Av. das Flores', 'vendedor', true],
  ['Mercearia Boa Vista', 'Mercadinho', 'Chapada', 'Rua Belo Horizonte', 'vendedor', false],
  ['Atacadinho Cachoeirinha', 'Atacarejo', 'Cachoeirinha', 'Rua Silva Ramos', 'vendedor', false],
  ['Padaria Trigo Fino', 'Padaria', 'Praça 14 de Janeiro', 'Rua Ipixuna', 'vendedor', false],
  ['Mercado Estrela do Norte', 'Mercadinho', 'Adrianópolis', 'Rua Salvador', 'vendedor', false],
  ['Supermercado Tropical', 'Supermercado', 'Aleixo', 'Av. André Araújo', 'vendedor', true],
  ['Empório Ponta Negra', 'Conveniência', 'Ponta Negra', 'Av. do Turismo', 'vendedor', true],
  ['Mercadinho Primavera', 'Mercadinho', 'Dom Pedro', 'Rua das Primaveras', 'vendedor', false],
  ['Comercial Rio Negro', 'Atacarejo', 'Compensa', 'Rua Rio Negro', 'vendedor', false],
  ['Mini Box Japiim', 'Mercadinho', 'Japiim', 'Av. Ajuricaba', 'vendedor', false],
  ['Supermercado Econômico', 'Supermercado', 'Planalto', 'Av. Planalto', 'vendedor', true],
  ['Mercearia do Porto', 'Mercadinho', 'Educandos', 'Rua do Porto', 'vendedor', false],
  ['Panificadora Amazonas', 'Padaria', 'Alvorada', 'Rua Curió', 'vendedor', false],
  ['Mercado Bem-Te-Vi', 'Mercadinho', 'Redenção', 'Rua Bem-Te-Vi', 'vendedor', false],
  ['Conveniência Sol Nascente', 'Conveniência', 'Cidade Nova', 'Av. Noel Nutels', 'vendedor2', false],
  ['Supermercado Novo Horizonte', 'Supermercado', 'Novo Aleixo', 'Av. Autaz Mirim', 'vendedor2', true],
  ['Mercadinho Aliança', 'Mercadinho', 'Coroado', 'Rua Aliança', 'vendedor2', false],
  ['Padaria Santa Clara', 'Padaria', 'Petrópolis', 'Rua Santa Clara', 'vendedor2', false],
  ['Supermercado Vitória Régia', 'Supermercado', 'São José Operário', 'Av. Vitória Régia', 'vendedor2', true],
  ['Mercado Tucumã', 'Mercadinho', 'Armando Mendes', 'Rua Tucumã', 'vendedor2', false],
  ['Mini Mercado Buriti', 'Mercadinho', 'Distrito Industrial', 'Rua Buriti', 'vendedor2', false],
  ['Comercial Açaí', 'Atacarejo', 'Raiz', 'Rua do Açaí', 'vendedor2', false],
  ['Mercearia Cupuaçu', 'Mercadinho', 'Santa Etelvina', 'Rua Cupuaçu', 'vendedor2', false],
  ['Atacado Boto Rosa', 'Atacarejo', 'Tarumã', 'Estrada do Tarumã', 'vendedor2', false],
  ['Mercadinho Jaraqui', 'Mercadinho', 'Colônia Terra Nova', 'Rua Jaraqui', 'vendedor2', false],
  ['Supermercado Encontro das Águas', 'Supermercado', 'Lírio do Vale', 'Av. Encontro das Águas', 'vendedor2', false],
];
export const idClienteDemo = (n: number) => id(`cliente:${n}`);

/**
 * Cliente da referência do novo pedido (T-0071, R-20261103-130003): Mini Box Japiim, cód. C5110, Av. Ajuricaba, 1200 · Japiim ·
 * 69077-000, com um endereço de entrega, sem título vencido nem bloqueio (pode enviar pedido) e condições À vista, 28 e 28/56.
 */
export const CLIENTE_REFERENCIA_DEMO = 13;
/** Código do cliente no ERP (external_id e retrato do pedido): C5001.. pela posição; o da referência é C5110. */
export const codigoErpDemo = (n: number) => (n === CLIENTE_REFERENCIA_DEMO ? 'C5110' : `C${String(5000 + n + 1)}`);
/** Número do endereço principal (o da referência: 1200). */
const numeroDemo = (n: number) => (n === CLIENTE_REFERENCIA_DEMO ? '1200' : String(100 + ((n * 37) % 900)));
/** CEP do endereço principal (o da referência: 69077-000). */
const cepClienteDemo = (n: number) => (n === CLIENTE_REFERENCIA_DEMO ? '69077000' : cepDemo(n));

/** Cliente com cadastro incompleto (RN-CORE-16/17): Atacado Boto Rosa sem CEP — pedido dele só como orçamento. */
export const CLIENTE_SEM_CEP_DEMO = 27;
/** Cliente com IE "ISENTO" (Panificadora Pão Dourado). */
const ISENTO_IE = 2;
/** Clientes com um 2º endereço de entrega (RN-VEN-17); clientes cujos pedidos da demo são FOB (RN-VEN-16): índice -> transportadora. */
const COM_ENTREGA = [0, 4, 9, 13, 19, 22] as const;
const FRETE_FOB: Record<number, string> = { 0: 'rio-negro', 9: 'rio-negro', 12: 'expresso-amazonas', 27: 'expresso-amazonas' };

/**
 * Índices (0-based) com título vencido; o 15 (Mercearia do Porto) está bloqueado por atraso. Até a T-0071 o vencido/bloqueado era
 * o 13 (Mini Box Japiim), que virou o cliente da referência do novo pedido (envia pedido, prazo 28/56).
 */
const COM_VENCIDO = new Set([1, 5, 9, 15, 17, 21, 25, 29]);
const BLOQUEADO = 15;

/** Rotas de HOJE: índices dos clientes na ordem da visita. */
const ROTAS_HOJE: Array<[ChaveUsuario, number[]]> = [
  ['vendedor', [0, 1, 7, 2, 5, 13]],
  ['vendedor2', [18, 19, 21, 23]],
  ['promotor', [0, 4, 9, 22]],
];
/** Janela de atendimento (hora local) de algumas paradas do vendedor. */
const JANELAS: Record<number, [string, string]> = { 0: ['08:00', '10:00'], 7: ['14:00', '16:00'] };

// ---------------------------------------------------------------------------------------------------------------
// Pedidos e visitas passadas
/**
 * Desfecho depois do recebimento: `recebido` = o que o servidor decide pela alçada (approved dentro dela, ou
 * pending_approval com o nível); `rejeitado` (pela supervisora) e `cancelado` (pelo vendedor, depois de aprovado).
 */
type Desfecho = 'recebido' | 'rejeitado' | 'cancelado';
/** [chave, cliente, vendedor, desfecho, dias úteis atrás, desconto %, condição, itens [sku, qtd]] */
const PEDIDOS: Array<[string, number, Dono, Desfecho, number, number, CodigoCondicao, Array<[string, number]>]> = [
  ['p01', 0, 'vendedor', 'recebido', 12, 0, '28D', [['ARR-5K', 20], ['FEI-1K', 30], ['OLE-900', 24], ['CAF-500', 12]]],
  ['p02', 2, 'vendedor', 'recebido', 8, 3, '28D', [['ACU-1K', 50], ['MAR-500', 12], ['LEI-1L', 24]]],
  ['p03', 4, 'vendedor', 'recebido', 3, 5, '28-56', [['REF-2L', 36], ['REF-350', 6], ['AGU-500', 8]]],
  ['p04', 6, 'vendedor', 'recebido', 2, 0, '28D', [['SAB-1K', 24], ['DET-500', 48], ['PAP-4', 20]]],
  // 8%: acima da alçada do vendedor (5%), aguarda a supervisora — é o pedido "de ontem" do recado da Renata
  // T-0071: leite em pó no lugar do molho — os mercadinhos do Lucas (clientes parecidos do Mini Box Japiim) só compraram itens
  // da referência ou complementares do café, e o "Combina com o pedido" mostra os 3 da referência
  ['p05', 1, 'vendedor', 'recebido', 1, 8, '28D', [['CAF-500', 24], ['BIS-400', 30], ['LPO-400', 12]]],
  ['p06', 8, 'vendedor', 'rejeitado', 2, 9, 'AVISTA', [['ACA-1K', 10], ['SUC-1L', 12]]],
  ['p07', 10, 'vendedor', 'cancelado', 5, 0, '28D', [['SAR-125', 48]]],
  ['p08', 18, 'vendedor2', 'recebido', 10, 0, '28D', [['ARR-5K', 15], ['FEI-1K', 20], ['FAR-1K', 20]]],
  // 12%: acima da alçada do supervisor (10%), aguarda o gerente
  ['p09', 20, 'vendedor2', 'recebido', 2, 12, '28-56', [['REF-2L', 24], ['BIS-140', 60]]],
  ['p10', 22, 'vendedor2', 'recebido', 1, 7, '30-60-90', [['OLE-900', 48], ['MAC-500', 60]]],
  // T-0071: 2º mercadinho do Lucas com pedido recente (clientes parecidos do Mini Box Japiim, desenho §4.3), dentro da alçada
  ['p11', 11, 'vendedor', 'recebido', 4, 2, '28-56', [['CAF-500', 12], ['ACU-1K', 24], ['FIL-103', 12], ['AGU-500', 4]]],
];
/**
 * Contam como venda na base "aprovado" (parâmetro metas.base_apuracao): os de STATUS_QUE_CONTAM_NA_META do Vendedor + o
 * cancelado depois de aprovado (o diário guarda o cancelado à parte). T-0155: o faturado parcial conta o TOTAL do pedido
 * (confirmação do Vendedor, R-20261110-060422): a meta não muda com o faturamento.
 */
export const VENDIDO_DEMO: ReadonlySet<string> = new Set<string>([...STATUS_QUE_CONTAM_NA_META, 'cancelled']);

/** Autor da linha do tempo nos marcos do ERP (= AUTOR_ERP de modules/vendedor/api/retorno-erp.ts; conferido no teste). */
export const AUTOR_ERP_DEMO = { nome: 'ERP', perfil: 'erp' } as const;

/**
 * T-0155 (R-20261109-202200, SIM do Alexandre ao R-20261109-124031): 3 pedidos aprovados que o ERP já faturou, para o roteiro
 * "pedido → ERP → faturado visível no app". Marcos (Manaus): enviado ao ERP às 07:30 e integrado às 07:45 do dia útil seguinte
 * ao pedido, faturado às 16:40 do outro; a devolução do p02 às 10:15 de 4 dias úteis atrás. Tudo passa pelas MESMAS funções do
 * consumidor do retorno do Vendedor (planejarRetornoErp, itensDoFaturamento, resumoFaturamento, decidirNotaDevolucao) e, na fila
 * do ERP (integracao.ts), pelas do Hub; o valor do item faturado é a proporção do total do item. Números do ERP e notas fictícios.
 *  - p01 (Lucas): Faturado, 1 nota com todos os itens;
 *  - p08 (Camila): Faturado parcial, 1 nota com a Farinha pela metade (10 de 20);
 *  - p02 (Lucas): Faturado e devolução parcial (6 dos 24 leites, nota de devolução própria).
 * A meta não muda (base = pedido aprovado; o p08 conta o total).
 */
export interface FaturamentoDemo {
  numero_erp: string;
  nota: { numero: string; serie: string };
  /** faturamento parcial: sku -> quantidade faturada (os demais itens saem inteiros); ausente = faturado total */
  parcial?: Readonly<Record<string, number>>;
  /** devolução parcial de um item, com a nota de devolução do ERP (external_id = chave da nota) */
  devolucao?: { sku: string; quantidade: number; nota: { numero: string; serie: string; external_id: string } };
}
export const FATURAMENTOS_DEMO: Readonly<Record<string, FaturamentoDemo>> = {
  p01: { numero_erp: '458210', nota: { numero: '000081234', serie: '1' } },
  p08: { numero_erp: '458231', nota: { numero: '000081267', serie: '1' }, parcial: { 'FAR-1K': 10 } },
  p02: {
    numero_erp: '458247', nota: { numero: '000081290', serie: '1' },
    devolucao: { sku: 'LEI-1L', quantidade: 6, nota: { numero: '000002315', serie: '2', external_id: 'NFD-2-000002315' } },
  },
};
/**
 * 0055 (T-0141 C, RN-VEN-17): o p11 (aprovado, Lucas) leva o endereço digitado só no pedido — retrato com origem 'editado',
 * sem id/external_id e endereco_entrega_id nulo (o Conector usa os textos). Para o e2e do testes, o detalhe, os PDFs e a
 * devolução ao ERP. Os demais pedidos ficam com o retrato do principal sem `origem` (= 'erp', o formato antigo).
 */
export const PEDIDO_ENDERECO_EDITADO_DEMO = 'p11';
export const ENDERECO_EDITADO_DEMO = {
  id: null, external_id: null, descricao: null, logradouro: 'Avenida Torquato Tapajós', numero: '7500', complemento: 'Galpão 3',
  bairro: 'Flores', cidade: 'Manaus', uf: 'AM', cep: '69058830', principal: false, origem: 'editado',
} as const;
const MOTIVO_REJEICAO_DEMO = 'Desconto acima da política para este cliente. Refaça com até 5%.';
const MOTIVO_CANCELAMENTO_DEMO = 'Cliente desistiu da compra';

/** Visitas sem pedido: [chave, usuário, cliente, dias úteis atrás, resultado, motivo]. */
const VISITAS_SEM_PEDIDO: Array<[string, ChaveUsuario, number, number, 'sem_pedido' | 'atendido', CodigoMotivoPadrao | null]> = [
  ['v-sp1', 'vendedor', 3, 4, 'sem_pedido', 'estoque_alto'],
  ['v-sp2', 'vendedor', 5, 2, 'sem_pedido', 'comprador_ausente'],
  ['v-sp3', 'vendedor2', 19, 3, 'sem_pedido', 'preco_concorrente'],
  ['v-pr1', 'promotor', 0, 2, 'atendido', null],
  ['v-pr2', 'promotor', 4, 1, 'atendido', null],
];

/** Motivos além dos padrões do gatilho core.semear_tenant (RN-CORE-14). */
const MOTIVOS_EXTRAS: Array<[string, string, string, number]> = [
  ['nao_venda', 'mix_completo', 'Cliente com mix completo', 20],
  ['nao_venda', 'pedido_pelo_televendas', 'Pedido já feito pelo televendas', 21],
  ['fora_do_raio', 'gps_impreciso', 'GPS impreciso no local', 30],
  ['fora_do_raio', 'endereco_desatualizado', 'Endereço do cliente desatualizado', 31],
];

/** Metas do mês: [usuário, indicador, valor] (venda em centavos; cobertura em pontos-base). */
const METAS: Array<[ChaveUsuario, 'venda_cents' | 'positivacao' | 'cobertura_pct' | 'visitas', number]> = [
  ['vendedor', 'venda_cents', 18_000_000], ['vendedor', 'positivacao', 15], ['vendedor', 'cobertura_pct', 9_000], ['vendedor', 'visitas', 90],
  ['vendedor2', 'venda_cents', 12_000_000], ['vendedor2', 'positivacao', 10], ['vendedor2', 'cobertura_pct', 8_500], ['vendedor2', 'visitas', 60],
  ['promotor', 'visitas', 80], ['promotor', 'cobertura_pct', 9_000],
];

/**
 * Metas do MÊS ANTERIOR (T-0070, decisão do gerente): Lucas e Camila, mesmos 4 indicadores e tipo 'pedido' das do mês
 * corrente, com valores um pouco diferentes para o "copiar do mês anterior" do BKO de metas (T-0068) ser visível.
 */
export const METAS_MES_ANTERIOR_DEMO: ReadonlyArray<readonly [ChaveUsuario, 'venda_cents' | 'positivacao' | 'cobertura_pct' | 'visitas', number]> = [
  ['vendedor', 'venda_cents', 16_500_000], ['vendedor', 'positivacao', 14], ['vendedor', 'cobertura_pct', 8_800], ['vendedor', 'visitas', 85],
  ['vendedor2', 'venda_cents', 11_000_000], ['vendedor2', 'positivacao', 9], ['vendedor2', 'cobertura_pct', 8_000], ['vendedor2', 'visitas', 55],
];

// ---------------------------------------------------------------------------------------------------------------
export const ORDEM_DEMO = [
  'plataforma.tenant',
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'plataforma.parametro',
  'core.equipe',
  'core.usuario',
  'core.produto',
  'core.cliente',
  'core.carteira',
  'core.cliente_contato',
  'core.cliente_financeiro',
  'core.titulo',
  'core.historico_compra',
  'core.motivo',
  'core.rota',
  'core.rota_parada',
  'core.visita',
  'core.meta',
  'core.indicador_diario',
  'core.notificacao',
  'catalogo.tabela_preco',
  'catalogo.tabela_preco_item',
  'catalogo.cliente_tabela_preco',
  'vendedor.condicao_pagamento',
  'vendedor.cliente_condicao',
  'vendedor.numeracao_pedido',
  // 0013: unidades, endereços, árvore, conteúdo, busca, estoque e frete (antes do pedido: FK da transportadora)
  'core.produto_unidade',
  'core.cliente_endereco',
  'catalogo.catalogo_no',
  'catalogo.produto_no',
  // 0020 (T-0071): relacionados do produto
  'catalogo.produto_relacao',
  'catalogo.produto_conteudo',
  'catalogo.produto_atributo',
  'catalogo.sinonimo',
  'catalogo.produto_busca',
  'catalogo.deposito',
  'catalogo.estoque_saldo',
  'vendedor.transportadora',
  'vendedor.pedido',
  'vendedor.pedido_item',
  'vendedor.pedido_evento',
  // T-0155 (0013/0050): nota de faturamento e de devolução dos pedidos faturados
  'vendedor.pedido_faturamento',
  'vendedor.pedido_devolucao',
] as const;
export type TabelaDemo = (typeof ORDEM_DEMO)[number];
export type DadosDemo = Record<TabelaDemo, Linha[]>;

export interface OpcoesDemo {
  /** "Hoje" (AAAA-MM-DD) da demonstração; padrão: hoje em America/Manaus no momento do seed. */
  hoje?: string;
}

/** Data `n` dias úteis (seg–sáb) antes de `data`. */
export function diasUteisAtras(data: string, n: number): string {
  let d = data;
  let faltam = n;
  while (faltam > 0) {
    d = somarDias(d, -1);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) faltam--;
  }
  return d;
}

/** Hora local de Manaus (UTC−4, sem horário de verão) -> instante UTC ISO. */
function emManaus(data: string, horaLocal: string): string {
  const [h, m] = horaLocal.split(':').map(Number) as [number, number];
  const total = h * 60 + m + 4 * 60;
  const dia = total >= 24 * 60 ? somarDias(data, 1) : data;
  const min = total % (24 * 60);
  return instante(dia, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
}

const arred6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Coordenada do cliente n: centro do bairro + deslocamento pequeno e estável (até ~300 m). */
function coordenada(n: number): [number, number] {
  const [lat, lng] = BAIRROS[CLIENTES[n]![2]]!;
  return [arred6(lat + (((n * 7) % 5) - 2) * 0.0012), arred6(lng + (((n * 3) % 5) - 2) * 0.0012)];
}

/** Monta as linhas da base de demo (função pura; `senhaHash` por usuário ou um só para todos). */
export function dadosDemo(senhaHash: string | ((u: ChaveUsuario) => string), opcoes: OpcoesDemo = {}): DadosDemo {
  const hoje = opcoes.hoje ?? hojeNoFuso(FUSO_DEMO);
  const periodo = anoMes(hoje);
  const hashDe = typeof senhaHash === 'string' ? () => senhaHash : senhaHash;
  const equipeId = id('equipe:Equipe Manaus');
  const regionalId = id('equipe:Regional Norte');
  const u = idUsuarioDemo;
  const c = idClienteDemo;

  const usuarios: Linha[] = (Object.keys(USUARIOS_DEMO) as ChaveUsuario[]).map((k) => {
    const x = USUARIOS_DEMO[k];
    const equipe_id = x.equipe === 'manaus' ? equipeId : x.equipe === 'regional' ? regionalId : null;
    return {
      id: u(k), tenant_id: T, nome: x.nome, nome_curto: x.curto, email: x.email, perfil: x.perfil, equipe_id,
      senha_hash: hashDe(k), ativo: true, bloqueado_em: null, tentativas_falhas: 0, bloqueio_ate: null, deleted_at: null, external_id: x.externo,
      // 0040 (T-0094, RN-CORE-34): a senha da demo é definitiva (sem "trocar no 1º uso", sem validade) e a carga desfaz uma
      // temporária ou um "trocar senha" deixados por um ensaio de redefinição/"Esqueci a senha" (a demo volta a entrar com a
      // MACUXI_SENHA_DEMO). A sessao_versao não volta atrás (token antigo continua morto).
      trocar_senha: false, senha_expira_em: null, senha_temporaria_hash: null, senha_temporaria_expira_em: null, senha_temporaria_criada_em: null,
    };
  });

  const clientes: Linha[] = CLIENTES.map(([nome, segmento, bairro, rua], n) => {
    const [latitude, longitude] = coordenada(n);
    const semCep = n === CLIENTE_SEM_CEP_DEMO;
    return {
      id: c(n), tenant_id: T, documento: cnpjDemo(n + 1), razao_social: `${nome} Comércio de Alimentos Ltda`, nome_fantasia: nome, segmento,
      telefone: `9230000${String(n + 1).padStart(3, '0')}`, email: null, logradouro: rua, numero: numeroDemo(n), bairro,
      cidade: 'Manaus', uf: 'AM', cep: semCep ? null : cepClienteDemo(n), latitude, longitude, ativo: true, deleted_at: null,
      external_id: codigoErpDemo(n),
      // 0013 (RN-CORE-16/17): todos com CNPJ fictício válido e IE; 1 sem CEP (cadastro incompleto) para a demonstração
      inscricao_estadual: ieDemo(n), observacao: semCep ? 'Receber mercadoria só pela manhã (doca 2).' : null,
      cadastro_incompleto: semCep, cadastro_campos_faltantes: arrayDeTexto(semCep ? ['cep'] : []),
    };
  });

  const carteira: Linha[] = CLIENTES.flatMap(([, , , , dono, comPromotor], n) => [
    { id: id(`carteira:${n}:vendedor`), tenant_id: T, cliente_id: c(n), usuario_id: u(dono), papel: 'vendedor', inicio: null, fim: null, ...comuns },
    ...(comPromotor ? [{ id: id(`carteira:${n}:promotor`), tenant_id: T, cliente_id: c(n), usuario_id: u('promotor'), papel: 'promotor', inicio: null, fim: null, ...comuns }] : []),
  ]);

  const contatos: Linha[] = [];
  const financeiros: Linha[] = [];
  const titulos: Linha[] = [];
  const historico: Linha[] = [];
  const PRIMEIROS = ['Ana', 'Bruno', 'Cláudia', 'Davi', 'Elaine', 'Fábio', 'Gisele', 'Hugo', 'Isabela', 'Jorge'];
  CLIENTES.forEach(([, segmento], n) => {
    const grande = segmento === 'Supermercado' || segmento === 'Atacarejo';
    contatos.push({
      id: id(`cliente_contato:${n}`), tenant_id: T, cliente_id: c(n), nome: `${PRIMEIROS[n % PRIMEIROS.length]} (comprador)`, cargo: 'Comprador',
      telefone: `9230000${String(n + 1).padStart(3, '0')}`, whatsapp: `9290000${String(n + 1).padStart(4, '0')}`, email: `compras.c${String(n + 1).padStart(2, '0')}@exemplo.com.br`,
      principal: true, ...comuns,
    });
    const limite = [500_000, 1_000_000, 1_500_000, 2_500_000, 4_000_000][n % 5]! * (grande ? 2 : 1);
    const vencido = COM_VENCIDO.has(n);
    const valor1 = 150_000 + ((n * 7_919) % 20) * 10_000;
    const valor2 = 120_000 + ((n * 104_729) % 15) * 10_000;
    const doc = `NF ${String(41_000 + n * 7)}`;
    const venc1 = n === BLOQUEADO ? somarDias(hoje, -45) : somarDias(hoje, -10 - (n % 5));
    titulos.push(
      {
        id: id(`titulo:${n}:1`), tenant_id: T, cliente_id: c(n), documento: doc, parcela: '1/2', emissao: somarDias(venc1, -30), vencimento: venc1,
        valor_cents: valor1, saldo_cents: vencido ? valor1 : 0, situacao: vencido ? 'aberto' : 'liquidado',
        liquidado_em: vencido ? null : emManaus(somarDias(venc1, -1), '15:00'), ...comuns,
      },
      {
        id: id(`titulo:${n}:2`), tenant_id: T, cliente_id: c(n), documento: doc, parcela: '2/2', emissao: somarDias(venc1, -30), vencimento: somarDias(hoje, 12 + (n % 15)),
        valor_cents: valor2, saldo_cents: valor2, situacao: 'aberto', liquidado_em: null, ...comuns,
      },
      {
        id: id(`titulo:${n}:3`), tenant_id: T, cliente_id: c(n), documento: `NF ${String(39_000 + n * 7)}`, parcela: '1/1', emissao: somarDias(hoje, -75),
        vencimento: somarDias(hoje, -45), valor_cents: 210_000 + n * 3_000, saldo_cents: 0, situacao: 'liquidado',
        liquidado_em: emManaus(somarDias(hoje, -46), '11:00'), ...comuns,
      },
    );
    financeiros.push({
      id: id(`cliente_financeiro:${n}`), tenant_id: T, cliente_id: c(n), limite_cents: limite, saldo_aberto_cents: (vencido ? valor1 : 0) + valor2,
      credito_disponivel_cents: null, bloqueado: n === BLOQUEADO, motivo_bloqueio: n === BLOQUEADO ? 'Títulos vencidos há mais de 30 dias' : null,
      atualizado_erp_em: emManaus(somarDias(hoje, -1), '19:00'), ...comuns,
    });
    for (let m = 0; m < 12; m++) {
      const am = anoMes(hoje, m - 11);
      const base = grande ? 900_000 : 250_000;
      historico.push({
        id: id(`historico_compra:${n}:${am}`), tenant_id: T, cliente_id: c(n), ano_mes: am, valor_cents: base + ((n * 37 + m * 53) % 20) * (grande ? 60_000 : 15_000),
        pedidos: 1 + ((n + m) % 4), itens: 5 + ((n * 3 + m) % 18), ultima_compra_em: menorData(`${am}-${String(3 + ((n + m) % 24)).padStart(2, '0')}`, hoje),
        origem: 'erp', ...comuns,
      });
    }
  });

  const motivos: Linha[] = MOTIVOS_EXTRAS.map(([tipo, codigo, descricao, ordem]) => ({
    id: id(`motivo:${tipo}:${codigo}`), tenant_id: T, tipo, codigo, descricao, exige_foto: false, sistema: false, ativo: true, ordem, ...comuns,
  }));

  // rotas de hoje (id pela data: cada dia de demonstração ganha a sua; as de dias anteriores ficam como histórico)
  const rotas: Linha[] = [];
  const paradas: Linha[] = [];
  for (const [quem, lista] of ROTAS_HOJE) {
    const rota_id = id(`rota:${quem}:${hoje}`);
    rotas.push({ id: rota_id, tenant_id: T, usuario_id: u(quem), data: hoje, situacao: 'publicada', origem: 'bko', regiao: 'Manaus', observacao: null, ...comuns });
    lista.forEach((n, i) => {
      const janela = quem === 'vendedor' ? JANELAS[n] : undefined;
      paradas.push({
        id: id(`rota_parada:${quem}:${hoje}:${n}`), tenant_id: T, rota_id, usuario_id: u(quem), data: hoje, cliente_id: c(n), sequencia: i + 1,
        janela_inicio: janela?.[0] ?? null, janela_fim: janela?.[1] ?? null, ...comuns,
      });
    });
  }

  const visita = (chave: string, quem: ChaveUsuario, n: number, data: string, hora: string, resultado: string, extra: Partial<Linha> = {}): Linha => {
    const [lat, lng] = coordenada(n);
    return {
      id: id(`visita:${chave}`), tenant_id: T, usuario_id: u(quem), cliente_id: c(n), rota_parada_id: null, data_local: data,
      checkin_em: emManaus(data, hora), checkin_lat: arred6(lat + 0.0001), checkin_lng: arred6(lng + 0.0001), checkin_precisao_m: 12, sem_gps: false,
      distancia_m: 15, fora_do_raio: false, justificativa_fora_raio: null, sugere_coordenada: false, extra: true,
      checkout_id: id(`visita_checkout:${chave}`), checkout_em: emManaus(data, `${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}${hora.slice(2)}`),
      checkout_lat: arred6(lat + 0.0001), checkout_lng: arred6(lng + 0.0001), resultado, motivo_id: null, motivo_texto: null, pedido_id: null,
      foto_fachada_id: null, fechada_por: 'usuario', recebido_em: emManaus(data, `${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}${hora.slice(2)}`),
      ...comuns, ...extra,
    };
  };

  // ---- preço (catalogo) e condições (vendedor), T-0029 §10
  const inicioVigencia = emManaus(`${anoMes(hoje, -1)}-01`, '00:00');
  const idTabela = (t: ChaveTabela) => id(`tabela_preco:${t}`);
  const tabelaDoCliente = (n: number): ChaveTabela => tabelaDoSegmento(CLIENTES[n]![1]);
  const tabelasPreco: Linha[] = (Object.keys(TABELAS_PRECO_DEMO) as ChaveTabela[]).map((t) => ({
    id: idTabela(t), tenant_id: T, codigo: TABELAS_PRECO_DEMO[t].codigo, nome: TABELAS_PRECO_DEMO[t].nome, ativo: true, ...comuns,
  }));
  const itensTabela: Linha[] = (Object.keys(TABELAS_PRECO_DEMO) as ChaveTabela[]).flatMap((t) =>
    PRODUTOS.flatMap(([sku]) => {
      const preco = precoNaTabela(t, sku);
      return preco === null
        ? []
        : [{ id: id(`tabela_preco_item:${t}:${sku}`), tenant_id: T, tabela_preco_id: idTabela(t), produto_id: id(`produto:${sku}`), preco_cents: preco, vigencia_inicio: inicioVigencia, vigencia_fim: null, unidade: null, ...comuns }];
    }),
  );
  // RN-VEN-15 (T-0089): só o preço da UN (unidade nula); a CX vale UN × fator, sem linha própria
  const clienteTabela: Linha[] = CLIENTES.map((_, n) => ({ id: id(`cliente_tabela_preco:${n}`), tenant_id: T, cliente_id: c(n), tabela_preco_id: idTabela(tabelaDoCliente(n)), ...comuns }));
  /** RN-VEN-14: com título vencido só À vista e 28 dias; os demais 3 ou 4 condições. */
  const condicoesDoCliente = (n: number): CodigoCondicao[] =>
    COM_VENCIDO.has(n) ? ['AVISTA', '28D'] : n % 2 === 0 ? ['AVISTA', '28D', '28-56', '30-60-90'] : ['AVISTA', '28D', '28-56'];
  const condicoes: Linha[] = CONDICOES_DEMO.map((x) => ({ id: idCondicaoDemo(x.codigo), tenant_id: T, codigo: x.codigo, descricao: x.descricao, ativo: true, padrao: x.padrao, ...comuns }));
  const clienteCondicoes: Linha[] = CLIENTES.flatMap((_, n) =>
    condicoesDoCliente(n).map((cod) => ({ id: id(`cliente_condicao:${n}:${cod}`), tenant_id: T, cliente_id: c(n), condicao_pagamento_id: idCondicaoDemo(cod), ...comuns })),
  );

  // ---- pedidos: a MESMA regra do servidor (revalidarPedido: preço da tabela do cliente, alçada -> status e nível)
  const politica = politicaDosParametros({ ...ALCADAS_DEMO });
  const carteiraDe = (quem: Dono) => CLIENTES.flatMap(([, , , , dono], n) => (dono === quem ? [c(n)] : []));
  const depois = (iso: string, minutos: number) => new Date(Date.parse(iso) + minutos * 60_000).toISOString();
  const visitas: Linha[] = [];
  const pedidos: Linha[] = [];
  const itens: Linha[] = [];
  const eventos: Linha[] = [];
  const faturamentos: Linha[] = [];
  const devolucoes: Linha[] = [];
  // id do diário pelo deslocamento (dias úteis atrás), não pela data: rodar em outro dia MOVE a linha em vez de
  // deixar a do dia antigo somando de novo no realizado (ver o delete por id em carregarDemo)
  const diario = new Map<string, { chave: string; usuario: ChaveUsuario; data: string; pedidos: number; vendido: number; cancelado: number }>();
  PEDIDOS.forEach(([chave, n, quem, desfecho, atras, desconto, condicao, linhas], k) => {
    const data = diasUteisAtras(hoje, atras);
    const hora = `${String(9 + (k % 7)).padStart(2, '0')}:${k % 2 ? '30' : '10'}`;
    const pedido_id = id(`pedido:${chave}`);
    const visita_id = id(`visita:${chave}`);
    const tabela = tabelaDoCliente(n);
    if (!condicoesDoCliente(n).includes(condicao)) throw new Error(`[db] seed demo: pedido ${chave} com condição não permitida ao cliente (RN-VEN-14)`);
    const r = revalidarPedido({
      perfil: 'vendedor', vendedor_id: u(quem), cliente_id: c(n), carteira: carteiraDe(quem), desconto_pct: desconto,
      itens: linhas.map(([sku, qtd]) => ({ product_id: id(`produto:${sku}`), sku, quantity: qtd })),
      precos: Object.fromEntries(linhas.map(([sku]) => [id(`produto:${sku}`), precoNaTabela(tabela, sku)])),
      policy: politica,
    });
    if (!r.ok) throw new Error(`[db] seed demo: pedido ${chave} recusado pela regra do servidor (${r.codigo}): ${r.mensagem}`);
    const criado = emManaus(data, `${hora.slice(0, 2)}:${hora.slice(3) === '10' ? '40' : '55'}`);
    const vendedor = USUARIOS_DEMO[quem];
    const historico: Array<{ de: OrderStatus | null; para: OrderStatus; autor: ChaveUsuario | 'erp'; motivo: string; nivel: string | null; em: string }> = r.historico.map((h) => ({
      de: h.de, para: h.para, autor: quem, motivo: h.motivo, nivel: h.para === 'pending_approval' ? r.nivel : null, em: criado,
    }));
    let status: OrderStatus = r.status;
    let decisao: { por: string; em: string; motivo: string | null } | null = null;
    if (desfecho === 'rejeitado') {
      if (r.status !== 'pending_approval' || r.nivel !== 'supervisor') throw new Error(`[db] seed demo: ${chave} deveria aguardar o supervisor`);
      status = 'rejected';
      decisao = { por: u('supervisor'), em: depois(criado, 120), motivo: MOTIVO_REJEICAO_DEMO };
      historico.push({ de: 'pending_approval', para: 'rejected', autor: 'supervisor', motivo: MOTIVO_REJEICAO_DEMO, nivel: 'supervisor', em: decisao.em });
    } else if (desfecho === 'cancelado') {
      if (r.status !== 'approved') throw new Error(`[db] seed demo: ${chave} deveria estar aprovado antes de cancelar`);
      status = 'cancelled';
      historico.push({ de: 'approved', para: 'cancelled', autor: quem, motivo: MOTIVO_CANCELAMENTO_DEMO, nivel: null, em: depois(criado, 180) });
    }
    // T-0155: faturado pelo ERP (só aprovado entra na fila do ERP, RN-INT-08)
    const fat = FATURAMENTOS_DEMO[chave];
    if (fat && status !== 'approved') throw new Error(`[db] seed demo: ${chave} deveria estar aprovado para ir ao ERP (RN-INT-08)`);
    const erp = fat
      ? faturarPedidoDemo(chave, pedido_id, fat, {
          enviado: emManaus(diasUteisAtras(hoje, atras - 1), '07:30'),
          integrado: emManaus(diasUteisAtras(hoje, atras - 1), '07:45'),
          faturado: emManaus(diasUteisAtras(hoje, atras - 2), '16:40'),
          devolvido: emManaus(diasUteisAtras(hoje, atras - 4), '10:15'),
        }, r.itens.map((it, s) => ({ sequencia: s + 1, sku: it.sku, product_id: it.product_id, quantity: it.quantity, total_cents: it.total_cents })))
      : null;
    if (erp) {
      historico.push(...erp.linhaDoTempo.map((x) => ({ ...x, autor: 'erp' as const, nivel: null })));
      status = erp.status;
      faturamentos.push(erp.faturamento);
      if (erp.devolucao) devolucoes.push(erp.devolucao);
    }
    r.itens.forEach((it, s) => {
      const sku = it.sku;
      itens.push({
        id: id(`pedido_item:${chave}:${s + 1}`), tenant_id: T, pedido_id, sequencia: s + 1, produto_id: it.product_id, quantidade: it.quantity,
        preco_tabela_cents: it.preco_tabela_cents, preco_unitario_cents: it.preco_unitario_cents, desconto_pct: it.desconto_pct, total_cents: it.total_cents,
        produto_sku: sku, produto_nome: PRODUTO.get(sku)!.nome, unidade: PRODUTO.get(sku)!.unidade, ...comuns,
        // 0013 (T-0155): quanto o ERP já faturou do item, na unidade base (resumo do retorno); 0 nos demais (a recarga zera)
        quantidade_faturada: erp?.resumo.itens.find((x) => x.sequencia === s + 1)?.faturada ?? 0,
      });
    });
    const [nome, , bairro, rua] = CLIENTES[n]!;
    const cli = { logradouro: rua, numero: numeroDemo(n) };
    // 0013: frete (R-20261102-105040: FOB = o cliente paga, com a transportadora; senão CIF) e entrega no endereço principal
    const fob = FRETE_FOB[n];
    const transp = fob ? TRANSPORTADORAS.find(([k]) => k === fob)! : null;
    const tabelaCents = r.total_tabela_cents;
    pedidos.push({
      id: pedido_id, tenant_id: T, cliente_id: c(n), vendedor_id: u(quem), autor_id: u(quem), status, condicao_pagamento: DESCRICAO_CONDICAO.get(condicao)!,
      desconto_pct: r.desconto_pct, total_tabela_cents: r.total_tabela_cents, total_cents: r.total_cents, observacao: null,
      visita_id, rota_parada_id: null, criado_no_aparelho_em: criado, recebido_em: criado, numero_erp: erp?.numero_erp ?? null,
      // 0013 (T-0155): marcos e resumo do ERP; nulos/0 nos que não foram ao ERP (a recarga desfaz um retorno do ensaio)
      enviado_erp_em: erp?.enviado_em ?? null, integrado_em: erp?.integrado_em ?? null, faturado_em: erp?.resumo.ultimo_faturamento_em ?? null,
      total_faturado_cents: erp?.resumo.faturado_cents ?? 0,
      motivo_cancelamento: status === 'cancelled' ? MOTIVO_CANCELAMENTO_DEMO : null,
      numero: null, hash_envio: null,
      cliente_resumo: {
        razao_social: `${nome} Comércio de Alimentos Ltda`, nome_fantasia: nome, documento: cnpjDemo(n + 1), endereco: `${cli.logradouro}, ${cli.numero}`, bairro,
        cidade: 'Manaus', uf: 'AM', codigo_erp: codigoErpDemo(n),
      },
      desconto_efetivo_pct: tabelaCents > 0 ? Math.round((1 - r.total_cents / tabelaCents) * 10_000) / 100 : 0,
      frete_modalidade: transp ? 'FOB' : 'CIF',
      transportadora_id: transp ? idTransportadoraDemo(transp[0]) : null, transportadora_digitada: false, transportadora_nome: transp?.[1] ?? null,
      transportadora_documento: transp ? cnpjDemo(900 + TRANSPORTADORAS.indexOf(transp)) : null, transportadora_telefone: transp?.[2] ?? null,
      // 0055 (T-0141 C, RN-VEN-17): um pedido aprovado com o endereço digitado só nele (o cadastro do cliente não muda)
      endereco_entrega_id: chave === PEDIDO_ENDERECO_EDITADO_DEMO ? null : idEnderecoDemo(n, 'principal'),
      endereco_entrega: chave === PEDIDO_ENDERECO_EDITADO_DEMO
        ? { ...ENDERECO_EDITADO_DEMO }
        : { logradouro: cli.logradouro, numero: cli.numero, complemento: null, bairro, cidade: 'Manaus', uf: 'AM', cep: n === CLIENTE_SEM_CEP_DEMO ? null : cepClienteDemo(n), descricao: 'Principal' },
      cliente_nome: nome, vendedor_nome: vendedor.nome, tabela_preco_id: idTabela(tabela), condicao_pagamento_id: idCondicaoDemo(condicao),
      condicao_pagamento_descricao: DESCRICAO_CONDICAO.get(condicao)!, nivel_aprovacao: r.nivel, motivos_aprovacao: arrayDeTexto(r.motivos),
      aprovacao_automatica: r.aprovacao_automatica, decidido_por_id: decisao?.por ?? null, decidido_em: decisao?.em ?? null,
      motivo_rejeicao: decisao?.motivo ?? null, created_at: criado, ...comuns,
    });
    historico.forEach((h, i) => {
      // marco do ERP: sem usuário (autor "ERP"), como o consumidor do retorno grava
      const autor = h.autor === 'erp' ? { id: null, ...AUTOR_ERP_DEMO } : { id: u(h.autor), nome: USUARIOS_DEMO[h.autor].nome, perfil: USUARIOS_DEMO[h.autor].perfil };
      eventos.push({
        id: id(`pedido_evento:${chave}:${i + 1}`), tenant_id: T, pedido_id, de: h.de, para: h.para, autor_id: autor.id, autor_nome: autor.nome,
        autor_perfil: autor.perfil, motivo: h.motivo, nivel: h.nivel, acima_do_nivel: false, ocorrido_em: h.em, created_at: h.em, ...comuns,
      });
    });
    visitas.push(visita(chave, quem, n, data, hora, 'pedido', { pedido_id }));
    if (VENDIDO_DEMO.has(status)) {
      const d = diario.get(`${quem}:${atras}`) ?? { chave: `${quem}:${atras}`, usuario: quem, data, pedidos: 0, vendido: 0, cancelado: 0 };
      d.pedidos += 1;
      d.vendido += r.total_cents;
      if (status === 'cancelled') d.cancelado += r.total_cents;
      diario.set(d.chave, d);
    }
  });
  // número legível pela ordem de chegada (o mais antigo é 000001); o contador do tenant fica no maior
  [...pedidos]
    .sort((x, y) => String(x.recebido_em).localeCompare(String(y.recebido_em)) || String(x.id).localeCompare(String(y.id)))
    .forEach((pd, i) => {
      pd.numero = String(i + 1).padStart(6, '0');
    });
  for (const [chave, quem, n, atras, resultado, motivo] of VISITAS_SEM_PEDIDO) {
    const data = diasUteisAtras(hoje, atras);
    visitas.push(visita(chave, quem, n, data, '15:20', resultado, motivo ? { motivo_id: idMotivoPadrao(T, motivo) } : {}));
  }

  const indicadores: Linha[] = [...diario.values()].map((d) => ({
    id: id(`indicador_diario:${d.chave}`), tenant_id: T, usuario_id: u(d.usuario), data: d.data, pedidos: d.pedidos,
    vendido_cents: d.vendido, cancelado_cents: d.cancelado, ...comuns,
  }));

  const meta = (quem: ChaveUsuario, mes: string, indicador: string, valor: number): Linha => ({
    id: id(`meta:${quem}:${mes}:${indicador}`), tenant_id: T, usuario_id: u(quem), periodo: mes, indicador, valor, tipo: TIPO_METAS_DEMO, ...comuns,
  });
  const metas: Linha[] = [
    ...METAS.map(([quem, indicador, valor]) => meta(quem, periodo, indicador, valor)),
    // T-0070: mês anterior de Lucas e Camila, para o "copiar do mês anterior" (T-0068)
    ...METAS_MES_ANTERIOR_DEMO.map(([quem, indicador, valor]) => meta(quem, anoMes(hoje, -1), indicador, valor)),
  ];

  const notificacao = (chave: string, quem: ChaveUsuario, extra: Partial<Linha>): Linha => ({
    id: id(`notificacao:${chave}`), tenant_id: T, usuario_id: u(quem), tipo: 'sistema', titulo: '', corpo: '', link: null, origem_modulo: 'core',
    origem_evento_id: null, envio_id: null, autor_id: null, prioridade: 'normal', lida_em: null, expira_em: null, push_enviado_em: null, ...comuns, ...extra,
  });
  const notificacoes: Linha[] = [
    notificacao('recado-vendedor', 'vendedor', {
      tipo: 'recado', titulo: 'Prioridade', corpo: 'Passe cedo no Mercadinho São Jorge: tem título vencido e o pedido de ontem aguarda aprovação.',
      link: '/m/rota', envio_id: id('notificacao-envio:recado-vendedor'), autor_id: u('supervisor'), prioridade: 'alta',
    }),
    notificacao('aprovacoes-supervisor', 'supervisor', {
      tipo: 'pedido', titulo: '2 pedidos aguardando aprovação', corpo: 'Lucas Andrade e Camila Freitas enviaram pedidos com desconto acima da alçada.',
      origem_modulo: 'vendedor',
    }),
    notificacao('aprovacoes-gerente', 'gerente', {
      tipo: 'pedido', titulo: '1 pedido aguardando sua aprovação', corpo: 'Camila Freitas enviou um pedido com 12% de desconto, acima da alçada do supervisor.',
      origem_modulo: 'vendedor',
    }),
  ];

  // ---- 0013: unidades, endereços, árvore, conteúdo, busca do servidor, estoque e frete
  const caixa = new Map(CAIXAS.map(([sku, fator]) => [sku, fator]));
  const idNo = (codigo: string) => id(`catalogo_no:${codigo}`);
  const nivelDe = (codigo: string): number => {
    const pai = ARVORE.find(([cod]) => cod === codigo)?.[2] ?? null;
    return pai === null ? 1 : 1 + nivelDe(pai);
  };
  const nomeDoNo = new Map(ARVORE.map(([cod, nome]) => [cod, nome]));
  // sem aplicação fora das autopeças escolhidas (T-0084): a descrição 2 sai no orçamento e no PDF, então só onde faz sentido
  const conteudoDe = (sku: string, nome: string, _categoria: string): [string, string | null, string, Array<{ pergunta: string; resposta: string }>] =>
    CONTEUDO[sku] ?? [`${nome}.`, null, 'Item de giro da distribuidora.', []];
  const atributosTexto = (sku: string) => (ATRIBUTOS[sku] ?? []).map(([nome, valor, , un]) => `${nome} ${valor}${un ? ` ${un}` : ''}`).join('; ');
  const dados0013 = {
    'core.produto_unidade': PRODUTOS.flatMap(([sku, , , , unidade]) => [
      { id: id(`produto_unidade:${sku}:${unidade}`), tenant_id: T, produto_id: id(`produto:${sku}`), unidade, fator: 1, ean: null, padrao: true, ativo: true, ...comuns },
      ...(caixa.has(sku)
        ? [{ id: id(`produto_unidade:${sku}:CX`), tenant_id: T, produto_id: id(`produto:${sku}`), unidade: 'CX', fator: caixa.get(sku)!, ean: null, padrao: false, ativo: true, ...comuns }]
        : []),
    ]),
    'core.cliente_endereco': CLIENTES.flatMap(([, , bairro, rua], n) => {
      const [latitude, longitude] = coordenada(n);
      const base = { tenant_id: T, cliente_id: c(n), complemento: null, cidade: 'Manaus', uf: 'AM', ativo: true, ...comuns };
      return [
        {
          ...base, id: idEnderecoDemo(n, 'principal'), tipo: 'principal', descricao: 'Principal', logradouro: rua, numero: numeroDemo(n), bairro,
          cep: n === CLIENTE_SEM_CEP_DEMO ? null : cepClienteDemo(n), latitude, longitude, principal: true,
        },
        ...((COM_ENTREGA as readonly number[]).includes(n)
          ? [{
              ...base, id: idEnderecoDemo(n, 'entrega'), tipo: 'entrega', descricao: 'Depósito', logradouro: 'Rua do Comércio', numero: String(1_000 + n), bairro: 'Distrito Industrial',
              cep: cepDemo(n + 40), latitude: null, longitude: null, principal: false,
            }]
          : []),
      ];
    }),
    'catalogo.catalogo_no': ARVORE.map(([codigo, nome, pai], i) => ({
      id: idNo(codigo), tenant_id: T, pai_id: pai ? idNo(pai) : null, nivel: nivelDe(codigo), codigo, nome, ordem: i + 1, ativo: true, ...comuns, external_id: codigo,
    })),
    'catalogo.produto_no': PRODUTOS.map(([sku]) => ({ id: id(`produto_no:${sku}`), tenant_id: T, produto_id: id(`produto:${sku}`), no_id: idNo(GRUPO[sku]!), ...comuns })),
    'catalogo.produto_relacao': RELACOES_DEMO.map(([sku, rel, tipo, ordem]) => ({
      id: id(`produto_relacao:${sku}:${rel}:${tipo}`), tenant_id: T, produto_id: id(`produto:${sku}`), relacionado_id: id(`produto:${rel}`), tipo, ordem, ativo: true, ...comuns,
    })),
    'catalogo.produto_conteudo': PRODUTOS.map(([sku, nome, , categoria]) => {
      const [descricao, aplicacoes, argumentos_venda, faq] = conteudoDe(sku, nome, categoria);
      return {
        id: id(`produto_conteudo:${sku}`), tenant_id: T, produto_id: id(`produto:${sku}`), descricao, aplicacoes, argumentos_venda, faq,
        campanha: EM_CAMPANHA.has(sku), destaque: EM_DESTAQUE.has(sku), ...comuns,
      };
    }),
    'catalogo.produto_atributo': Object.entries(ATRIBUTOS).flatMap(([sku, lista]) =>
      lista.map(([nome, valor, valor_num, unidade], i) => ({
        id: id(`produto_atributo:${sku}:${nome}`), tenant_id: T, produto_id: id(`produto:${sku}`), nome, valor, valor_num, unidade, ordem: i + 1, ...comuns,
      })),
    ),
    'catalogo.sinonimo': SINONIMOS.map(([termo, lista]) => ({ id: id(`sinonimo:${termo}`), tenant_id: T, termo, sinonimos: arrayDeTexto(lista), ativo: true, ...comuns })),
    'catalogo.produto_busca': PRODUTOS.map(([sku, nome, marca, categoria]) => {
      // 0033 (T-0084 §6): o conteúdo (peso D) não leva mais a aplicação, que vai em produto_busca.aplicacao (peso C,
      // expandida; gravada por catalogo-cadastro.ts quando a 0033 está aplicada)
      const [descricao, , argumentos] = conteudoDe(sku, nome, categoria);
      const grupo = GRUPO[sku]!;
      return {
        id: id(`produto_busca:${sku}`), tenant_id: T, produto_id: id(`produto:${sku}`), sku, ean: null, nome, marca, categoria: `${categoria} ${nomeDoNo.get(grupo)}`,
        atributos: atributosTexto(sku) || null, conteudo: [descricao, argumentos].join(' '), ativo: true, ...comuns,
      };
    }),
    'catalogo.deposito': DEPOSITOS.map(([codigo, nome]) => ({ id: id(`deposito:${codigo}`), tenant_id: T, codigo, nome, ativo: true, ...comuns, external_id: codigo })),
    'catalogo.estoque_saldo': PRODUTOS.flatMap(([sku], i) =>
      DEPOSITOS.map(([codigo], d) => ({
        id: id(`estoque_saldo:${codigo}:${sku}`), tenant_id: T, deposito_id: id(`deposito:${codigo}`), produto_id: id(`produto:${sku}`), quantidade: saldoDemo(i, d),
        atualizado_erp_em: emManaus(hoje, '06:00'), ...comuns,
      })),
    ),
    'vendedor.transportadora': TRANSPORTADORAS.map(([chave, nome, telefone], i) => ({
      id: idTransportadoraDemo(chave), tenant_id: T, nome, documento: cnpjDemo(900 + i), inscricao_estadual: ieDemo(900 + i), telefone, ativo: true, ...comuns,
    })),
  } satisfies Partial<DadosDemo>;

  return {
    'plataforma.tenant': [
      { id: T, codigo: CODIGO_DEMO, nome: 'Distribuidora Exemplo', documento: null, fuso: FUSO_DEMO, plano: 'demonstracao', status: 'ativo', deleted_at: null, external_id: null },
    ],
    'plataforma.tenant_modulo': MODULOS_DEMO.map((modulo) => ({
      id: id(`tenant_modulo:${modulo}`), tenant_id: T, modulo, ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns,
    })),
    'plataforma.perfil_modulo': Object.entries(PERFIL_MODULOS).flatMap(([perfil, modulos]) =>
      modulos.map((modulo) => ({ id: id(`perfil_modulo:${perfil}:${modulo}`), tenant_id: T, perfil, modulo, ...comuns })),
    ),
    // alçadas do Vendedor (jsonb); id como o dos parâmetros semeados pelo banco (uuid_de_chave)
    // 0013: frete (frete.modalidade_padrao = CIF), campos obrigatórios do cliente e desconto máximo do produto (15%) ficam
    // SEM linha: ausente = padrão do doc 03 (pedido R-20261102-100400, item d)
    'plataforma.parametro': Object.entries(ALCADAS_DEMO).map(([chave, valor]) => ({
      id: idDeChave(`${T}:plataforma.parametro:vendedor:${chave}`), tenant_id: T, modulo: 'vendedor', chave, valor: JSON.stringify(valor), ...comuns,
    })),
    // a Regional Norte (gerente) antes da Equipe Manaus (FK do pai)
    'core.equipe': [
      { id: regionalId, tenant_id: T, nome: 'Regional Norte', equipe_pai_id: null, responsavel_id: u('gerente'), ativo: true, ...comuns },
      { id: equipeId, tenant_id: T, nome: 'Equipe Manaus', equipe_pai_id: regionalId, responsavel_id: u('supervisor'), ativo: true, ...comuns },
    ],
    'core.usuario': usuarios,
    'core.produto': PRODUTOS.map(([sku, nome, marca, categoria, unidade, preco], i) => ({
      id: id(`produto:${sku}`), tenant_id: T, sku, ean: null, nome, marca, categoria, unidade, ativo: true, deleted_at: null, external_id: sku,
      // 0013 (RN-CORE-18): preço de venda = Varejo; custo pela margem de 20% a 40%; desconto máximo próprio em 3 produtos
      preco_venda_cents: preco, custo_cents: Math.round(preco * (1 - margemDemo(i) / 100)), desconto_maximo_pct: DESCONTO_MAXIMO_PROPRIO_DEMO[sku] ?? null,
    })),
    'core.cliente': clientes,
    'core.carteira': carteira,
    'core.cliente_contato': contatos,
    'core.cliente_financeiro': financeiros,
    'core.titulo': titulos,
    'core.historico_compra': historico,
    'core.motivo': motivos,
    'core.rota': rotas,
    'core.rota_parada': paradas,
    'core.visita': visitas,
    'core.meta': metas,
    'core.indicador_diario': indicadores,
    'core.notificacao': notificacoes,
    'catalogo.tabela_preco': tabelasPreco,
    'catalogo.tabela_preco_item': itensTabela,
    'catalogo.cliente_tabela_preco': clienteTabela,
    'vendedor.condicao_pagamento': condicoes,
    'vendedor.cliente_condicao': clienteCondicoes,
    // mesmo id que vendedor.proximo_numero_pedido() criaria; a carga nunca baixa o contador (ver carregarDemo)
    'vendedor.numeracao_pedido': [{ id: idDeChave(`${T}:vendedor.numeracao_pedido`), tenant_id: T, ultimo: pedidos.length, ...comuns }],
    ...dados0013,
    'vendedor.pedido': pedidos,
    'vendedor.pedido_item': itens,
    'vendedor.pedido_evento': eventos,
    'vendedor.pedido_faturamento': faturamentos,
    'vendedor.pedido_devolucao': devolucoes,
  };
}

/** Item do pedido para o faturamento da demo (sequência 1..n, quantidade na unidade base: a demo só vende fator 1). */
export interface ItemParaFaturarDemo {
  sequencia: number;
  sku: string;
  product_id: string;
  quantity: number;
  total_cents: number;
}

/**
 * T-0155: o que o consumidor do retorno do ERP do Vendedor gravaria para um pedido aprovado da demo (função pura). Retornos, na
 * ordem do Hub (pendente → enviado → integrado → faturado; o Hub não aceita enviado → faturado): `enviado` e `integrado`
 * (status e linha do tempo) e o faturado (status, nota em pedido_faturamento, saldo por item e resumo), pelas funções do
 * domain do Vendedor; a devolução pela `decidirNotaDevolucao` (RN-VEN-37: não muda o status). Erro = o seed não sobe.
 */
export function faturarPedidoDemo(
  chave: string,
  pedidoId: string,
  f: FaturamentoDemo,
  em: { enviado: string; integrado: string; faturado: string; devolvido: string },
  itensPedido: readonly ItemParaFaturarDemo[],
) {
  const linhaDoTempo: Array<{ de: OrderStatus; para: OrderStatus; motivo: string; em: string }> = [];
  let status = 'approved' as OrderStatus;
  const aplicar = (retorno: Parameters<typeof planejarRetornoErp>[1]) => {
    const p = planejarRetornoErp(status, retorno);
    if (p.acao !== 'aplicar') throw new Error(`[db] seed demo: retorno ${retorno.status} do ${chave} ignorado pelo Vendedor (${p.motivo})`);
    linhaDoTempo.push({ de: p.de, para: p.para, motivo: p.texto_historico, em: retorno.ocorrido_em });
    status = p.para;
    return p;
  };
  aplicar({ status: 'enviado', numero_erp: null, motivo: null, ocorrido_em: em.enviado });
  aplicar({ status: 'integrado', numero_erp: f.numero_erp, motivo: null, ocorrido_em: em.integrado });
  const statusErp = f.parcial ? 'faturado_parcial' : 'faturado_total';
  // o ERP informa por sequência a quantidade e o valor faturados (valor = proporção do total do item)
  const doRetorno = itensPedido
    .map((i) => {
      const q = f.parcial?.[i.sku] ?? i.quantity;
      return { sequencia: i.sequencia, quantidade: q, valor_cents: Math.round((i.total_cents * q) / i.quantity) };
    })
    .filter((i) => i.quantidade > 0);
  for (const sku of Object.keys(f.parcial ?? {})) if (!itensPedido.some((i) => i.sku === sku)) throw new Error(`[db] seed demo: ${chave} não tem o item ${sku} do faturamento parcial`);
  const faturou = aplicar({ status: statusErp, numero_erp: f.numero_erp, motivo: null, ocorrido_em: em.faturado, itens_faturados: doRetorno });
  if (!faturou.faturar) throw new Error(`[db] seed demo: o retorno faturado do ${chave} não fatura`);
  const { itens, divergencias } = itensDoFaturamento(statusErp, doRetorno, itensPedido.map((i) => ({ sequencia: i.sequencia, product_id: i.product_id, quantity: i.quantity })), []);
  if (divergencias.length > 0) throw new Error(`[db] seed demo: faturamento do ${chave} divergente do pedido (${divergencias.map((x) => x.codigo).join(', ')})`);
  const notaTotal = itens.reduce((s, i) => s + (i.valor_cents ?? 0), 0);
  const faturamento: Linha = {
    id: id(`pedido_faturamento:${chave}:1`), tenant_id: T, pedido_id: pedidoId,
    // no servidor, o id do evento integracao.pedido.retorno_erp@1 consumido (idempotência); aqui, determinístico
    evento_id: id(`pedido_faturamento:evento:${chave}:1`), parcial: statusErp === 'faturado_parcial', numero_erp: faturou.numero_erp,
    nota_numero: f.nota.numero, nota_serie: f.nota.serie, nota_emitida_em: em.faturado, nota_total_cents: notaTotal,
    itens: itens.map((i) => ({ sequencia: i.sequencia, produto_id: i.product_id, quantidade: i.quantity, total_cents: i.valor_cents })),
    faturado_em: em.faturado, ...comuns,
  };
  let devolucao: Linha | null = null;
  if (f.devolucao) {
    const dv = f.devolucao;
    const item = itensPedido.find((i) => i.sku === dv.sku);
    if (!item || dv.quantidade <= 0 || dv.quantidade >= item.quantity) throw new Error(`[db] seed demo: devolução do ${chave} precisa ser parcial de um item do pedido`);
    const d = decidirNotaDevolucao({
      acao: 'atualizado', external_id: dv.nota.external_id,
      registro: { tipo: 'devolucao', pedido_uuid: pedidoId, numero: dv.nota.numero, serie: dv.nota.serie, emitida_em: em.devolvido, total_cents: Math.round((item.total_cents * dv.quantidade) / item.quantity) },
    });
    if (d.tipo !== 'gravar') throw new Error(`[db] seed demo: a nota de devolução do ${chave} não seria gravada`);
    devolucao = {
      id: id(`pedido_devolucao:${chave}:1`), tenant_id: T, pedido_id: d.pedido_id, nota_numero: d.numero, nota_serie: d.serie, emitida_em: d.emitida_em,
      total_cents: d.total_cents, deleted_at: null, external_id: d.external_id,
    };
  }
  const resumo = resumoFaturamento(
    itensPedido.map((i) => ({ sequencia: i.sequencia, quantity: i.quantity, total_cents: i.total_cents })),
    [{ nota_numero: f.nota.numero, nota_total_cents: notaTotal, faturado_em: em.faturado, itens: itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantity, valor_cents: i.valor_cents })) }],
    devolucao ? [{ total_cents: Number(devolucao.total_cents) }] : [],
  );
  return { status, numero_erp: faturou.numero_erp, enviado_em: em.enviado, integrado_em: em.integrado, linhaDoTempo, faturamento, devolucao, resumo };
}

/** Trava de isolamento: toda linha montada é do tenant demo (o seed nunca grava em outro tenant). */
export function conferirSoTenantDemo(dados: DadosDemo): void {
  for (const tabela of ORDEM_DEMO) {
    for (const l of dados[tabela]) {
      const dono = tabela === 'plataforma.tenant' ? l.id : l.tenant_id;
      if (dono !== T) throw new Error(`[db] seed demo: linha de ${tabela} fora do tenant demo`);
    }
  }
}

/**
 * Apaga todas as linhas do tenant demo (só dele), na transação aberta, pela plataforma.excluir_tenant (0032, B2 do DBaaS,
 * T-0075): DELETE em ordem de FK calculada no catálogo, sem session_replication_role (que exige superusuário) e com os
 * gatilhos ligados. Marca o tenant como 'encerrado' antes (trava da função); a carga logo depois grava o tenant de novo,
 * ativo. Sem superusuário, o admin enxerga as linhas pela política manutencao (0031, B1). Tenant ausente: nada a apagar.
 */
async function apagarTenantDemo(admin: ClientBase): Promise<void> {
  const funcao = await admin.query<{ ok: boolean }>("select to_regprocedure('plataforma.excluir_tenant(uuid,text)') is not null as ok");
  if (!funcao.rows[0]?.ok) throw new Error('[db] seed demo --recriar precisa da plataforma.excluir_tenant (migração 0024+): rode "banco migrar up" antes.');
  const atual = await admin.query<{ codigo: string }>("update plataforma.tenant set status = 'encerrado' where id = $1 returning codigo", [T]);
  const codigo = atual.rows[0]?.codigo;
  if (codigo === undefined) return;
  await admin.query('select count(*) from plataforma.excluir_tenant($1, $2)', [T, codigo]);
}

/**
 * 0022 (T-0079): troca plataforma.tenant.geracao_base do tenant (plataforma.girar_geracao_base). Banco anterior à 0022
 * (sem a função) não tem o marcador: nada a girar. Exige superusuário ou a política manutencao (0031; FORCE RLS no tenant): girar 0 linhas é erro.
 */
export async function girarGeracaoBase(admin: ClientBase, tenantId: string): Promise<void> {
  const existe = await admin.query<{ ok: boolean }>("select to_regprocedure('plataforma.girar_geracao_base(uuid)') is not null as ok");
  if (!existe.rows[0]?.ok) return;
  const r = await admin.query<{ n: number }>('select plataforma.girar_geracao_base($1) as n', [tenantId]);
  if (Number(r.rows[0]?.n) !== 1) throw new Error(`[db] seed demo: a geração da base do tenant ${tenantId} não girou (precisa de superusuário ou da política manutencao da 0031)`);
}

/** Número legível do pedido no formato do contador (lpad 6, como vendedor.proximo_numero_pedido()). */
const formatarNumeroPedido = (n: number) => String(n).padStart(6, '0');
/** Valor numérico do número legível (texto só de dígitos); outro formato (ex.: vindo de fora) não conta para o teto. */
const valorDoNumero = (numero: string | null | undefined): number | null => (numero && /^\d+$/.test(numero) ? Number(numero) : null);

/** Número que mudou na carga (só id e números: sem dado pessoal no log). */
export interface NumeroTrocado {
  id: string;
  de: string | null;
  para: string;
  /** 'seed': pedido fictício da base; 'aparelho': pedido de verdade (feito no ensaio) que estava repetido. */
  origem: 'seed' | 'aparelho';
}

export interface EntradaNumeracaoDemo {
  /** Pedidos do seed na ordem da base nova; `numero` é o da base nova (000001… pela ordem de chegada). */
  seed: ReadonlyArray<{ id: string; numero: string }>;
  /** Número que cada pedido do seed tinha no banco antes da carga (lido antes do --recriar apagar). */
  antes: ReadonlyMap<string, string>;
  /** Pedidos do tenant que ficam no banco fora do seed (feitos no ensaio; vazio depois do --recriar). */
  deVerdade: ReadonlyArray<{ id: string; numero: string | null; recebido_em: string | null }>;
  /** Maior número já emitido no tenant antes da carga: max(contador, maior número gravado), lido antes do --recriar. */
  teto: number;
}

export interface NumeracaoDemo {
  /** Número final de cada pedido do seed. */
  seed: Map<string, string>;
  /** Pedidos de verdade com número repetido (só sem o único pedido_numero_uk): o mais antigo fica, os outros ganham número novo. */
  renumerar: NumeroTrocado[];
  /** Pedidos do seed cujo número muda em relação ao banco (pedido novo do seed fica fora: não tinha número). */
  trocadosNoSeed: NumeroTrocado[];
  /** Contador do tenant depois da carga: nunca abaixo do teto nem de um número atribuído. */
  ultimo: number;
}

/**
 * T-0026 (R-20261104-163228, 000011 em dois pedidos): numeração dos pedidos do seed sem reusar número já emitido.
 * Regras, nesta ordem:
 * 1. Pedido de verdade (fora do seed) nunca perde o número que o aparelho já mostra. Repetido (só se o único faltar):
 *    o mais antigo (recebido_em, id) fica e os outros ganham número novo do contador.
 * 2. Pedido do seed que já tinha número (no banco ou antes do --recriar) guarda o número: recarga não renumera.
 * 3. Pedido do seed sem número (base nova, ou pedido que entrou no seed depois) usa o da base nova se ele estiver acima
 *    do teto (nunca emitido) e livre; senão ganha o próximo do contador. Em base nova (teto 0) fica 000001…
 * Pura e determinística: rodar de novo com o resultado aplicado não muda nada (idempotente).
 */
export function numerarPedidosDemo(e: EntradaNumeracaoDemo): NumeracaoDemo {
  let maior = Math.max(0, Math.trunc(e.teto));
  const usados = new Set<string>();
  const ocupar = (numero: string) => {
    usados.add(numero);
    const v = valorDoNumero(numero);
    if (v !== null && v > maior) maior = v;
  };
  const idsSeed = new Set(e.seed.map((s) => s.id));
  const repetidos: Array<{ id: string; numero: string }> = [];
  const deVerdade = e.deVerdade
    .filter((p) => !idsSeed.has(p.id) && p.numero !== null)
    .sort((a, b) => String(a.recebido_em ?? '').localeCompare(String(b.recebido_em ?? '')) || a.id.localeCompare(b.id));
  for (const p of deVerdade) {
    if (usados.has(p.numero!)) repetidos.push({ id: p.id, numero: p.numero! });
    else ocupar(p.numero!);
  }
  const final = new Map<string, string>();
  for (const s of e.seed) {
    const m = e.antes.get(s.id);
    if (m && !usados.has(m)) {
      final.set(s.id, m);
      ocupar(m);
    }
  }
  const novos = e.seed.filter((s) => !final.has(s.id));
  for (const s of novos) {
    const v = valorDoNumero(s.numero);
    if (v !== null && v > e.teto && !usados.has(s.numero)) {
      final.set(s.id, s.numero);
      ocupar(s.numero);
    }
  }
  const emitir = () => {
    let n = maior + 1;
    while (usados.has(formatarNumeroPedido(n))) n += 1;
    const numero = formatarNumeroPedido(n);
    ocupar(numero);
    return numero;
  };
  for (const s of e.seed) if (!final.has(s.id)) final.set(s.id, emitir());
  const renumerar = repetidos.map((r): NumeroTrocado => ({ id: r.id, de: r.numero, para: emitir(), origem: 'aparelho' }));
  const trocadosNoSeed = e.seed
    .filter((s) => e.antes.has(s.id) && e.antes.get(s.id) !== final.get(s.id))
    .map((s): NumeroTrocado => ({ id: s.id, de: e.antes.get(s.id)!, para: final.get(s.id)!, origem: 'seed' }));
  return { seed: final, renumerar, trocadosNoSeed, ultimo: maior };
}

export interface ResultadoDemo {
  tenantId: string;
  codigo: string;
  hoje: string;
  logins: Array<{ email: string; perfil: string; nome: string }>;
  dados: DadosDemo;
  /** T-0026: números que a carga trocou (pedido do seed ou repetido de verdade); vazio na recarga comum. */
  numerosTrocados: NumeroTrocado[];
}

/**
 * Carrega a base de demo com cliente ADMIN, numa transação. Rodar 2× não duplica. A senha só é trocada se a atual
 * não conferir com a informada (assim rodar de novo não muda o hash à toa). Contadores de login errado e bloqueio são
 * zerados a cada carga (a demo não trava por senha digitada errado no ensaio).
 */
export async function carregarDemo(admin: ClientBase, opcoes: { senha?: string; recriar?: boolean } & OpcoesDemo = {}): Promise<ResultadoDemo> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed da base de demonstração');
  const senha = opcoes.senha ?? process.env.MACUXI_SENHA_DEMO ?? SENHA_DEMO_PADRAO;
  const faltando = (await admin.query<{ t: string }>("select t from unnest($1::text[]) t where to_regclass(t) is null", [[...ORDEM_DEMO]])).rows;
  if (faltando.length > 0) {
    throw new Error(`[db] base de demo precisa das migrações até a ${MIGRACAO_MINIMA} (falta ${faltando[0]!.t}): rode "banco migrar up" antes.`);
  }
  const metaTipo = await admin.query("select 1 from information_schema.columns where table_schema = 'core' and table_name = 'meta' and column_name = 'tipo'");
  if (metaTipo.rowCount === 0) throw new Error(`[db] base de demo precisa das migrações até a ${MIGRACAO_MINIMA} (falta core.meta.tipo): rode "banco migrar up" antes.`);
  const trocarSenha = await admin.query("select 1 from information_schema.columns where table_schema = 'core' and table_name = 'usuario' and column_name = 'trocar_senha'");
  if (trocarSenha.rowCount === 0) throw new Error('[db] base de demo precisa das migrações até a 0040_core_senha_email_saida (falta core.usuario.trocar_senha): rode "banco migrar up" antes.');
  await admin.query('begin');
  try {
    // T-0026 (R-20261104-163228): o --recriar apaga o tenant, mas o número legível já saiu para os aparelhos (e para o ERP);
    // o contador nunca volta atrás, nem no --recriar: um pedido novo depois da recriação não repete um número já emitido.
    // A linha do contador fica travada até o commit: o receber da API (proximo_numero_pedido) espera a carga terminar.
    const ultimoAntes = Number(
      (await admin.query<{ ultimo: string | number }>('select ultimo from vendedor.numeracao_pedido where tenant_id = $1 for update', [T])).rows[0]?.ultimo ?? 0,
    );
    // números de antes da carga (e do --recriar): o do seed fica com o pedido; o teto é o maior já emitido no tenant
    const numerosAntes = (
      await admin.query<{ id: string; numero: string }>('select id::text as id, numero from vendedor.pedido where tenant_id = $1 and numero is not null', [T])
    ).rows;
    const teto = numerosAntes.reduce((m, r) => Math.max(m, valorDoNumero(r.numero) ?? 0), ultimoAntes);
    if (opcoes.recriar) await apagarTenantDemo(admin);
    const atuais = await admin.query<{ id: string; senha_hash: string | null }>('select id, senha_hash from core.usuario where tenant_id = $1', [T]);
    const hashAtual = new Map(atuais.rows.map((r) => [r.id, r.senha_hash]));
    const hashDe = (k: ChaveUsuario) => {
      const h = hashAtual.get(idUsuarioDemo(k));
      return h && verificarSenha(senha, h) ? h : hashSenha(senha);
    };
    const dados = dadosDemo(hashDe, { hoje: opcoes.hoje });
    conferirSoTenantDemo(dados);
    // T-0026: número já emitido (a um aparelho ou a um pedido do seed) não volta nem muda de dono (numerarPedidosDemo)
    const pedidosSeed = dados['vendedor.pedido'];
    const idsSeed = new Set(pedidosSeed.map((p) => String(p.id)));
    // inclui os excluídos (deleted_at): contam para o teto. Com o único pedido_numero_uk sem filtro de deleted_at não há
    // efeito; se ele virar parcial (deleted_at is null), o "mais antigo fica" pode renumerar o vivo e deixar o excluído
    const ficam = (
      await admin.query<{ id: string; numero: string | null; recebido_em: string | null }>(
        "select id::text as id, numero, to_char(recebido_em at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as recebido_em from vendedor.pedido where tenant_id = $1",
        [T],
      )
    ).rows.filter((r) => !idsSeed.has(r.id));
    const numeracao = numerarPedidosDemo({
      seed: pedidosSeed.map((p) => ({ id: String(p.id), numero: String(p.numero) })),
      antes: new Map(numerosAntes.filter((r) => idsSeed.has(r.id)).map((r) => [r.id, r.numero])),
      deVerdade: ficam,
      teto,
    });
    for (const p of pedidosSeed) p.numero = numeracao.seed.get(String(p.id))!;
    dados['vendedor.numeracao_pedido'][0]!.ultimo = numeracao.ultimo;
    for (const tabela of ORDEM_DEMO) {
      // equipe antes do responsável: grava sem responsavel_id e completa depois dos usuários
      let linhas: Linha[] = tabela === 'core.equipe' ? dados[tabela].map((e) => ({ ...e, responsavel_id: null })) : dados[tabela];
      // metas: o ensaio pode ter gravado pela API (PUT /v1/core/metas, T-0068) uma meta viva com outro id no mesmo
      // (usuário, período, indicador) que o seed semeia (ex.: o mês anterior); o único meta_uk quebraria a recarga -Manter.
      // Fica a do ensaio (não apaga dado) e o seed pula a dele.
      if (tabela === 'core.meta') {
        const r = await admin.query<{ chave: string }>(
          `select usuario_id || '|' || periodo || '|' || indicador as chave from core.meta
            where tenant_id = $1 and deleted_at is null and id <> all($2::uuid[])`,
          [T, linhas.map((l) => l.id)],
        );
        const doEnsaio = new Set(r.rows.map((x) => x.chave));
        linhas = linhas.filter((l) => !doEnsaio.has(`${String(l.usuario_id)}|${String(l.periodo)}|${String(l.indicador)}`));
      }
      // diário: as datas andam com o "hoje" e o único (usuario_id, data) não é adiável — a linha que vai para a data
      // de outra ainda não movida violaria o único no meio do upsert. Apaga só as linhas do seed (por id) e regrava.
      if (tabela === 'core.indicador_diario') {
        await admin.query('delete from core.indicador_diario where tenant_id = $1 and id = any($2::uuid[])', [T, linhas.map((l) => l.id)]);
      }
      // unidade padrão: a de um produto da base pode ter mudado (PAP-4 PC→UN, 02/11) ou o ensaio pode ter trocado. Antes do
      // upsert, deixa de ser padrão toda unidade viva que o seed não marca como padrão; senão o único parcial
      // produto_unidade_padrao_uk (0013) quebra a recarga sem --recriar ("seed demo" do subir-demo -Manter).
      if (tabela === 'core.produto_unidade') {
        const padroes = linhas.filter((l) => l.padrao === true);
        await admin.query(
          `update core.produto_unidade set padrao = false
            where tenant_id = $1 and padrao and deleted_at is null and produto_id = any($2::uuid[]) and id <> all($3::uuid[])`,
          [T, padroes.map((l) => l.produto_id), padroes.map((l) => l.id)],
        );
      }
      // contador do número: nunca volta atrás (o ensaio pode já ter numerado pedidos com ele; o --recriar guarda o de antes)
      if (tabela === 'vendedor.numeracao_pedido') {
        const n = linhas[0]!;
        await admin.query(
          `insert into vendedor.numeracao_pedido as x (id, tenant_id, ultimo) values ($1, $2, $3)
           on conflict (tenant_id) do update set ultimo = greatest(x.ultimo, excluded.ultimo), deleted_at = null`,
          [n.id, T, Math.max(Number(n.ultimo), teto)],
        );
        continue;
      }
      if (tabela === 'vendedor.pedido') {
        // repetido de verdade (só sem o único pedido_numero_uk): o mais antigo fica; o gatilho anda o updated_at e o pull traz o novo
        for (const r of numeracao.renumerar) {
          await admin.query('update vendedor.pedido set numero = $3 where tenant_id = $1 and id = $2', [T, r.id, r.para]);
        }
        // pedido_numero_uk não é adiável: um número do seed que muda (só no conserto de repetido) é solto antes do upsert
        const trocam = numeracao.trocadosNoSeed.map((x) => x.id);
        if (trocam.length > 0) await admin.query('update vendedor.pedido set numero = null where tenant_id = $1 and id = any($2::uuid[])', [T, trocam]);
      }
      await gravarLinhas(admin, tabela, linhas);
      // 0018 (T-0063): medidas do tenant depois de plataforma.tenant (antes da FK do produto) e embalagens depois de core.produto
      await gravarDemoMedidas(admin, tabela, dados);
      if (tabela === 'core.usuario') await gravarLinhas(admin, 'core.equipe', dados['core.equipe']);
    }
    // 0033/0045 (T-0084/T-0085/T-0113): marcas concorrentes do Catálogo (ADR 0034), referências cruzadas, etiquetas e
    // aplicação/referências no documento de busca — ANTES do Promotor, que passa a ler as marcas do Catálogo
    await gravarDemoCatalogoCadastro(admin, { tenantId: T, hoje: dados['core.rota'][0]!.data as string, dados });
    // 0015 (T-0056): cadastros de trade e histórico da Joana (visitas de loja v-pr1/v-pr2), licença do Promotor
    await gravarDemoPromotor(admin, { hoje: dados['core.rota'][0]!.data as string });
    // 0016 (T-0057): questionários da Pesquisa (exposição do café e satisfação no checkout), 16 respostas, licença
    await gravarPesquisaDemo(admin, { hoje: dados['core.rota'][0]!.data as string });
    // 0017 (T-0058): licença do Treinamento (7 perfis), 3 trilhas, jornada de Lucas/Camila/Joana e desafio do mês
    await gravarTreinamentoDemo(admin, { hoje: dados['core.rota'][0]!.data as string });
    // 0028 (T-0082): plano de RV do vendedor vigente desde o mês do primeiro seed (plano-rv.ts; banco sem a 0028 = nada)
    await gravarDemoPlanoRv(admin, { tenantId: T, hoje: dados['core.rota'][0]!.data as string, atualizadoPor: idUsuarioDemo('analista') });
    // 0037 (T-0089): formas e prazos, prazo médio e formas do cliente, tabela escalonada; apaga a forma padrão da 0037 (pagamento.ts)
    await gravarDemoPagamento(admin, { tenantId: T, hoje: dados['core.rota'][0]!.data as string, dados });
    // 0056 (T-0149): filial padrão completada (Manaus) e o retrato dela nos pedidos; a Boa Vista (4 clientes, preço +5%, CD-BVB) só
    // com SEED_BOA_VISTA_DEMO ligada — desligada na v1.0.3, volta na v1.0.4 (R-20261110-111746; filial.ts)
    await gravarDemoFilial(admin, { tenantId: T, dados });
    // 0057 (T-0147): tipos de foto do PDV (Fachada, CNH do sócio, Contrato social) e a fachada de 5 clientes (fotos-pdv.ts)
    await gravarDemoFotosPdv(admin, { tenantId: T, hoje: dados['core.rota'][0]!.data as string, dados, usuario: idUsuarioDemo });
    // 0014 (T-0055): licença do Gestor (supervisor, gerente, analista, admin) e projeção montada pelo domain do Gestor
    await carregarDemoGestor(admin, dados);
    // T-0051 (R-20261102-125759-2): monitor da Integração ERP — licença (admin e analista), 2 Conectores, política, 5 lotes e a
    // inativação aguardando, relativos ao now() do banco, e (T-0155) a fila do ERP dos 3 pedidos faturados (integracao.ts)
    await gravarDemoIntegracao(admin, dados);
    // 0022 (T-0079): o --recriar apagou e regravou o tenant; gira a geração da base para o aparelho limpar a cópia local
    // (a linha nova já nasce com outro valor; a chamada deixa a regra explícita). Recarga sem --recriar não gira.
    if (opcoes.recriar) await girarGeracaoBase(admin, T);
    await admin.query('commit');
    const usuarios = dados['core.usuario'];
    return {
      tenantId: T,
      codigo: CODIGO_DEMO,
      hoje: dados['core.rota'][0]!.data as string,
      logins: usuarios.map((x) => ({ email: String(x.email), perfil: String(x.perfil), nome: String(x.nome) })),
      dados,
      numerosTrocados: [...numeracao.renumerar, ...numeracao.trocadosNoSeed],
    };
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
