/**
 * Fixture do Treinamento nos dois tenants da fixture dois-tenants (0017, T-0058; dono: banco-dados).
 *
 * Os testes de vazamento (db/testes/vazamento.test.ts e tests/integracao/multitenant/*) descobrem as tabelas sozinhos e
 * exigem ≥ 1 linha de A e de B em toda tabela com tenant_id. Esta fixture cobre o schema `treinamento` e é carregada pelo
 * globalSetup logo depois de `carregarDoisTenants` (mesmo instante `agora`). Fica fora de db/seeds/fixtures/dois-tenants.ts
 * nesta entrega (frente nuvem, escopo restrito); a rodada local pode incorporá-la lá (ver docs/banco/treinamento.md).
 *
 * UUIDs fixos com o prefixo do tenant (aaaaaaaa/bbbbbbbb) e grupos 0x70–0x7d. Datas derivadas do `agora` da carga (nada de
 * hora fixa). Idempotente: upsert por id.
 */
import type { ClientBase } from 'pg';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { hojeNoFuso, somarDias } from '../src/datas';
import { gravarLinhas, type Linha } from '../src/gravar';
import { idFixo } from '../src/ids';

const G = {
  trilha: 0x70,
  modulo_trilha: 0x71,
  licao: 0x72,
  quiz: 0x73,
  questao: 0x74,
  alternativa: 0x75,
  trilha_publicacao: 0x76,
  progresso: 0x77,
  tentativa: 0x78,
  xp_lancamento: 0x79,
  medalha: 0x7a,
  medalha_usuario: 0x7b,
  desafio_vendas: 0x7c,
  desafio_vendas_produto: 0x7d,
} as const;

/** Ordem de carga (FKs dentro do schema). */
export const ORDEM_TREINAMENTO = [
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
export type TabelaTreinamento = (typeof ORDEM_TREINAMENTO)[number];
export type DadosTreinamento = Record<TabelaTreinamento, Linha[]>;

/** Literal de array do Postgres para uuid[]/text[] (gravarLinhas manda array JS como JSON). */
export const arrayPg = (itens: readonly string[]): string => `{${itens.join(',')}}`;

const comuns = { deleted_at: null, external_id: null } as const;

interface TenantDaFixture {
  prefixo: 'aaaaaaaa' | 'bbbbbbbb';
  tenantId: string;
  fuso: string;
  aluno: string;
  autor: string;
  equipe: string | null;
}

function dadosDoTenant(t: TenantDaFixture, agora: Date): DadosTreinamento {
  const id = (g: keyof typeof G, seq: number) => idFixo(t.prefixo, G[g], seq);
  const T = t.tenantId;
  const hoje = hojeNoFuso(t.fuso, agora);
  const ontem = somarDias(hoje, -1);
  const instanteOntem = new Date(agora.getTime() - 86_400_000).toISOString();
  const instanteAntes = new Date(agora.getTime() - 2 * 86_400_000).toISOString();
  const trilha = id('trilha', 1);
  const modulo = id('modulo_trilha', 1);
  const licao = id('licao', 1);
  const licaoQuiz = id('licao', 2);
  const quiz = id('quiz', 1);
  const questao = id('questao', 1);
  const certa = id('alternativa', 1);
  const desafio = id('desafio_vendas', 1);
  return {
    'treinamento.trilha': [
      {
        id: trilha, tenant_id: T, titulo: 'Boas-vindas', descricao: 'Trilha da fixture', status: 'publicada', obrigatoria: true, sequencial: true,
        prazo: somarDias(hoje, 30), publico_perfis: arrayPg(['vendedor']), publico_equipes: arrayPg(t.equipe ? [t.equipe] : []),
        publicada_em: instanteAntes, arquivada_em: null, ...comuns,
      },
    ],
    'treinamento.modulo_trilha': [{ id: modulo, tenant_id: T, trilha_id: trilha, ordem: 0, titulo: 'Módulo 1', pre_requisitos: '{}', ...comuns }],
    'treinamento.licao': [
      { id: licao, tenant_id: T, trilha_id: trilha, modulo_id: modulo, ordem: 0, titulo: 'Lição de texto', tipo: 'texto', texto: 'Conteúdo', midia_url: null, duracao_estimada_seg: 60, pre_requisitos: '{}', ...comuns },
      { id: licaoQuiz, tenant_id: T, trilha_id: trilha, modulo_id: modulo, ordem: 1, titulo: 'Lição com quiz', tipo: 'texto', texto: 'Conteúdo', midia_url: null, duracao_estimada_seg: null, pre_requisitos: arrayPg([licao]), ...comuns },
    ],
    'treinamento.quiz': [{ id: quiz, tenant_id: T, trilha_id: trilha, licao_id: licaoQuiz, ...comuns }],
    'treinamento.questao': [{ id: questao, tenant_id: T, trilha_id: trilha, quiz_id: quiz, ordem: 0, enunciado: 'Pergunta da fixture?', ...comuns }],
    'treinamento.alternativa': [
      { id: certa, tenant_id: T, trilha_id: trilha, questao_id: questao, ordem: 0, texto: 'Certa', correta: true, ...comuns },
      { id: id('alternativa', 2), tenant_id: T, trilha_id: trilha, questao_id: questao, ordem: 1, texto: 'Errada', correta: false, ...comuns },
    ],
    'treinamento.trilha_publicacao': [
      { id: id('trilha_publicacao', 1), tenant_id: T, trilha_id: trilha, acao: 'publicar', de: 'rascunho', para: 'publicada', autor_id: t.autor, autor_nome: 'Admin', ocorrido_em: instanteAntes, request_id: null, ...comuns },
    ],
    'treinamento.medalha': [
      { id: id('medalha', 1), tenant_id: T, codigo: 'primeira_trilha', nome: 'Primeira trilha concluída', regra: { tipo: 'trilhas_concluidas', quantidade: 1 }, ativa: true, ...comuns },
    ],
    'treinamento.desafio_vendas': [
      { id: desafio, tenant_id: T, nome: 'Desafio da fixture', ativo: true, vigencia_inicio: somarDias(hoje, -7), vigencia_fim: somarDias(hoje, 23), xp_por_unidade: 2, xp_max_por_pedido: 50, xp_max_por_desafio: null, ...comuns },
    ],
    'treinamento.desafio_vendas_produto': [{ id: id('desafio_vendas_produto', 1), tenant_id: T, desafio_id: desafio, produto_id: idFixo(t.prefixo, 0x0e, 901), ...comuns }],
    'treinamento.progresso': [{ id: id('progresso', 1), tenant_id: T, usuario_id: t.aluno, trilha_id: trilha, licao_id: licao, concluida_em: instanteOntem, tempo_gasto_seg: 95, ...comuns }],
    'treinamento.tentativa': [
      {
        id: id('tentativa', 1), tenant_id: T, usuario_id: t.aluno, quiz_id: quiz, realizada_em: instanteOntem, respostas: [{ questao_id: questao, alternativa_ids: [certa] }],
        acertos: 1, total_questoes: 1, nota_pct: 100, aprovada: true, primeira_tentativa: true, finalizada: true, ...comuns,
      },
    ],
    'treinamento.xp_lancamento': [
      { id: id('xp_lancamento', 1), tenant_id: T, usuario_id: t.aluno, origem: 'licao', referencia_id: licao, pontos: 10, pontos_base: 10, limitado_pelo_teto: false, ocorrido_em: instanteOntem, dia: ontem, ...comuns },
      { id: id('xp_lancamento', 2), tenant_id: T, usuario_id: t.aluno, origem: 'quiz', referencia_id: quiz, pontos: 5, pontos_base: 5, limitado_pelo_teto: false, ocorrido_em: instanteOntem, dia: ontem, ...comuns },
    ],
    'treinamento.medalha_usuario': [{ id: id('medalha_usuario', 1), tenant_id: T, usuario_id: t.aluno, medalha_codigo: 'nota_maxima', conquistada_em: instanteOntem, ...comuns }],
  };
}

/** Linhas do Treinamento de A e de B (A: aluno = vendedor-1 da equipe 1; B: o vendedor, sem equipe). */
export function dadosTreinamento(agora: Date): DadosTreinamento {
  const A = dadosDoTenant(
    { prefixo: 'aaaaaaaa', tenantId: DOIS_TENANTS.A.tenantId, fuso: DOIS_TENANTS.A.fuso, aluno: DOIS_TENANTS.A.usuarios.vendedor1, autor: DOIS_TENANTS.A.usuarios.admin, equipe: DOIS_TENANTS.A.equipes.equipe1 },
    agora,
  );
  const B = dadosDoTenant(
    { prefixo: 'bbbbbbbb', tenantId: DOIS_TENANTS.B.tenantId, fuso: DOIS_TENANTS.B.fuso, aluno: DOIS_TENANTS.B.usuarios.vendedor, autor: DOIS_TENANTS.B.usuarios.admin, equipe: null },
    agora,
  );
  return Object.fromEntries(ORDEM_TREINAMENTO.map((t) => [t, [...A[t], ...B[t]]])) as DadosTreinamento;
}

/** IDs para asserts (os mesmos que `dadosTreinamento` grava). */
export const TREINAMENTO_FIXTURE = {
  A: { trilha: idFixo('aaaaaaaa', G.trilha, 1), licao: idFixo('aaaaaaaa', G.licao, 1), quiz: idFixo('aaaaaaaa', G.quiz, 1), aluno: DOIS_TENANTS.A.usuarios.vendedor1 },
  B: { trilha: idFixo('bbbbbbbb', G.trilha, 1), licao: idFixo('bbbbbbbb', G.licao, 1), quiz: idFixo('bbbbbbbb', G.quiz, 1), aluno: DOIS_TENANTS.B.usuarios.vendedor },
} as const;

/** Carrega a fixture do Treinamento (cliente ADMIN, numa transação). Pré-condição: dois-tenants carregada e 0017 aplicada. */
export async function carregarTreinamentoDoisTenants(admin: ClientBase, opcoes: { agora: Date }): Promise<DadosTreinamento> {
  const dados = dadosTreinamento(opcoes.agora);
  await admin.query('begin');
  try {
    for (const tabela of ORDEM_TREINAMENTO) await gravarLinhas(admin, tabela, dados[tabela]);
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
  return dados;
}
