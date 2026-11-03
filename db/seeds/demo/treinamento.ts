/**
 * Base de DEMONSTRAÇÃO do Treinamento (dono: banco-dados; migração 0017, T-0058). Complementa db/seeds/demo/demo.ts
 * (tenant "Distribuidora Exemplo", código `demo`, America/Manaus) — rode DEPOIS do `carregarDemo`.
 *
 * - Licença: módulo `treinamento` ativo no tenant demo (plataforma.tenant_modulo) e liberado para todos os perfis
 *   (plataforma.perfil_modulo), com os MESMOS ids que o demo.ts geraria se o módulo entrasse em MODULOS_DEMO.
 * - Conteúdo (BKO): 3 trilhas — "Visita que vende" (publicada, OBRIGATÓRIA, vendedor + promotor, prazo em 10 dias, 2 módulos,
 *   4 lições, quiz de 3 questões), "Portfólio Sabor do Norte" (publicada, todo o tenant, 3 lições, quiz de 2 questões) e
 *   "Gôndola perfeita" (rascunho, só promotor). Linha do tempo da publicação (trilha_publicacao) pelo analista Paulo.
 * - Jornada (app): Lucas concluiu a obrigatória com nota 100 e começou o portfólio (sequência de 3 dias, a última hoje);
 *   Camila concluiu o portfólio (nota 100) e fez 2 lições da obrigatória; Joana fez a 1ª lição da obrigatória.
 *   XP coerente com as regras (lição 10, acerto na 1ª tentativa 5, trilha 50; nenhum dia passa do teto de 200) e
 *   medalhas "Primeira trilha concluída" e "Nota máxima no quiz" (Lucas e Camila).
 *   Ranking acumulado: Lucas 115 XP > Camila 110 XP > Joana 10 XP (demais perfis sem XP).
 * - Desafio de vendas "Sabor do Norte" (mês corrente): açaí, suco de cupuaçu e farinha de mandioca, 2 XP por unidade.
 *
 * Datas relativas ao "hoje" no fuso do tenant (padrão: hoje em Manaus no momento do seed); nenhuma atividade no futuro.
 * Idempotente: upsert por id determinístico (`idDeterministico('demo:<chave>')`). Só roda contra o Postgres local.
 *
 * Ligar no demo.ts (dono: banco-dados, rodada local): dentro de `carregarDemo`, logo antes do `await admin.query('commit')`:
 *   await gravarTreinamentoDemo(admin, { hoje: dados['core.rota'][0]!.data as string });
 * Sozinho (base demo já carregada): `carregarTreinamentoDemo(admin)`.
 */
import type { ClientBase } from 'pg';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { hojeNoFuso, somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';

/**
 * Constantes do demo.ts REPLICADAS de propósito: o demo.ts vai importar este arquivo (gravarTreinamentoDemo) e o import
 * de volta seria circular. db/testes/treinamento.test.ts confere que batem com TENANT_DEMO, FUSO_DEMO e idUsuarioDemo.
 */
export const TENANT_DEMO_TREINAMENTO = 'dd000000-0000-4000-8000-000000000001';
export const FUSO_DEMO_TREINAMENTO = 'America/Manaus';
/** E-mails dos usuários da demo (USUARIOS_DEMO do demo.ts). */
const EMAILS_DEMO = {
  vendedor: 'vendedor@exemplo.com.br',
  vendedor2: 'vendedor2@exemplo.com.br',
  supervisor: 'supervisor@exemplo.com.br',
  gerente: 'gerente@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
  admin: 'admin@exemplo.com.br',
} as const;
/** Mesmo id do demo.ts (`idUsuarioDemo`). */
export const idUsuarioDemoTreinamento = (chave: keyof typeof EMAILS_DEMO) => idDeterministico(`demo:usuario:${EMAILS_DEMO[chave]}`);
const idUsuarioDemo = idUsuarioDemoTreinamento;
const FUSO_DEMO = FUSO_DEMO_TREINAMENTO;
const T = TENANT_DEMO_TREINAMENTO;
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const idT = (chave: string) => id(`treinamento:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** Migração de que esta base depende. */
const MIGRACAO_MINIMA = '0017_treinamento';
export const MODULO_TREINAMENTO = 'treinamento';
/** Perfis com o Treinamento liberado na demo (todos: o vendedor e o promotor treinam; gestores veem ranking e adesão). */
export const PERFIS_TREINAMENTO_DEMO = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;

export const ORDEM_TREINAMENTO_DEMO = [
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'treinamento.trilha',
  'treinamento.modulo_trilha',
  'treinamento.licao',
  'treinamento.quiz',
  'treinamento.questao',
  'treinamento.alternativa',
  'treinamento.trilha_publicacao',
  'treinamento.medalha',
  'treinamento.desafio_vendas',
  'treinamento.desafio_vendas_produto',
  'treinamento.progresso',
  'treinamento.tentativa',
  'treinamento.xp_lancamento',
  'treinamento.medalha_usuario',
] as const;
export type TabelaTreinamentoDemo = (typeof ORDEM_TREINAMENTO_DEMO)[number];
export type DadosTreinamentoDemo = Record<TabelaTreinamentoDemo, Linha[]>;

/** Literal de array do Postgres para uuid[]/text[] (gravarLinhas manda array JS como JSON). */
const arrayPg = (itens: readonly string[]): string => `{${itens.join(',')}}`;

// ---------------------------------------------------------------------------------------------------------------
// Conteúdo
type TipoLicao = 'texto' | 'video' | 'pdf' | 'link';
interface QuestaoDemo {
  enunciado: string;
  /** Alternativas; a primeira marcada com `*` é a correta (o `*` não é gravado). */
  alternativas: string[];
}
interface LicaoDemo {
  chave: string;
  titulo: string;
  tipo: TipoLicao;
  texto: string;
  midia_url: string | null;
  duracao: number | null;
  quiz?: QuestaoDemo[];
}
interface TrilhaDemo {
  chave: 'visita' | 'portfolio' | 'gondola';
  titulo: string;
  descricao: string;
  status: 'rascunho' | 'publicada';
  obrigatoria: boolean;
  /** Dias até o prazo (a partir de hoje); null = sem prazo. */
  prazoEmDias: number | null;
  perfis: string[];
  /** Restringe à Equipe Manaus? */
  soEquipeManaus: boolean;
  /** Publicada há N dias (rascunho: null). */
  publicadaHaDias: number | null;
  modulos: Array<{ chave: string; titulo: string; licoes: LicaoDemo[] }>;
}

export const TRILHAS_DEMO: readonly TrilhaDemo[] = [
  {
    chave: 'visita',
    titulo: 'Visita que vende',
    descricao: 'Do planejamento da rota ao fechamento do pedido: o roteiro de uma visita produtiva na Distribuidora Exemplo.',
    status: 'publicada',
    obrigatoria: true,
    prazoEmDias: 10,
    perfis: ['vendedor', 'promotor'],
    soEquipeManaus: false,
    publicadaHaDias: 12,
    modulos: [
      {
        chave: 'planejar',
        titulo: 'Planejamento da visita',
        licoes: [
          { chave: 'rota', titulo: 'Antes de sair: rota e metas do dia', tipo: 'texto', texto: 'Confira a rota de hoje, os clientes com título vencido e a meta de positivação antes da primeira visita.', midia_url: null, duracao: 120 },
          { chave: 'checkin', titulo: 'Check-in no cliente', tipo: 'video', texto: 'Vídeo curto: como fazer o check-in dentro do raio e o que fazer quando o GPS falha.', midia_url: 'https://exemplo.com.br/treinamento/checkin.mp4', duracao: 180 },
        ],
      },
      {
        chave: 'loja',
        titulo: 'Na loja',
        licoes: [
          { chave: 'mix', titulo: 'Positivação e mix ideal', tipo: 'texto', texto: 'Use o histórico de compras do Cliente 360 para sugerir o mix: comece pelos itens de giro e pelos que estão em falta.', midia_url: null, duracao: 150 },
          {
            chave: 'consultiva',
            titulo: 'Venda consultiva',
            tipo: 'texto',
            texto: 'Ouça o comprador, apresente a solução e feche o pedido sem pressa. Responda o quiz para concluir a trilha.',
            midia_url: null,
            duracao: 90,
            quiz: [
              { enunciado: 'Qual é o primeiro passo de uma venda consultiva?', alternativas: ['*Entender a necessidade do cliente', 'Apresentar a tabela de preços', 'Oferecer o maior desconto'] },
              { enunciado: 'O cliente tem título vencido. O que fazer antes do pedido?', alternativas: ['Ignorar e seguir com o pedido', '*Conferir a situação no Cliente 360 e combinar a condição', 'Cancelar a visita'] },
              { enunciado: 'Onde você vê o que o cliente costuma comprar?', alternativas: ['*No histórico de compras do Cliente 360', 'No ranking do Treinamento', 'Nas notificações'] },
            ],
          },
        ],
      },
    ],
  },
  {
    chave: 'portfolio',
    titulo: 'Portfólio Sabor do Norte',
    descricao: 'Conheça a linha Sabor do Norte: polpa de açaí, suco de cupuaçu e farinha de mandioca — conservação, giro e argumentos de venda.',
    status: 'publicada',
    obrigatoria: false,
    prazoEmDias: null,
    perfis: [],
    soEquipeManaus: false,
    publicadaHaDias: 6,
    modulos: [
      {
        chave: 'linha',
        titulo: 'A linha Sabor do Norte',
        licoes: [
          { chave: 'acai', titulo: 'Polpa de açaí: conservação e giro', tipo: 'texto', texto: 'A polpa fica no congelador a −18 °C. Combine reposição semanal com o cliente para não faltar no fim de semana.', midia_url: null, duracao: 90 },
          { chave: 'cupuacu', titulo: 'Ficha técnica do suco de cupuaçu', tipo: 'pdf', texto: 'Resumo: 1 L, sem conservantes, validade de 6 meses fechado.', midia_url: 'https://exemplo.com.br/treinamento/suco-cupuacu.pdf', duracao: 60 },
          {
            chave: 'argumentos',
            titulo: 'Argumentos de venda',
            tipo: 'texto',
            texto: 'Produto regional, preço competitivo e margem boa para o varejo. Responda o quiz.',
            midia_url: null,
            duracao: 60,
            quiz: [
              { enunciado: 'Em que temperatura a polpa de açaí deve ficar?', alternativas: ['5 °C', '*−18 °C', 'Temperatura ambiente'] },
              { enunciado: 'Qual o principal argumento da linha Sabor do Norte?', alternativas: ['*Produto regional com boa margem para o varejo', 'É importado', 'Não precisa de reposição'] },
            ],
          },
        ],
      },
    ],
  },
  {
    chave: 'gondola',
    titulo: 'Gôndola perfeita',
    descricao: 'Trade marketing para promotores: arrumação, share de gôndola e ruptura (em elaboração).',
    status: 'rascunho',
    obrigatoria: false,
    prazoEmDias: null,
    perfis: ['promotor'],
    soEquipeManaus: true,
    publicadaHaDias: null,
    modulos: [
      {
        chave: 'arrumacao',
        titulo: 'Arrumação',
        licoes: [{ chave: 'antes-depois', titulo: 'Foto de antes e depois', tipo: 'texto', texto: 'Tire a foto de antes, arrume pela regra da marca e tire a de depois no mesmo ângulo.', midia_url: null, duracao: 120 }],
      },
    ],
  },
];

/** Medalhas do catálogo padrão (MEDALHAS_PADRAO do domain, sequência de 7 dias). */
export const MEDALHAS_DEMO = [
  { codigo: 'primeira_trilha', nome: 'Primeira trilha concluída', regra: { tipo: 'trilhas_concluidas', quantidade: 1 } },
  { codigo: 'nota_maxima', nome: 'Nota máxima no quiz', regra: { tipo: 'nota_maxima' } },
  { codigo: 'sequencia_7_dias', nome: '7 dias seguidos', regra: { tipo: 'sequencia_dias', dias: 7 } },
] as const;

/** Produtos do desafio de vendas (SKUs do demo.ts). */
export const SKUS_DESAFIO_DEMO = ['ACA-1K', 'SUC-1L', 'FAR-1K'] as const;
export const idTrilhaDemo = (chave: TrilhaDemo['chave']) => idT(`trilha:${chave}`);
export const idLicaoDemo = (trilha: TrilhaDemo['chave'], licao: string) => idT(`licao:${trilha}:${licao}`);
export const idQuizDemo = (trilha: TrilhaDemo['chave'], licao: string) => idT(`quiz:${trilha}:${licao}`);
export const idDesafioDemo = () => idT('desafio_vendas:sabor-do-norte');
/** Mesmos ids do demo.ts (`id('produto:<sku>')`, `id('equipe:Equipe Manaus')`). */
export const idProdutoDemo = (sku: string) => id(`produto:${sku}`);
export const idEquipeManausDemo = () => id('equipe:Equipe Manaus');

// ---------------------------------------------------------------------------------------------------------------
// Jornada dos alunos
type Aluno = 'vendedor' | 'vendedor2' | 'promotor';
/** Atividades: [aluno, trilha, lição, dias atrás, hora local, tempo gasto (s), respostas do quiz (índices escolhidos) ou null]. */
type Atividade = [Aluno, TrilhaDemo['chave'], string, number, string, number, number[] | null];
const ATIVIDADES: readonly Atividade[] = [
  // Lucas: três dias seguidos, terminando hoje (sequência de 3)
  ['vendedor', 'visita', 'rota', 2, '09:10', 140, null],
  ['vendedor', 'visita', 'checkin', 2, '09:20', 200, null],
  ['vendedor', 'visita', 'mix', 1, '18:30', 170, null],
  ['vendedor', 'visita', 'consultiva', 1, '18:40', 120, [0, 1, 0]],
  ['vendedor', 'portfolio', 'acai', 0, '07:30', 95, null],
  // Camila: portfólio completo há 3 dias; na obrigatória, as 2 primeiras lições anteontem
  ['vendedor2', 'portfolio', 'acai', 3, '10:00', 100, null],
  ['vendedor2', 'portfolio', 'cupuacu', 3, '10:05', 70, null],
  ['vendedor2', 'portfolio', 'argumentos', 3, '10:12', 80, [1, 0]],
  ['vendedor2', 'visita', 'rota', 2, '19:00', 130, null],
  ['vendedor2', 'visita', 'checkin', 2, '19:10', 190, null],
  // Joana: primeira lição da obrigatória
  ['promotor', 'visita', 'rota', 1, '08:15', 150, null],
];

export interface OpcoesTreinamentoDemo {
  /** "Hoje" (AAAA-MM-DD) da demonstração; padrão: hoje em America/Manaus no momento do seed. */
  hoje?: string;
  /** Instante do seed (nenhuma atividade fica depois dele); padrão: o relógio. */
  agora?: Date;
}

/** Hora local de Manaus (UTC−4, sem horário de verão) -> instante UTC ISO. */
function emManaus(data: string, horaLocal: string): string {
  const [h, m] = horaLocal.split(':').map(Number) as [number, number];
  const [y, mo, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h + 4, m)).toISOString();
}

/** Instante da atividade, nunca depois do `agora` (o seed pode rodar de madrugada) e sem sair do dia civil. */
function instanteDaAtividade(data: string, horaLocal: string, agora: Date): string {
  const desejado = new Date(emManaus(data, horaLocal));
  if (desejado.getTime() <= agora.getTime()) return desejado.toISOString();
  const recuado = new Date(agora.getTime() - 60_000);
  const inicioDoDia = new Date(emManaus(data, '00:00'));
  return (recuado.getTime() >= inicioDoDia.getTime() ? recuado : inicioDoDia).toISOString();
}

/** Monta as linhas do Treinamento do tenant demo (puro: sem banco). */
export function dadosTreinamentoDemo(opcoes: OpcoesTreinamentoDemo = {}): DadosTreinamentoDemo {
  const agora = opcoes.agora ?? new Date();
  const hoje = opcoes.hoje ?? hojeNoFuso(FUSO_DEMO, agora);
  const dados: DadosTreinamentoDemo = Object.fromEntries(ORDEM_TREINAMENTO_DEMO.map((t) => [t, [] as Linha[]])) as DadosTreinamentoDemo;

  // licença
  dados['plataforma.tenant_modulo'].push({
    id: id(`tenant_modulo:${MODULO_TREINAMENTO}`), tenant_id: T, modulo: MODULO_TREINAMENTO, ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns,
  });
  for (const perfil of PERFIS_TREINAMENTO_DEMO) {
    dados['plataforma.perfil_modulo'].push({ id: id(`perfil_modulo:${perfil}:${MODULO_TREINAMENTO}`), tenant_id: T, perfil, modulo: MODULO_TREINAMENTO, ...comuns });
  }

  // conteúdo
  /** Alternativas corretas por quiz (índices), para corrigir as tentativas do seed como o servidor corrigiria. */
  const gabarito = new Map<string, { questoes: string[]; alternativas: string[][]; certas: number[] }>();
  for (const t of TRILHAS_DEMO) {
    const trilhaId = idTrilhaDemo(t.chave);
    const publicadaEm = t.publicadaHaDias === null ? null : emManaus(somarDias(hoje, -t.publicadaHaDias), '08:00');
    dados['treinamento.trilha'].push({
      id: trilhaId, tenant_id: T, titulo: t.titulo, descricao: t.descricao, status: t.status, obrigatoria: t.obrigatoria, sequencial: true,
      prazo: t.prazoEmDias === null ? null : somarDias(hoje, t.prazoEmDias), publico_perfis: arrayPg(t.perfis),
      publico_equipes: arrayPg(t.soEquipeManaus ? [idEquipeManausDemo()] : []), publicada_em: publicadaEm, arquivada_em: null, ...comuns,
    });
    if (publicadaEm) {
      dados['treinamento.trilha_publicacao'].push({
        id: idT(`trilha_publicacao:${t.chave}:1`), tenant_id: T, trilha_id: trilhaId, acao: 'publicar', de: 'rascunho', para: 'publicada',
        autor_id: idUsuarioDemo('analista'), autor_nome: 'Paulo Ribeiro', ocorrido_em: publicadaEm, request_id: null, ...comuns,
      });
    }
    let anterior: string | null = null;
    t.modulos.forEach((m, im) => {
      const moduloId = idT(`modulo_trilha:${t.chave}:${m.chave}`);
      dados['treinamento.modulo_trilha'].push({ id: moduloId, tenant_id: T, trilha_id: trilhaId, ordem: im, titulo: m.titulo, pre_requisitos: '{}', ...comuns });
      m.licoes.forEach((l, il) => {
        const licaoId = idLicaoDemo(t.chave, l.chave);
        dados['treinamento.licao'].push({
          id: licaoId, tenant_id: T, trilha_id: trilhaId, modulo_id: moduloId, ordem: il, titulo: l.titulo, tipo: l.tipo, texto: l.texto,
          midia_url: l.midia_url, duracao_estimada_seg: l.duracao, pre_requisitos: arrayPg(anterior ? [anterior] : []), ...comuns,
        });
        anterior = licaoId;
        if (!l.quiz) return;
        const quizId = idQuizDemo(t.chave, l.chave);
        dados['treinamento.quiz'].push({ id: quizId, tenant_id: T, trilha_id: trilhaId, licao_id: licaoId, ...comuns });
        const g = { questoes: [] as string[], alternativas: [] as string[][], certas: [] as number[] };
        l.quiz.forEach((q, iq) => {
          const questaoId = idT(`questao:${t.chave}:${l.chave}:${iq + 1}`);
          dados['treinamento.questao'].push({ id: questaoId, tenant_id: T, trilha_id: trilhaId, quiz_id: quizId, ordem: iq, enunciado: q.enunciado, ...comuns });
          const ids: string[] = [];
          q.alternativas.forEach((texto, ia) => {
            const altId = idT(`alternativa:${t.chave}:${l.chave}:${iq + 1}:${ia + 1}`);
            ids.push(altId);
            const correta = texto.startsWith('*');
            if (correta) g.certas.push(ia);
            dados['treinamento.alternativa'].push({
              id: altId, tenant_id: T, trilha_id: trilhaId, questao_id: questaoId, ordem: ia, texto: correta ? texto.slice(1) : texto, correta, ...comuns,
            });
          });
          g.questoes.push(questaoId);
          g.alternativas.push(ids);
        });
        gabarito.set(quizId, g);
      });
    });
  }

  for (const m of MEDALHAS_DEMO) {
    dados['treinamento.medalha'].push({ id: idT(`medalha:${m.codigo}`), tenant_id: T, codigo: m.codigo, nome: m.nome, regra: m.regra, ativa: true, ...comuns });
  }

  // desafio de vendas do mês corrente
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const [ano, mes] = hoje.split('-').map(Number) as [number, number];
  const fimMes = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  dados['treinamento.desafio_vendas'].push({
    id: idDesafioDemo(), tenant_id: T, nome: 'Desafio Sabor do Norte', ativo: true, vigencia_inicio: inicioMes, vigencia_fim: fimMes,
    xp_por_unidade: 2, xp_max_por_pedido: 40, xp_max_por_desafio: 300, ...comuns,
  });
  for (const sku of SKUS_DESAFIO_DEMO) {
    dados['treinamento.desafio_vendas_produto'].push({ id: idT(`desafio_vendas_produto:sabor-do-norte:${sku}`), tenant_id: T, desafio_id: idDesafioDemo(), produto_id: idProdutoDemo(sku), ...comuns });
  }

  // jornada: progresso, tentativas, XP (lição 10, acerto na 1ª tentativa 5, trilha 50) e medalhas
  const concluidas = new Map<string, Set<string>>();
  const xp = (aluno: Aluno, origem: string, referencia: string, pontos: number, ocorrido: string, dia: string) =>
    dados['treinamento.xp_lancamento'].push({
      id: idT(`xp_lancamento:${aluno}:${origem}:${referencia}`), tenant_id: T, usuario_id: idUsuarioDemo(aluno), origem, referencia_id: referencia,
      pontos, pontos_base: pontos, limitado_pelo_teto: false, ocorrido_em: ocorrido, dia, ...comuns,
    });
  const medalha = (aluno: Aluno, codigo: string, quando: string) =>
    dados['treinamento.medalha_usuario'].push({ id: idT(`medalha_usuario:${aluno}:${codigo}`), tenant_id: T, usuario_id: idUsuarioDemo(aluno), medalha_codigo: codigo, conquistada_em: quando, ...comuns });

  for (const [aluno, trilha, licao, diasAtras, hora, tempo, respostas] of ATIVIDADES) {
    const dia = somarDias(hoje, -diasAtras);
    const quando = instanteDaAtividade(dia, hora, agora);
    const usuarioId = idUsuarioDemo(aluno);
    const licaoId = idLicaoDemo(trilha, licao);
    let aprovada = true;
    if (respostas) {
      const quizId = idQuizDemo(trilha, licao);
      const g = gabarito.get(quizId)!;
      const acertos = respostas.filter((r, i) => r === g.certas[i]).length;
      const nota = Math.round((acertos / g.questoes.length) * 10_000) / 100;
      aprovada = nota >= 70;
      dados['treinamento.tentativa'].push({
        id: idT(`tentativa:${aluno}:${trilha}:${licao}:1`), tenant_id: T, usuario_id: usuarioId, quiz_id: quizId, realizada_em: quando,
        respostas: g.questoes.map((q, i) => ({ questao_id: q, alternativa_ids: [g.alternativas[i]![respostas[i]!]!] })),
        acertos, total_questoes: g.questoes.length, nota_pct: nota, aprovada, primeira_tentativa: true, finalizada: true, ...comuns,
      });
      if (acertos > 0) xp(aluno, 'quiz', quizId, acertos * 5, quando, dia);
      if (nota >= 100) medalha(aluno, 'nota_maxima', quando);
    }
    if (!aprovada) continue; // a lição com quiz só conclui com o quiz aprovado (RN-TRE-04)
    dados['treinamento.progresso'].push({
      id: idT(`progresso:${aluno}:${trilha}:${licao}`), tenant_id: T, usuario_id: usuarioId, trilha_id: idTrilhaDemo(trilha), licao_id: licaoId,
      concluida_em: quando, tempo_gasto_seg: tempo, ...comuns,
    });
    xp(aluno, 'licao', licaoId, 10, quando, dia);
    const feitas = concluidas.get(`${aluno}:${trilha}`) ?? new Set<string>();
    feitas.add(licao);
    concluidas.set(`${aluno}:${trilha}`, feitas);
    const total = TRILHAS_DEMO.find((x) => x.chave === trilha)!.modulos.flatMap((m) => m.licoes).length;
    if (feitas.size === total) {
      xp(aluno, 'trilha', idTrilhaDemo(trilha), 50, quando, dia);
      if (!dados['treinamento.medalha_usuario'].some((x) => x.usuario_id === usuarioId && x.medalha_codigo === 'primeira_trilha')) medalha(aluno, 'primeira_trilha', quando);
    }
  }
  return dados;
}

/** Trava de isolamento: toda linha montada é do tenant demo. */
export function conferirSoTenantDemoTreinamento(dados: DadosTreinamentoDemo): void {
  for (const tabela of ORDEM_TREINAMENTO_DEMO) {
    for (const l of dados[tabela]) if (l.tenant_id !== T) throw new Error(`[db] seed demo do Treinamento: linha de ${tabela} fora do tenant demo`);
  }
}

/**
 * Grava a base do Treinamento NA TRANSAÇÃO ABERTA de quem chama (ex.: `carregarDemo`). Não abre nem fecha transação.
 * A licença usa os ids do demo.ts; se já houver licença viva do treinamento com outro id (cadastrada pelo BKO), ela fica.
 */
export async function gravarTreinamentoDemo(admin: ClientBase, opcoes: OpcoesTreinamentoDemo = {}): Promise<DadosTreinamentoDemo> {
  const dados = dadosTreinamentoDemo(opcoes);
  conferirSoTenantDemoTreinamento(dados);
  for (const tabela of ORDEM_TREINAMENTO_DEMO) {
    let linhas = dados[tabela];
    if (tabela === 'plataforma.tenant_modulo' || tabela === 'plataforma.perfil_modulo') {
      // único (tenant, [perfil,] modulo) entre os vivos: não duplica licença cadastrada por fora do seed
      const existentes = await admin.query<{ id: string; perfil: string | null }>(
        `select id, ${tabela === 'plataforma.perfil_modulo' ? 'perfil' : 'null::text as perfil'} from ${tabela} where tenant_id = $1 and modulo = $2 and deleted_at is null`,
        [T, MODULO_TREINAMENTO],
      );
      const outros = existentes.rows.filter((r) => !linhas.some((l) => l.id === r.id));
      linhas = linhas.filter((l) => !outros.some((o) => tabela === 'plataforma.tenant_modulo' || o.perfil === l.perfil));
      if (tabela === 'plataforma.tenant_modulo' && outros.length > 0) await admin.query('update plataforma.tenant_modulo set ativo = true where id = any($1::uuid[])', [outros.map((o) => o.id)]);
    }
    await gravarLinhas(admin, tabela, linhas);
  }
  return dados;
}

/** Carrega a base do Treinamento sozinha (base demo já carregada), numa transação. Só no Postgres local. */
export async function carregarTreinamentoDemo(admin: ClientBase, opcoes: OpcoesTreinamentoDemo = {}): Promise<DadosTreinamentoDemo> {
  exigirBancoLocal(hostDoCliente(admin), 'Seed da base de demonstração do Treinamento');
  const faltando = (await admin.query<{ t: string }>('select t from unnest($1::text[]) t where to_regclass(t) is null', [[...ORDEM_TREINAMENTO_DEMO]])).rows;
  if (faltando.length > 0) throw new Error(`[db] base de demo do Treinamento precisa da migração ${MIGRACAO_MINIMA} (falta ${faltando[0]!.t}): rode "banco migrar up" antes.`);
  const usuarios = await admin.query('select 1 from core.usuario where tenant_id = $1 and id = $2', [T, idUsuarioDemo('vendedor')]);
  if (usuarios.rowCount === 0) throw new Error('[db] base de demo do Treinamento: carregue a base demo antes (seed demo).');
  await admin.query('begin');
  try {
    const dados = await gravarTreinamentoDemo(admin, opcoes);
    await admin.query('commit');
    return dados;
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
