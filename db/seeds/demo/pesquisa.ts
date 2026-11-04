/**
 * Base de DEMONSTRAÇÃO — módulo Pesquisa (dono: banco-dados; T-0057, migração 0016). Arquivo próprio, ligado ao
 * `carregarDemo` (db/seeds/demo/demo.ts) por UMA chamada, na mesma transação, depois das tabelas do Core:
 *   `await gravarPesquisaDemo(admin, { hoje: dados['core.rota'][0]!.data as string });`
 * Também roda sozinho sobre uma base demo já carregada: `carregarPesquisaDemo(admin, { hoje })`.
 *
 * - Licença: módulo `pesquisa` ativo no tenant demo (plataforma.tenant_modulo) e nos perfis que respondem (vendedor,
 *   promotor, supervisor, gerente) ou cadastram/analisam (analista, admin) — manifesto da Pesquisa.
 * - "Exposição do café no PDV" (avulsa, semanal, vendedores e promotor): sim/não, única, número e foto (opcional).
 *   v1 publicada pelo analista (Paulo) há 14 dias, sem prazo; 16 respostas nos últimos 10 dias (Lucas, Camila e Joana)
 *   em clientes da carteira de cada um que NÃO estão na rota de hoje (assim a demo responde ao vivo sem esbarrar na
 *   frequência semanal), sem foto (a galeria da demo nasce das fotos tiradas ao vivo).
 * - "Satisfação do cliente na visita" (etapa obrigatória do checkout, a cada visita, vendedores): escala 1–5, sim/não
 *   e texto opcional. v1 publicada, SEM respostas: aparece no checkout de toda visita da demo (RN-PES-03).
 *
 * Idempotente: upsert por id determinístico (`idDeterministico('demo:pesquisa:<chave>')`). Versão já PUBLICADA não é
 * regravada (RN-PES-01: o banco recusa alterar versão publicada): rodar em outro dia mantém a vigência e a publicação da
 * primeira carga e só move as respostas para perto do novo "hoje". Não importa o demo.ts (sem import circular): os ids
 * de tenant, usuários e clientes seguem a mesma chave `demo:<...>` (conferido em db/testes/pesquisa.test.ts).
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { hojeNoFuso, instante, somarDias } from '../../src/datas';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';

/** Mesmo tenant do demo.ts (TENANT_DEMO). */
const T = 'dd000000-0000-4000-8000-000000000001';
const FUSO = 'America/Manaus';
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** E-mails dos logins do demo.ts (USUARIOS_DEMO); o id do usuário é `demo:usuario:<email>`. */
const EMAIL = {
  vendedor: 'vendedor@exemplo.com.br',
  vendedor2: 'vendedor2@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
} as const;
const usuario = (k: keyof typeof EMAIL) => id(`usuario:${EMAIL[k]}`);
/** Mesmo id de idClienteDemo(n) (índice 0-based da lista de clientes do demo.ts). */
const cliente = (n: number) => id(`cliente:${n}`);
const EQUIPE_MANAUS = id('equipe:Equipe Manaus');

export const MODULO_PESQUISA = 'pesquisa';
/** Perfis com a Pesquisa (manifesto: respondem vendedor, promotor, supervisor e gerente; cadastram analista e admin). */
export const PERFIS_PESQUISA_DEMO = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'] as const;

const pid = (chave: string) => id(`pesquisa:${chave}`);

/** Ids estáveis para a API, o app e os testes. */
export const PESQUISA_DEMO = {
  questionarios: { exposicao: pid('questionario:exposicao'), satisfacao: pid('questionario:satisfacao') },
  versoes: { exposicaoV1: pid('versao:exposicao:1'), satisfacaoV1: pid('versao:satisfacao:1') },
  perguntas: {
    exposicao: {
      temCafe: pid('pergunta:exposicao:tem-cafe'),
      exposicao: pid('pergunta:exposicao:qualidade'),
      frentes: pid('pergunta:exposicao:frentes'),
      foto: pid('pergunta:exposicao:foto'),
    },
    satisfacao: {
      nota: pid('pergunta:satisfacao:nota'),
      voltaria: pid('pergunta:satisfacao:pediu-promotor'),
      observacao: pid('pergunta:satisfacao:observacao'),
    },
  },
  opcoesExposicao: {
    otima: pid('opcao:exposicao:otima'),
    boa: pid('opcao:exposicao:boa'),
    regular: pid('opcao:exposicao:regular'),
    ruim: pid('opcao:exposicao:ruim'),
  },
} as const;

const Q = PESQUISA_DEMO;
const PE = Q.perguntas.exposicao;
const PS = Q.perguntas.satisfacao;
const OP = Q.opcoesExposicao;

/** Clientes da carteira de cada respondente FORA da rota de hoje do demo.ts (rotas: 0,1,7,2,5,13 · 18,19,21,23 · 0,4,9,22). */
const RESPONDENTES: Array<{ quem: 'vendedor' | 'vendedor2' | 'promotor'; clientes: number[] }> = [
  { quem: 'vendedor', clientes: [3, 6, 8, 10, 11, 12, 14, 15] },
  { quem: 'vendedor2', clientes: [20, 24, 25, 26, 27] },
  { quem: 'promotor', clientes: [10, 14, 19] },
];
/** Dias atrás (1..10) e hora local de cada resposta, na ordem de RESPONDENTES achatada (16 respostas). */
const QUANDO: Array<[number, string]> = [
  [10, '09:10'], [9, '10:40'], [8, '14:05'], [7, '08:50'], [5, '11:20'], [3, '15:30'], [2, '09:45'], [10, '15:10'],
  [9, '13:15'], [6, '10:05'], [4, '16:20'], [3, '08:35'], [1, '11:50'],
  [8, '09:30'], [6, '14:45'], [4, '10:15'],
];
const QUALIDADES = [OP.otima, OP.boa, OP.boa, OP.regular, OP.boa, OP.ruim, OP.otima, OP.regular] as const;

/** Hora local de Manaus (UTC−4, sem horário de verão) -> instante UTC ISO. */
function emManaus(data: string, horaLocal: string): string {
  const [h, m] = horaLocal.split(':').map(Number) as [number, number];
  const total = h * 60 + m + 4 * 60;
  const dia = total >= 24 * 60 ? somarDias(data, 1) : data;
  const min = total % (24 * 60);
  return instante(dia, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
}

const maisMinutos = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString().replace('.000Z', 'Z');

export const ORDEM_PESQUISA_DEMO = [
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'pesquisa.questionario',
  'pesquisa.questionario_versao',
  'pesquisa.resposta',
] as const;
export type TabelaPesquisaDemo = (typeof ORDEM_PESQUISA_DEMO)[number];
export type DadosPesquisaDemo = Record<TabelaPesquisaDemo, Linha[]>;

/** Perguntas da avulsa (contrato Pergunta, campos com default explícitos). */
function perguntasExposicao(): Linha[] {
  return [
    { id: PE.temCafe, tipo: 'sim_nao', enunciado: 'O café Aroma da Serra está exposto na gôndola?', obrigatoria: true },
    {
      id: PE.exposicao, tipo: 'unica', enunciado: 'Como está a exposição dos nossos produtos?', obrigatoria: true,
      opcoes: [
        { id: OP.otima, rotulo: 'Ótima' }, { id: OP.boa, rotulo: 'Boa' }, { id: OP.regular, rotulo: 'Regular' }, { id: OP.ruim, rotulo: 'Ruim' },
      ],
    },
    { id: PE.frentes, tipo: 'numero', enunciado: 'Quantas frentes de café nossos produtos ocupam?', obrigatoria: false, minimo: 0, maximo: 60, inteiro: true, unidade: 'frentes' },
    { id: PE.foto, tipo: 'foto', enunciado: 'Foto da gôndola de café', ajuda: 'Enquadre a gôndola inteira.', obrigatoria: false, min_fotos: 1, max_fotos: 3 },
  ];
}

function perguntasSatisfacao(): Linha[] {
  return [
    { id: PS.nota, tipo: 'escala', enunciado: 'De 1 a 5, como o cliente avalia o nosso atendimento?', obrigatoria: true, minimo: 1, maximo: 5, rotulo_minimo: 'Muito ruim', rotulo_maximo: 'Excelente' },
    { id: PS.voltaria, tipo: 'sim_nao', enunciado: 'O cliente pediu a visita de um promotor?', obrigatoria: true },
    { id: PS.observacao, tipo: 'texto', enunciado: 'Observações do cliente', obrigatoria: false, max_caracteres: 500 },
  ];
}

/** Monta as linhas da Pesquisa na base demo (função pura). `hoje` = AAAA-MM-DD em America/Manaus. */
export function dadosPesquisaDemo(opcoes: { hoje?: string } = {}): DadosPesquisaDemo {
  const hoje = opcoes.hoje ?? hojeNoFuso(FUSO);
  const analista = usuario('analista');
  const criadoEm = emManaus(somarDias(hoje, -15), '16:00');
  const publicadaEm = emManaus(somarDias(hoje, -14), '09:00');
  const inicio = emManaus(somarDias(hoje, -14), '00:00');

  const versao = (v: { id: string; questionario_id: string; titulo: string; descricao: string; modo: string; frequencia: string; perfis: string[]; perguntas: Linha[] }): Linha => ({
    id: v.id, tenant_id: T, questionario_id: v.questionario_id, numero: 1, status: 'publicada', titulo: v.titulo, descricao: v.descricao,
    modo: v.modo, frequencia: v.frequencia, publico_alvo: { perfis: v.perfis, equipes: [], segmentos: [], regioes: [], clientes: [] },
    vigencia_inicio: inicio, vigencia_fim: null, perguntas: v.perguntas, regras: [], criada_em: criadoEm, publicada_em: publicadaEm,
    publicada_por: analista, ...comuns,
  });

  let k = 0;
  const respostas: Linha[] = RESPONDENTES.flatMap(({ quem, clientes }) =>
    clientes.map((n) => {
      const i = k++;
      const [dias, hora] = QUANDO[i]!;
      const respondida = emManaus(somarDias(hoje, -dias), hora);
      const temCafe = i % 5 !== 3;
      const itens: Linha[] = [
        { pergunta_id: PE.temCafe, tipo: 'sim_nao', valor: temCafe },
        { pergunta_id: PE.exposicao, tipo: 'unica', opcao_id: temCafe ? QUALIDADES[i % QUALIDADES.length]! : OP.ruim },
        ...(temCafe ? [{ pergunta_id: PE.frentes, tipo: 'numero', numero: 4 + ((i * 7) % 15) }] : []),
      ];
      return {
        id: pid(`resposta:exposicao:${i + 1}`), tenant_id: T, questionario_id: Q.questionarios.exposicao, versao_id: Q.versoes.exposicaoV1,
        usuario_id: usuario(quem), equipe_id: EQUIPE_MANAUS, cliente_id: cliente(n), visita_id: null, respondida_em: respondida,
        recebida_em: maisMinutos(respondida, 3 + (i % 4)), suspeita: false, motivos_suspeita: arrayDeTexto([]), itens, ...comuns,
      };
    }),
  );

  return {
    'plataforma.tenant_modulo': [
      { id: id(`tenant_modulo:${MODULO_PESQUISA}`), tenant_id: T, modulo: MODULO_PESQUISA, ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns },
    ],
    'plataforma.perfil_modulo': PERFIS_PESQUISA_DEMO.map((perfil) => ({ id: id(`perfil_modulo:${perfil}:${MODULO_PESQUISA}`), tenant_id: T, perfil, modulo: MODULO_PESQUISA, ...comuns })),
    'pesquisa.questionario': [
      { id: Q.questionarios.exposicao, tenant_id: T, criado_em: criadoEm, arquivado_em: null, ...comuns },
      { id: Q.questionarios.satisfacao, tenant_id: T, criado_em: criadoEm, arquivado_em: null, ...comuns },
    ],
    'pesquisa.questionario_versao': [
      versao({
        id: Q.versoes.exposicaoV1, questionario_id: Q.questionarios.exposicao, titulo: 'Exposição do café no PDV',
        descricao: 'Levantamento semanal da exposição do café nas gôndolas dos clientes.', modo: 'avulsa', frequencia: 'semanal',
        perfis: ['vendedor', 'promotor'], perguntas: perguntasExposicao(),
      }),
      versao({
        id: Q.versoes.satisfacaoV1, questionario_id: Q.questionarios.satisfacao, titulo: 'Satisfação do cliente na visita',
        descricao: 'Três perguntas rápidas no fim de cada visita.', modo: 'checkout_obrigatoria', frequencia: 'a_cada_visita',
        perfis: ['vendedor'], perguntas: perguntasSatisfacao(),
      }),
    ],
    'pesquisa.resposta': respostas,
  };
}

/** Trava de isolamento: toda linha é do tenant demo. */
export function conferirPesquisaSoTenantDemo(dados: DadosPesquisaDemo): void {
  for (const tabela of ORDEM_PESQUISA_DEMO) {
    for (const l of dados[tabela]) if (l.tenant_id !== T) throw new Error(`[db] seed demo (pesquisa): linha de ${tabela} fora do tenant demo`);
  }
}

/**
 * Grava a Pesquisa da demo NA TRANSAÇÃO ABERTA pelo chamador (cliente ADMIN; o tenant demo e os usuários já existem).
 * Versão publicada que já existe fica como está (RN-PES-01). Exige a migração 0016.
 */
export async function gravarPesquisaDemo(admin: ClientBase, opcoes: { hoje?: string } = {}): Promise<DadosPesquisaDemo> {
  if ((await admin.query<{ ok: boolean }>("select to_regclass('pesquisa.resposta') is not null as ok")).rows[0]?.ok !== true) {
    throw new Error('[db] seed demo (pesquisa) precisa da migração 0016_pesquisa: rode "banco migrar up" antes.');
  }
  const dados = dadosPesquisaDemo(opcoes);
  conferirPesquisaSoTenantDemo(dados);
  for (const tabela of ORDEM_PESQUISA_DEMO) {
    let linhas = dados[tabela];
    if (tabela === 'pesquisa.questionario_versao') {
      const r = await admin.query<{ id: string }>("select id from pesquisa.questionario_versao where id = any($1::uuid[]) and status = 'publicada'", [linhas.map((l) => l.id)]);
      const publicadas = new Set(r.rows.map((x) => x.id));
      linhas = linhas.filter((l) => !publicadas.has(String(l.id)));
    }
    await gravarLinhas(admin, tabela, linhas);
  }
  return dados;
}

/** Carga avulsa (fora do carregarDemo), numa transação própria. Só no Postgres local, como o seed demo. */
export async function carregarPesquisaDemo(admin: ClientBase, opcoes: { hoje?: string } = {}): Promise<DadosPesquisaDemo> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed da base de demonstração (Pesquisa)');
  const tenant = await admin.query('select 1 from plataforma.tenant where id = $1', [T]);
  if (tenant.rowCount === 0) throw new Error('[db] seed demo (pesquisa): carregue a base demo antes ("banco seed demo").');
  await admin.query('begin');
  try {
    const dados = await gravarPesquisaDemo(admin, opcoes);
    await admin.query('commit');
    return dados;
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
