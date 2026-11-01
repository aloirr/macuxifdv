/**
 * Base de DEMONSTRAÇÃO (dono: banco-dados) — demonstração com o gestor externo usando o app novo com a API real
 * (pedido do Alexandre R-20261031-233442, item 1). Diferente do seed da Fase M (que imita o mockup), esta base é
 * montada para o roteiro da demo: um tenant fictício pequeno e coerente, com tudo o que o app Campo e o Gestão mostram.
 *
 * - Tenant "Distribuidora Exemplo", código da empresa `demo`, fuso America/Manaus; módulos core, catálogo, vendedor e
 *   promotor (licença do tenant + módulos por perfil).
 * - Usuários (e-mails @exemplo.com.br): vendedor, vendedor2, supervisor, promotor, analista e admin. Senha de todos =
 *   MACUXI_SENHA_DEMO (padrão "demo-macuxi"), gravada só como hash argon2id; nunca é impressa.
 * - 30 clientes de Manaus (endereço, bairro, coordenadas), contato principal com telefone fictício, financeiro e
 *   títulos (8 com título vencido, 1 bloqueado), 12 meses de histórico, pedidos em vários estados e visitas passadas.
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
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { anoMes, hojeNoFuso, instante, menorData, somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico, idMotivoPadrao, type CodigoMotivoPadrao } from '../../src/ids';
import { hashSenha, verificarSenha } from '../../src/senha';

export const TENANT_DEMO = 'dd000000-0000-4000-8000-000000000001';
export const CODIGO_DEMO = 'demo';
export const FUSO_DEMO = 'America/Manaus';
export const SENHA_DEMO_PADRAO = 'demo-macuxi';
export const MODULOS_DEMO = ['core', 'catalogo', 'vendedor', 'promotor'] as const;
/** Última migração de que a base depende (vendedor.pedido). */
const MIGRACAO_MINIMA = '0007_vendedor_pedido';

const T = TENANT_DEMO;
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

// ---------------------------------------------------------------------------------------------------------------
// Usuários
type ChaveUsuario = 'vendedor' | 'vendedor2' | 'supervisor' | 'promotor' | 'analista' | 'admin';
interface UsuarioDemo {
  nome: string;
  curto: string;
  email: string;
  perfil: 'vendedor' | 'supervisor' | 'promotor' | 'analista' | 'admin';
  naEquipe: boolean;
  externo: string | null;
}

/** Logins da demonstração (nomes fictícios). */
export const USUARIOS_DEMO: Record<ChaveUsuario, UsuarioDemo> = {
  vendedor: { nome: 'Lucas Andrade', curto: 'Lucas A.', email: 'vendedor@exemplo.com.br', perfil: 'vendedor', naEquipe: true, externo: '201' },
  vendedor2: { nome: 'Camila Freitas', curto: 'Camila F.', email: 'vendedor2@exemplo.com.br', perfil: 'vendedor', naEquipe: true, externo: '202' },
  supervisor: { nome: 'Renata Barros', curto: 'Renata B.', email: 'supervisor@exemplo.com.br', perfil: 'supervisor', naEquipe: true, externo: null },
  promotor: { nome: 'Joana Prado', curto: 'Joana P.', email: 'promotor@exemplo.com.br', perfil: 'promotor', naEquipe: true, externo: '301' },
  analista: { nome: 'Paulo Ribeiro', curto: 'Paulo R.', email: 'analista@exemplo.com.br', perfil: 'analista', naEquipe: false, externo: null },
  admin: { nome: 'Sérgio Moura', curto: 'Sérgio M.', email: 'admin@exemplo.com.br', perfil: 'admin', naEquipe: false, externo: null },
};
export const idUsuarioDemo = (chave: ChaveUsuario) => id(`usuario:${USUARIOS_DEMO[chave].email}`);

/** Módulos por perfil (RN-CORE-01: efetivos = tenant ∩ perfil). Promotor nunca ganha o Vendedor (RN-PRO-01). */
const PERFIL_MODULOS: Record<UsuarioDemo['perfil'], readonly (typeof MODULOS_DEMO)[number][]> = {
  vendedor: ['core', 'catalogo', 'vendedor'],
  supervisor: ['core', 'catalogo', 'vendedor', 'promotor'],
  promotor: ['core', 'catalogo', 'promotor'],
  analista: ['core', 'catalogo', 'vendedor', 'promotor'],
  admin: ['core', 'catalogo', 'vendedor', 'promotor'],
};

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
];
const PRECO = new Map(PRODUTOS.map(([sku, , , , , preco]) => [sku, preco]));

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
type Status = 'received' | 'pending_approval' | 'approved' | 'sent_to_erp' | 'invoiced' | 'cancelled';
/** [chave, cliente, vendedor, status, dias úteis atrás, desconto %, condição, itens [sku, qtd]] */
const PEDIDOS: Array<[string, number, Dono, Status, number, number, string, Array<[string, number]>]> = [
  ['p01', 0, 'vendedor', 'invoiced', 12, 0, '28 dias', [['ARR-5K', 20], ['FEI-1K', 30], ['OLE-900', 24], ['CAF-500', 12]]],
  ['p02', 2, 'vendedor', 'invoiced', 8, 3, '28 dias', [['ACU-1K', 50], ['MAR-500', 12], ['LEI-1L', 24]]],
  ['p03', 4, 'vendedor', 'approved', 3, 5, '28/35/42 dias', [['REF-2L', 36], ['REF-350', 6], ['AGU-500', 8]]],
  ['p04', 6, 'vendedor', 'sent_to_erp', 2, 0, '28 dias', [['SAB-1K', 24], ['DET-500', 48], ['PAP-4', 20]]],
  ['p05', 1, 'vendedor', 'pending_approval', 1, 12, '28 dias', [['CAF-500', 24], ['BIS-400', 30], ['MOL-340', 48]]],
  ['p06', 8, 'vendedor', 'received', 1, 2, 'À vista', [['ACA-1K', 10], ['SUC-1L', 12]]],
  ['p07', 10, 'vendedor', 'cancelled', 5, 0, '28 dias', [['SAR-125', 48]]],
  ['p08', 18, 'vendedor2', 'invoiced', 10, 0, '28 dias', [['ARR-5K', 15], ['FEI-1K', 20], ['FAR-1K', 20]]],
  ['p09', 20, 'vendedor2', 'approved', 2, 4, '28 dias', [['REF-2L', 24], ['BIS-140', 60]]],
  ['p10', 22, 'vendedor2', 'pending_approval', 1, 15, '28/35 dias', [['OLE-900', 48], ['MAC-500', 60]]],
];
/** Contam como venda na base "aprovado" (parâmetro metas.base_apuracao). */
const VENDIDO: ReadonlySet<Status> = new Set(['approved', 'sent_to_erp', 'invoiced', 'cancelled']);

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
  'vendedor.pedido',
  'vendedor.pedido_item',
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
  const u = idUsuarioDemo;
  const c = idClienteDemo;

  const usuarios: Linha[] = (Object.keys(USUARIOS_DEMO) as ChaveUsuario[]).map((k) => {
    const x = USUARIOS_DEMO[k];
    return {
      id: u(k), tenant_id: T, nome: x.nome, nome_curto: x.curto, email: x.email, perfil: x.perfil, equipe_id: x.naEquipe ? equipeId : null,
      senha_hash: hashDe(k), ativo: true, bloqueado_em: null, tentativas_falhas: 0, bloqueio_ate: null, deleted_at: null, external_id: x.externo,
    };
  });

  const clientes: Linha[] = CLIENTES.map(([nome, segmento, bairro, rua], n) => {
    const [latitude, longitude] = coordenada(n);
    return {
      id: c(n), tenant_id: T, documento: null, razao_social: `${nome} Comércio de Alimentos Ltda`, nome_fantasia: nome, segmento,
      telefone: `9230000${String(n + 1).padStart(3, '0')}`, email: null, logradouro: rua, numero: String(100 + ((n * 37) % 900)), bairro,
      cidade: 'Manaus', uf: 'AM', cep: `6900${String(1000 + n * 13).padStart(4, '0')}`, latitude, longitude, ativo: true, deleted_at: null,
      external_id: `C${String(5000 + n + 1)}`,
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

  const visitas: Linha[] = [];
  const pedidos: Linha[] = [];
  const itens: Linha[] = [];
  // id do diário pelo deslocamento (dias úteis atrás), não pela data: rodar em outro dia MOVE a linha em vez de
  // deixar a do dia antigo somando de novo no realizado (ver o delete por id em carregarDemo)
  const diario = new Map<string, { chave: string; usuario: ChaveUsuario; data: string; pedidos: number; vendido: number; cancelado: number }>();
  PEDIDOS.forEach(([chave, n, quem, status, atras, desconto, condicao, linhas], k) => {
    const data = diasUteisAtras(hoje, atras);
    const hora = `${String(9 + (k % 7)).padStart(2, '0')}:${k % 2 ? '30' : '10'}`;
    const pedido_id = id(`pedido:${chave}`);
    const visita_id = id(`visita:${chave}`);
    let tabela = 0;
    let total = 0;
    linhas.forEach(([sku, qtd], s) => {
      const preco = PRECO.get(sku)!;
      const unitario = Math.round((preco * (100 - desconto)) / 100);
      tabela += preco * qtd;
      total += unitario * qtd;
      itens.push({
        id: id(`pedido_item:${chave}:${s + 1}`), tenant_id: T, pedido_id, sequencia: s + 1, produto_id: id(`produto:${sku}`), quantidade: qtd,
        preco_tabela_cents: preco, preco_unitario_cents: unitario, desconto_pct: desconto, total_cents: unitario * qtd, ...comuns,
      });
    });
    const criado = emManaus(data, `${hora.slice(0, 2)}:${hora.slice(3) === '10' ? '40' : '55'}`);
    pedidos.push({
      id: pedido_id, tenant_id: T, cliente_id: c(n), vendedor_id: u(quem), autor_id: u(quem), status, condicao_pagamento: condicao, desconto_pct: desconto,
      total_tabela_cents: tabela, total_cents: total,
      observacao: status === 'pending_approval' ? 'Desconto acima da alçada do vendedor: aguardando o supervisor.' : null,
      visita_id, rota_parada_id: null, criado_no_aparelho_em: criado, recebido_em: criado,
      numero_erp: status === 'invoiced' || status === 'sent_to_erp' ? `PV${String(70_000 + k)}` : null,
      motivo_cancelamento: status === 'cancelled' ? 'Cliente desistiu da compra' : null, ...comuns,
    });
    visitas.push(visita(chave, quem, n, data, hora, 'pedido', { pedido_id }));
    if (VENDIDO.has(status)) {
      const d = diario.get(`${quem}:${atras}`) ?? { chave: `${quem}:${atras}`, usuario: quem, data, pedidos: 0, vendido: 0, cancelado: 0 };
      d.pedidos += 1;
      d.vendido += total;
      if (status === 'cancelled') d.cancelado += total;
      diario.set(d.chave, d);
    }
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
  ];

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
    'core.equipe': [{ id: equipeId, tenant_id: T, nome: 'Equipe Manaus', equipe_pai_id: null, responsavel_id: u('supervisor'), ativo: true, ...comuns }],
    'core.usuario': usuarios,
    'core.produto': PRODUTOS.map(([sku, nome, marca, categoria, unidade]) => ({
      id: id(`produto:${sku}`), tenant_id: T, sku, ean: null, nome, marca, categoria, unidade, ativo: true, deleted_at: null, external_id: sku,
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
    'vendedor.pedido': pedidos,
    'vendedor.pedido_item': itens,
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
