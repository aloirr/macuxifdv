/**
 * Base de DEMONSTRAÇÃO (dono: banco-dados) — demonstração com o gestor externo usando o app novo com a API real
 * (pedido do Alexandre R-20261031-233442, item 1). Diferente do seed da Fase M (que imita o mockup), esta base é
 * montada para o roteiro da demo: um tenant fictício pequeno e coerente, com tudo o que o app Campo e o Gestão mostram.
 *
 * - Tenant "Distribuidora Exemplo", código da empresa `demo`, fuso America/Manaus; módulos core, catálogo, vendedor e
 *   promotor (licença do tenant + módulos por perfil).
 * - Usuários (e-mails @exemplo.com.br): vendedor, vendedor2, supervisor, gerente, promotor, analista e admin. Senha de
 *   todos = MACUXI_SENHA_DEMO (padrão "demo-macuxi"), gravada só como hash argon2id; nunca é impressa.
 *   Equipes: "Regional Norte" (gerente) é pai da "Equipe Manaus" (supervisora): o gerente vê a equipe (RN-CORE-04).
 * - 30 clientes de Manaus (endereço, bairro, coordenadas), contato principal com telefone fictício, financeiro e
 *   títulos (8 com título vencido, 1 bloqueado), 12 meses de histórico, pedidos em vários estados e visitas passadas.
 * - T-0029 (fatia do pedido): tabelas de preço "Varejo" (todos os produtos) e "Atacado" (~7% menor, SEM 3 produtos:
 *   "Sem preço para este cliente", RN-CAT-06), uma por cliente (supermercado e atacarejo no Atacado), vigência desde o
 *   1º dia do mês anterior; condições À vista (padrão), 28 dias, 28/56 e 30/60/90 (cliente com título vencido só À vista
 *   e 28 dias, RN-VEN-14); alçadas do Vendedor em plataforma.parametro (5/10/15%, acima do gerente = analista); pedidos
 *   recalculados pela tabela do cliente com a MESMA regra do servidor (revalidarPedido do domínio do Vendedor), com
 *   número, retratos e linha do tempo: aprovados na alçada, 2 aguardando o supervisor (um de cada vendedor), 1 aguardando
 *   o gerente, 1 rejeitado e 1 cancelado. Nada em sent_to_erp ou depois (ERP fora da fatia).
 * - 0013 (T-0047, T-0059, R-20261102-092329/093007/094644): todos os clientes com CNPJ FICTÍCIO gerado (dígito
 *   verificador correto) e IE (um "ISENTO"); o Atacado Boto Rosa SEM CEP (cadastro incompleto, RN-CORE-17: só orçamento);
 *   endereço principal de todos e um de entrega em 5; 2 transportadoras; pedidos FOB (com transportadora) em 4 clientes e CIF no resto;
 *   33 produtos (+ linha automotiva e detergente 5 L para a busca em linguagem natural: "óleo para moto 150
 *   cilindradas") com custo/preço de venda (margem 20–40%), 3 com desconto máximo próprio (padrão 15%), UN e CX com
 *   fator (preço próprio da CX preparado, desligado até a consulta de preço filtrar a unidade), árvore de 3 níveis, conteúdo, atributos, sinônimos, documento de busca
 *   do servidor e estoque em 2 depósitos (com rupturas e saldos baixos). Pedidos com CNPJ no retrato, frete e entrega.
 * - Rota de HOJE (no fuso do tenant, calculada na hora do seed): 6 paradas do vendedor, 4 da vendedor2 e 4 do promotor.
 * - Metas do mês corrente, indicador diário coerente com os pedidos, motivos extras (os padrões vêm do gatilho
 *   core.semear_tenant) e 2 notificações.
 *
 * Idempotente: upsert por id determinístico (`idDeterministico('demo:<chave>')`). Rodar de novo no mesmo dia não
 * duplica nada; em outro dia cria a rota do novo dia (as anteriores ficam como histórico) e move as datas relativas.
 * `recriar: true` apaga TODAS as linhas do tenant demo (inclusive o que o app gravou no ensaio) e carrega do zero.
 * Só roda contra o Postgres local (exigirBancoLocal), como o seed da Fase M. Nunca toca linha de outro tenant.
 */
import type { ClientBase } from 'pg';
import { politicaDosParametros, revalidarPedido } from '../../../modules/vendedor/domain/aprovacao';
import type { OrderStatus } from '../../../modules/vendedor/domain/order';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { anoMes, hojeNoFuso, instante, menorData, somarDias } from '../../src/datas';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeChave, idDeterministico, idMotivoPadrao, type CodigoMotivoPadrao } from '../../src/ids';
import { hashSenha, verificarSenha } from '../../src/senha';

export const TENANT_DEMO = 'dd000000-0000-4000-8000-000000000001';
export const CODIGO_DEMO = 'demo';
export const FUSO_DEMO = 'America/Manaus';
export const SENHA_DEMO_PADRAO = 'demo-macuxi';
export const MODULOS_DEMO = ['core', 'catalogo', 'vendedor', 'promotor'] as const;
/** Última migração de que a base depende (T-0029 + 0013: conteúdo do Catálogo, unidades, endereços, frete e cadastro mínimo). */
const MIGRACAO_MINIMA = '0013_catalogo_vendedor_prevenda';

const T = TENANT_DEMO;
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

// ---------------------------------------------------------------------------------------------------------------
// Usuários
type ChaveUsuario = 'vendedor' | 'vendedor2' | 'supervisor' | 'gerente' | 'promotor' | 'analista' | 'admin';
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
  ['ACU-1K', 'Açúcar cristal 1 kg', 'Doce Vale', 'Mercearia', 'UN', 479],
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
  ['PAP-4', 'Papel higiênico folha dupla 4 rolos', 'Macio', 'Higiene', 'PC', 849],
  ['SBN-90', 'Sabonete 90 g', 'Flor da Mata', 'Higiene', 'UN', 249],
  ['CRD-90', 'Creme dental 90 g', 'Sorriso', 'Higiene', 'UN', 459],
  // 0013 (T-0047): linha automotiva e o detergente de 5 L, para a busca em linguagem natural ("óleo para moto 150
  // cilindradas", "detergente neutro 5 litros com estoque") ter o que achar no ensaio
  ['DET-5L', 'Detergente líquido neutro 5 L', 'Brilho', 'Limpeza', 'UN', 1_590],
  ['OLE-4T-1L', 'Óleo para motor 4T 20W50 1 L (motos 125 a 160 cc)', 'Motorvia', 'Automotivo', 'UN', 3_290],
  ['OLE-4T-SEMI', 'Óleo semissintético 4T 10W40 1 L para motos', 'Motorvia', 'Automotivo', 'UN', 3_890],
  ['OLE-5W30', 'Óleo sintético 5W30 1 L para carros flex', 'Lubrion', 'Automotivo', 'UN', 4_590],
  ['FLU-DOT4', 'Fluido de freio DOT 4 500 ml', 'Freiomax', 'Automotivo', 'UN', 2_490],
  ['ADI-RAD', 'Aditivo para radiador concentrado 1 L', 'Lubrion', 'Automotivo', 'UN', 1_890],
  ['VEL-150', 'Vela de ignição para moto 150 cc', 'Faísca', 'Automotivo', 'UN', 1_590],
  ['CAM-18', 'Câmara de ar aro 18 para moto', 'Rodaforte', 'Automotivo', 'UN', 2_990],
  ['LAM-H4', 'Lâmpada de farol H4 12 V 60/55 W', 'Luzmax', 'Automotivo', 'UN', 2_190],
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

/** Liga as linhas de preço próprio da CX na tabela Varejo (ver o comentário no uso). */
export const PRECO_PROPRIO_CX_LIGADO = false;
/** Caixas de embarque (RN-VEN-15): [sku, fator, preço próprio da CX no Varejo em % do preço da UN × fator (ou null)]. */
const CAIXAS: Array<[string, number, number | null]> = [
  ['CAF-500', 10, null], ['ARR-5K', 6, null], ['FEI-1K', 10, null], ['OLE-900', 20, 0.96], ['LEI-1L', 12, 0.95], ['DET-500', 24, null],
  ['BIS-140', 24, null], ['OLE-4T-1L', 12, 0.94], ['DET-5L', 4, null],
];

/** Árvore do catálogo (3 níveis: Categoria › Família › Grupo): [código, nome, código do pai]. */
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
];
/** Grupo (folha da árvore) de cada produto. */
const GRUPO: Record<string, string> = {
  'ARR-5K': 'ALI-MER-GRA', 'FEI-1K': 'ALI-MER-GRA', 'FAR-1K': 'ALI-MER-GRA', 'ACU-1K': 'ALI-MER-GRA', 'MAC-500': 'ALI-MER-MAS', 'MOL-340': 'ALI-MER-MAS',
  'OLE-900': 'ALI-MER-OLE', 'SAR-125': 'ALI-MER-OLE', 'CAF-500': 'ALI-MER-CAF', 'LEI-1L': 'ALI-LAT-LEI', 'MAR-500': 'ALI-LAT-LEI', 'BIS-400': 'ALI-BIS-SAL',
  'BIS-140': 'ALI-BIS-DOC', 'ACA-1K': 'ALI-CON-POL', 'REF-2L': 'BEB-REF-GUA', 'REF-350': 'BEB-REF-GUA', 'AGU-500': 'BEB-AGS-AGU', 'SUC-1L': 'BEB-AGS-SUC',
  'DET-500': 'LIH-LIM-LOU', 'DET-5L': 'LIH-LIM-LOU', 'SAB-1K': 'LIH-LIM-ROU', 'DES-2L': 'LIH-LIM-CAS', 'SBN-90': 'LIH-HIG-PES', 'CRD-90': 'LIH-HIG-PES',
  'PAP-4': 'LIH-HIG-PAP', 'OLE-4T-1L': 'AUT-LUB-MOT', 'OLE-4T-SEMI': 'AUT-LUB-MOT', 'OLE-5W30': 'AUT-LUB-CAR', 'FLU-DOT4': 'AUT-LUB-FLU',
  'ADI-RAD': 'AUT-LUB-FLU', 'VEL-150': 'AUT-PEC-MOT', 'CAM-18': 'AUT-PEC-MOT', 'LAM-H4': 'AUT-PEC-ILU',
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
  'DET-5L': [['Fragrância', 'neutro', null, null], ['Volume', '5', 5, 'L']],
  'DET-500': [['Fragrância', 'neutro', null, null], ['Volume', '500', 500, 'ml']],
  'OLE-900': [['Tipo', 'soja', null, null], ['Volume', '900', 900, 'ml']],
  'CAF-500': [['Torra', 'média', null, null], ['Peso', '500', 500, 'g']],
  'ARR-5K': [['Tipo', 'tipo 1', null, null], ['Peso', '5', 5, 'kg']],
  'REF-2L': [['Sabor', 'guaraná', null, null], ['Volume', '2', 2, 'L']],
  'SUC-1L': [['Sabor', 'cupuaçu', null, null], ['Volume', '1', 1, 'L']],
};

/** Conteúdo (ficha): sku -> [descrição, aplicações, argumentos de venda, FAQ]. Os demais ganham um texto padrão. */
const CONTEUDO: Record<string, [string, string, string, Array<{ pergunta: string; resposta: string }>]> = {
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
    'Motos de 150 a 300 cilindradas, inclusive com embreagem banhada a óleo.',
    'Troca mais espaçada que o mineral; protege na partida a frio.',
    [{ pergunta: 'Posso usar em moto 150?', resposta: 'Pode, se o manual permitir 10W40.' }],
  ],
  'OLE-5W30': ['Óleo sintético SAE 5W30 para motores de carros flex.', 'Carros flex e a gasolina, motores 1.0 a 2.0.', 'Economia de combustível; padrão das montadoras.', []],
  'FLU-DOT4': ['Fluido de freio DOT 4, 500 ml.', 'Carros e motos com freio a disco ou tambor que pedem DOT 3 ou DOT 4.', 'Ponto de ebulição alto: mais segurança na descida.', []],
  'ADI-RAD': ['Aditivo concentrado para o sistema de arrefecimento, 1 litro.', 'Carros e motos refrigerados a água; diluir conforme o rótulo.', 'Evita ferrugem e superaquecimento.', []],
  'VEL-150': ['Vela de ignição para motos de 150 cc.', 'Motos 150 cc das linhas mais vendidas.', 'Partida fácil e consumo menor.', []],
  'CAM-18': ['Câmara de ar para pneu de moto aro 18.', 'Roda traseira de motos 125 a 160 cc com aro 18.', 'Borracha reforçada; válvula reta.', []],
  'LAM-H4': ['Lâmpada halógena H4 12 V 60/55 W para farol.', 'Faróis de carros e motos com encaixe H4.', 'Luz alta e baixa na mesma lâmpada.', []],
  'DET-5L': ['Detergente líquido neutro em galão de 5 litros.', 'Cozinhas de restaurantes, padarias e lanchonetes; louça e bancadas.', 'Rende mais que o de 500 ml; preço por litro menor.', []],
  'CAF-500': ['Café torrado e moído, torra média, 500 g.', 'Coado e cafeteira.', 'Campeão de giro na mercearia.', []],
  'REF-2L': ['Refrigerante de guaraná, garrafa de 2 litros.', 'Mercadinhos, padarias e conveniências.', 'Marca regional com boa saída no fim de semana.', []],
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
  ['Mini Box Japiim', 'Mercadinho', 'Japiim', 'Rua Tucunaré', 'vendedor', false],
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

/** Cliente com cadastro incompleto (RN-CORE-16/17): Atacado Boto Rosa sem CEP — pedido dele só como orçamento. */
export const CLIENTE_SEM_CEP_DEMO = 27;
/** Cliente com IE "ISENTO" (Panificadora Pão Dourado). */
const ISENTO_IE = 2;
/** Clientes com um 2º endereço de entrega (RN-VEN-17); clientes cujos pedidos da demo são FOB (RN-VEN-16): índice -> transportadora. */
const COM_ENTREGA = [0, 4, 9, 19, 22] as const;
const FRETE_FOB: Record<number, string> = { 0: 'rio-negro', 9: 'rio-negro', 12: 'expresso-amazonas', 27: 'expresso-amazonas' };

/** Índices (0-based) com título vencido; o 13 (Mini Box Japiim) está bloqueado por atraso. */
const COM_VENCIDO = new Set([1, 5, 9, 13, 17, 21, 25, 29]);
const BLOQUEADO = 13;

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
  ['p05', 1, 'vendedor', 'recebido', 1, 8, '28D', [['CAF-500', 24], ['BIS-400', 30], ['MOL-340', 48]]],
  ['p06', 8, 'vendedor', 'rejeitado', 2, 9, 'AVISTA', [['ACA-1K', 10], ['SUC-1L', 12]]],
  ['p07', 10, 'vendedor', 'cancelado', 5, 0, '28D', [['SAR-125', 48]]],
  ['p08', 18, 'vendedor2', 'recebido', 10, 0, '28D', [['ARR-5K', 15], ['FEI-1K', 20], ['FAR-1K', 20]]],
  // 12%: acima da alçada do supervisor (10%), aguarda o gerente
  ['p09', 20, 'vendedor2', 'recebido', 2, 12, '28-56', [['REF-2L', 24], ['BIS-140', 60]]],
  ['p10', 22, 'vendedor2', 'recebido', 1, 7, '30-60-90', [['OLE-900', 48], ['MAC-500', 60]]],
];
/** Contam como venda na base "aprovado" (parâmetro metas.base_apuracao). */
const VENDIDO: ReadonlySet<string> = new Set(['approved', 'sent_to_erp', 'invoiced', 'cancelled']);
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
    };
  });

  const clientes: Linha[] = CLIENTES.map(([nome, segmento, bairro, rua], n) => {
    const [latitude, longitude] = coordenada(n);
    const semCep = n === CLIENTE_SEM_CEP_DEMO;
    return {
      id: c(n), tenant_id: T, documento: cnpjDemo(n + 1), razao_social: `${nome} Comércio de Alimentos Ltda`, nome_fantasia: nome, segmento,
      telefone: `9230000${String(n + 1).padStart(3, '0')}`, email: null, logradouro: rua, numero: String(100 + ((n * 37) % 900)), bairro,
      cidade: 'Manaus', uf: 'AM', cep: semCep ? null : cepDemo(n), latitude, longitude, ativo: true, deleted_at: null,
      external_id: `C${String(5000 + n + 1)}`,
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
  // 0013 (RN-VEN-15): preço próprio da CX no Varejo para alguns produtos (sem linha = UN × fator). DESLIGADO até a consulta
  // catalogo.precos_cliente@1 filtrar a unidade (hoje ela lê todas as linhas do produto e a da CX seria lida como preço da UN).
  for (const [sku, fator, fracao] of CAIXAS) {
    if (fracao === null || !PRECO_PROPRIO_CX_LIGADO) continue;
    itensTabela.push({
      id: id(`tabela_preco_item:varejo:${sku}:CX`), tenant_id: T, tabela_preco_id: idTabela('varejo'), produto_id: id(`produto:${sku}`),
      preco_cents: Math.round(PRECO.get(sku)! * fator * fracao), vigencia_inicio: inicioVigencia, vigencia_fim: null, unidade: 'CX', ...comuns,
    });
  }
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
    const historico: Array<{ de: OrderStatus | null; para: OrderStatus; autor: ChaveUsuario; motivo: string; nivel: string | null; em: string }> = r.historico.map((h) => ({
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
    r.itens.forEach((it, s) => {
      const sku = it.sku;
      itens.push({
        id: id(`pedido_item:${chave}:${s + 1}`), tenant_id: T, pedido_id, sequencia: s + 1, produto_id: it.product_id, quantidade: it.quantity,
        preco_tabela_cents: it.preco_tabela_cents, preco_unitario_cents: it.preco_unitario_cents, desconto_pct: it.desconto_pct, total_cents: it.total_cents,
        produto_sku: sku, produto_nome: PRODUTO.get(sku)!.nome, unidade: PRODUTO.get(sku)!.unidade, ...comuns,
      });
    });
    const [nome, , bairro, rua] = CLIENTES[n]!;
    const cli = { logradouro: rua, numero: String(100 + ((n * 37) % 900)) };
    // 0013: frete (R-20261102-105040: FOB = o cliente paga, com a transportadora; senão CIF) e entrega no endereço principal
    const fob = FRETE_FOB[n];
    const transp = fob ? TRANSPORTADORAS.find(([k]) => k === fob)! : null;
    const tabelaCents = r.total_tabela_cents;
    pedidos.push({
      id: pedido_id, tenant_id: T, cliente_id: c(n), vendedor_id: u(quem), autor_id: u(quem), status, condicao_pagamento: DESCRICAO_CONDICAO.get(condicao)!,
      desconto_pct: r.desconto_pct, total_tabela_cents: r.total_tabela_cents, total_cents: r.total_cents, observacao: null,
      visita_id, rota_parada_id: null, criado_no_aparelho_em: criado, recebido_em: criado, numero_erp: null,
      motivo_cancelamento: status === 'cancelled' ? MOTIVO_CANCELAMENTO_DEMO : null,
      numero: null, hash_envio: null,
      cliente_resumo: {
        razao_social: `${nome} Comércio de Alimentos Ltda`, nome_fantasia: nome, documento: cnpjDemo(n + 1), endereco: `${cli.logradouro}, ${cli.numero}`, bairro,
        cidade: 'Manaus', uf: 'AM', codigo_erp: `C${String(5000 + n + 1)}`,
      },
      desconto_efetivo_pct: tabelaCents > 0 ? Math.round((1 - r.total_cents / tabelaCents) * 10_000) / 100 : 0,
      frete_modalidade: transp ? 'FOB' : 'CIF',
      transportadora_id: transp ? idTransportadoraDemo(transp[0]) : null, transportadora_digitada: false, transportadora_nome: transp?.[1] ?? null,
      transportadora_documento: transp ? cnpjDemo(900 + TRANSPORTADORAS.indexOf(transp)) : null, transportadora_telefone: transp?.[2] ?? null,
      endereco_entrega_id: idEnderecoDemo(n, 'principal'),
      endereco_entrega: { logradouro: cli.logradouro, numero: cli.numero, complemento: null, bairro, cidade: 'Manaus', uf: 'AM', cep: n === CLIENTE_SEM_CEP_DEMO ? null : cepDemo(n), descricao: 'Principal' },
      cliente_nome: nome, vendedor_nome: vendedor.nome, tabela_preco_id: idTabela(tabela), condicao_pagamento_id: idCondicaoDemo(condicao),
      condicao_pagamento_descricao: DESCRICAO_CONDICAO.get(condicao)!, nivel_aprovacao: r.nivel, motivos_aprovacao: arrayDeTexto(r.motivos),
      aprovacao_automatica: r.aprovacao_automatica, decidido_por_id: decisao?.por ?? null, decidido_em: decisao?.em ?? null,
      motivo_rejeicao: decisao?.motivo ?? null, created_at: criado, ...comuns,
    });
    historico.forEach((h, i) => {
      const autor = USUARIOS_DEMO[h.autor];
      eventos.push({
        id: id(`pedido_evento:${chave}:${i + 1}`), tenant_id: T, pedido_id, de: h.de, para: h.para, autor_id: u(h.autor), autor_nome: autor.nome,
        autor_perfil: autor.perfil, motivo: h.motivo, nivel: h.nivel, acima_do_nivel: false, ocorrido_em: h.em, created_at: h.em, ...comuns,
      });
    });
    visitas.push(visita(chave, quem, n, data, hora, 'pedido', { pedido_id }));
    if (VENDIDO.has(status)) {
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

  const metas: Linha[] = METAS.map(([quem, indicador, valor]) => ({
    id: id(`meta:${quem}:${periodo}:${indicador}`), tenant_id: T, usuario_id: u(quem), periodo, indicador, valor, ...comuns,
  }));

  const notificacao = (chave: string, quem: ChaveUsuario, extra: Partial<Linha>): Linha => ({
    id: id(`notificacao:${chave}`), tenant_id: T, usuario_id: u(quem), tipo: 'sistema', titulo: '', corpo: '', link: null, origem_modulo: 'core',
    origem_evento_id: null, envio_id: null, autor_id: null, prioridade: 'normal', lida_em: null, expira_em: null, push_enviado_em: null, ...comuns, ...extra,
  });
  const notificacoes: Linha[] = [
    notificacao('recado-vendedor', 'vendedor', {
      tipo: 'recado', titulo: 'Prioridade de hoje', corpo: 'Passe cedo no Mercadinho São Jorge: tem título vencido e o pedido de ontem aguarda aprovação.',
      link: '/m/core-rota', envio_id: id('notificacao-envio:recado-vendedor'), autor_id: u('supervisor'), prioridade: 'alta',
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
  const conteudoDe = (sku: string, nome: string, categoria: string) =>
    CONTEUDO[sku] ?? [`${nome}.`, `Revenda no varejo: ${categoria.toLowerCase()}.`, 'Item de giro da distribuidora.', []];
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
          ...base, id: idEnderecoDemo(n, 'principal'), tipo: 'principal', descricao: 'Principal', logradouro: rua, numero: String(100 + ((n * 37) % 900)), bairro,
          cep: n === CLIENTE_SEM_CEP_DEMO ? null : cepDemo(n), latitude, longitude, principal: true,
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
      const [descricao, aplicacoes, argumentos] = conteudoDe(sku, nome, categoria);
      const grupo = GRUPO[sku]!;
      return {
        id: id(`produto_busca:${sku}`), tenant_id: T, produto_id: id(`produto:${sku}`), sku, ean: null, nome, marca, categoria: `${categoria} ${nomeDoNo.get(grupo)}`,
        atributos: atributosTexto(sku) || null, conteudo: [descricao, aplicacoes, argumentos].join(' '), ativo: true, ...comuns,
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
  };
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

/** Tabelas com tenant_id (todas as schemas de domínio), para o `recriar`. */
async function tabelasDoTenant(admin: ClientBase): Promise<string[]> {
  const r = await admin.query<{ nome: string }>(`
    select format('%I.%I', c.table_schema, c.table_name) as nome
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
       and c.table_schema not in ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
     order by 1`);
  return r.rows.map((x) => x.nome);
}

/** Apaga todas as linhas do tenant demo (só dele), na transação aberta. Exige superusuário (local/Docker). */
async function apagarTenantDemo(admin: ClientBase): Promise<void> {
  // replica: desliga gatilhos e FKs só nesta transação (ciclo usuario <-> equipe, auditoria, cascatas)
  await admin.query("set local session_replication_role = 'replica'");
  for (const tabela of await tabelasDoTenant(admin)) await admin.query(`delete from ${tabela} where tenant_id = $1`, [T]);
  await admin.query('delete from plataforma.tenant where id = $1', [T]);
  await admin.query("set local session_replication_role = 'origin'");
}

export interface ResultadoDemo {
  tenantId: string;
  codigo: string;
  hoje: string;
  logins: Array<{ email: string; perfil: string; nome: string }>;
  dados: DadosDemo;
}

/**
 * Carrega a base de demo com cliente ADMIN, numa transação. Rodar 2× não duplica. A senha só é trocada se a atual
 * não conferir com a informada (assim rodar de novo não muda o hash à toa). Contadores de login errado e bloqueio são
 * zerados a cada carga (a demo não trava por senha digitada errado no ensaio).
 */
export async function carregarDemo(admin: ClientBase, opcoes: { senha?: string; recriar?: boolean } & OpcoesDemo = {}): Promise<ResultadoDemo> {
  exigirBancoLocal(hostDoCliente(admin), 'Seed da base de demonstração');
  const senha = opcoes.senha ?? process.env.MACUXI_SENHA_DEMO ?? SENHA_DEMO_PADRAO;
  const faltando = (await admin.query<{ t: string }>("select t from unnest($1::text[]) t where to_regclass(t) is null", [[...ORDEM_DEMO]])).rows;
  if (faltando.length > 0) {
    throw new Error(`[db] base de demo precisa das migrações até a ${MIGRACAO_MINIMA} (falta ${faltando[0]!.t}): rode "banco migrar up" antes.`);
  }
  await admin.query('begin');
  try {
    if (opcoes.recriar) await apagarTenantDemo(admin);
    const atuais = await admin.query<{ id: string; senha_hash: string | null }>('select id, senha_hash from core.usuario where tenant_id = $1', [T]);
    const hashAtual = new Map(atuais.rows.map((r) => [r.id, r.senha_hash]));
    const hashDe = (k: ChaveUsuario) => {
      const h = hashAtual.get(idUsuarioDemo(k));
      return h && verificarSenha(senha, h) ? h : hashSenha(senha);
    };
    const dados = dadosDemo(hashDe, { hoje: opcoes.hoje });
    conferirSoTenantDemo(dados);
    for (const tabela of ORDEM_DEMO) {
      // equipe antes do responsável: grava sem responsavel_id e completa depois dos usuários
      const linhas: Linha[] = tabela === 'core.equipe' ? dados[tabela].map((e) => ({ ...e, responsavel_id: null })) : dados[tabela];
      // diário: as datas andam com o "hoje" e o único (usuario_id, data) não é adiável — a linha que vai para a data
      // de outra ainda não movida violaria o único no meio do upsert. Apaga só as linhas do seed (por id) e regrava.
      if (tabela === 'core.indicador_diario') {
        await admin.query('delete from core.indicador_diario where tenant_id = $1 and id = any($2::uuid[])', [T, linhas.map((l) => l.id)]);
      }
      // contador do número: nunca volta atrás (o ensaio pode já ter numerado pedidos com ele)
      if (tabela === 'vendedor.numeracao_pedido') {
        const n = linhas[0]!;
        await admin.query(
          `insert into vendedor.numeracao_pedido as x (id, tenant_id, ultimo) values ($1, $2, $3)
           on conflict (tenant_id) do update set ultimo = greatest(x.ultimo, excluded.ultimo), deleted_at = null`,
          [n.id, T, n.ultimo],
        );
        continue;
      }
      // pedido do ensaio (fora do seed) com um número que o seed usa ganha número novo do contador (único por tenant)
      if (tabela === 'vendedor.pedido') {
        await admin.query("select set_config('app.tenant_id', $1, true)", [T]);
        await admin.query(
          'update vendedor.pedido set numero = vendedor.proximo_numero_pedido() where tenant_id = $1 and numero = any($2::text[]) and id <> all($3::uuid[])',
          [T, linhas.map((l) => l.numero), linhas.map((l) => l.id)],
        );
      }
      await gravarLinhas(admin, tabela, linhas);
      if (tabela === 'core.usuario') await gravarLinhas(admin, 'core.equipe', dados['core.equipe']);
    }
    await admin.query('commit');
    const usuarios = dados['core.usuario'];
    return {
      tenantId: T,
      codigo: CODIGO_DEMO,
      hoje: dados['core.rota'][0]!.data as string,
      logins: usuarios.map((x) => ({ email: String(x.email), perfil: String(x.perfil), nome: String(x.nome) })),
      dados,
    };
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
