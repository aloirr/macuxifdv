/**
 * Linhas da Pesquisa (migração 0016, T-0057) na fixture dois-tenants: tenant A e tenant B com linha em TODA tabela do
 * schema pesquisa (o teste de vazamento exige linha de A e de B em cada tabela com tenant_id).
 * resposta_item e resposta_foto não são listadas: o gatilho pesquisa.normalizar_resposta as cria ao inserir a resposta.
 *
 * Ligação na fixture central (db/seeds/fixtures/dois-tenants.ts, em carregarDoisTenants, dentro da transação e
 * depois do laço de ORDEM_TABELAS):
 *   `await gravarPesquisaDoisTenants(admin, { agora: opcoes.agora });`
 * Até lá, db/testes/pesquisa.test.ts chama a mesma função no beforeAll (idempotente).
 *
 * A: "Exposição" (avulsa) v1 publicada + v2 rascunho; "Checkout" (checkout_obrigatoria) v1 publicada; resposta do
 *    vendedor-1 no c1 (ontem) com sim/não, única, múltipla, número, texto, escala, data, foto (1 arquivo recebido) e código.
 * B: "Avulsa B" v1 publicada; resposta SUSPEITA (relógio adiantado) do vendedor no c1 (ontem) com sim/não e foto (arquivo recebido).
 */
import { createHash } from 'node:crypto';
import type { ClientBase } from 'pg';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { hojeNoFuso, instante, somarDias } from '../src/datas';
import { arrayDeTexto, gravarLinhas, type Linha } from '../src/gravar';
import { idFixo } from '../src/ids';

/** Grupos de id da Pesquisa na fixture (fora da faixa usada pela fixture central). */
const GP = { questionario: 0x160, versao: 0x161, pergunta: 0x162, opcao: 0x163, resposta: 0x164, arquivo: 0x165 } as const;
const a = (g: keyof typeof GP, seq: number) => idFixo('aaaaaaaa', GP[g], seq);
const b = (g: keyof typeof GP, seq: number) => idFixo('bbbbbbbb', GP[g], seq);
const comuns = { deleted_at: null, external_id: null } as const;

export const PESQUISA_DOIS_TENANTS = {
  A: {
    questionarios: { exposicao: a('questionario', 1), checkout: a('questionario', 2) },
    versoes: { exposicaoV1: a('versao', 1), exposicaoV2Rascunho: a('versao', 2), checkoutV1: a('versao', 3) },
    perguntas: {
      simNao: a('pergunta', 1), unica: a('pergunta', 2), multipla: a('pergunta', 3), numero: a('pergunta', 4), texto: a('pergunta', 5),
      escala: a('pergunta', 6), data: a('pergunta', 7), foto: a('pergunta', 8), codigo: a('pergunta', 9), checkoutNota: a('pergunta', 10),
    },
    opcoes: { boa: a('opcao', 1), ruim: a('opcao', 2), cafe: a('opcao', 3), arroz: a('opcao', 4), feijao: a('opcao', 5) },
    respostas: { v1c1: a('resposta', 1) },
    arquivos: { fotoV1c1: a('arquivo', 1) },
  },
  B: {
    questionarios: { avulsa: b('questionario', 1) },
    versoes: { avulsaV1: b('versao', 1) },
    perguntas: { simNao: b('pergunta', 1), foto: b('pergunta', 2) },
    respostas: { c1: b('resposta', 1) },
    arquivos: { fotoC1: b('arquivo', 1) },
  },
} as const;

export const ORDEM_PESQUISA_FIXTURE = ['plataforma.arquivo', 'pesquisa.questionario', 'pesquisa.questionario_versao', 'pesquisa.resposta'] as const;
export type DadosPesquisaFixture = Record<(typeof ORDEM_PESQUISA_FIXTURE)[number], Linha[]>;

const publico = (perfis: string[]) => ({ perfis, equipes: [], segmentos: [], regioes: [], clientes: [] });

/** Linhas da Pesquisa nos dois tenants (função pura), relativas a `agora` (o instante da carga da fixture). */
export function dadosPesquisaDoisTenants(agora: Date = new Date()): DadosPesquisaFixture {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const P = PESQUISA_DOIS_TENANTS;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const hojeA = hojeNoFuso(A.fuso, agora);
  const hojeB = hojeNoFuso(B.fuso, agora);
  const [ontemA, ontemB] = [somarDias(hojeA, -1), somarDias(hojeB, -1)];
  const [criadoA, criadoB] = [instante(somarDias(hojeA, -10), '12:00'), instante(somarDias(hojeB, -10), '12:00')];
  const [publicadoA, publicadoB] = [instante(somarDias(hojeA, -9), '13:00'), instante(somarDias(hojeB, -9), '13:00')];
  const PA = P.A.perguntas;
  const OA = P.A.opcoes;

  const perguntasA: Linha[] = [
    { id: PA.simNao, tipo: 'sim_nao', enunciado: 'Tem o produto na gôndola?', obrigatoria: true },
    { id: PA.unica, tipo: 'unica', enunciado: 'Exposição', obrigatoria: true, opcoes: [{ id: OA.boa, rotulo: 'Boa' }, { id: OA.ruim, rotulo: 'Ruim' }] },
    { id: PA.multipla, tipo: 'multipla', enunciado: 'Quais itens faltam?', obrigatoria: false, opcoes: [{ id: OA.cafe, rotulo: 'Café' }, { id: OA.arroz, rotulo: 'Arroz' }, { id: OA.feijao, rotulo: 'Feijão' }] },
    { id: PA.numero, tipo: 'numero', enunciado: 'Frentes', obrigatoria: false, inteiro: true },
    { id: PA.texto, tipo: 'texto', enunciado: 'Observação', obrigatoria: false },
    { id: PA.escala, tipo: 'escala', enunciado: 'Nota da loja', obrigatoria: false, minimo: 1, maximo: 5 },
    { id: PA.data, tipo: 'data', enunciado: 'Validade mais próxima', obrigatoria: false },
    { id: PA.foto, tipo: 'foto', enunciado: 'Foto da gôndola', obrigatoria: false, min_fotos: 1, max_fotos: 3 },
    { id: PA.codigo, tipo: 'codigo_barras', enunciado: 'Código do produto', obrigatoria: false },
  ];
  const versao = (v: Linha): Linha => ({
    descricao: null, modo: 'avulsa', frequencia: 'a_cada_visita', vigencia_fim: null, regras: [], publicada_em: null, publicada_por: null, ...comuns, ...v,
  });
  const capturadaA = instante(ontemA, '14:00');
  const capturadaB = instante(ontemB, '15:00');

  return {
    'plataforma.arquivo': [
      {
        id: P.A.arquivos.fotoV1c1, tenant_id: tA, modulo: 'pesquisa', finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: P.A.respostas.v1c1,
        cliente_id: A.clientes.c1, enviado_por: A.usuarios.vendedor1, tipo: 'image/jpeg', tamanho_bytes: 180_224,
        sha256: createHash('sha256').update('fixture-pesquisa-alfa').digest('hex'), largura_px: 1600, altura_px: 1200, situacao: 'recebido',
        recebido_em: instante(ontemA, '14:10'), chave_armazenamento: `${tA}/pesquisa/${ontemA.slice(0, 7)}/${P.A.arquivos.fotoV1c1}.jpg`, ...comuns,
      },
      {
        id: P.B.arquivos.fotoC1, tenant_id: tB, modulo: 'pesquisa', finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: P.B.respostas.c1,
        cliente_id: B.clientes.c1, enviado_por: B.usuarios.vendedor, tipo: 'image/jpeg', tamanho_bytes: 98_304,
        sha256: createHash('sha256').update('fixture-pesquisa-beta').digest('hex'), largura_px: null, altura_px: null, situacao: 'recebido',
        recebido_em: instante(ontemB, '15:06'), chave_armazenamento: `${tB}/pesquisa/${ontemB.slice(0, 7)}/${P.B.arquivos.fotoC1}.jpg`, ...comuns,
      },
    ],
    'pesquisa.questionario': [
      { id: P.A.questionarios.exposicao, tenant_id: tA, criado_em: criadoA, arquivado_em: null, ...comuns },
      { id: P.A.questionarios.checkout, tenant_id: tA, criado_em: criadoA, arquivado_em: null, ...comuns },
      { id: P.B.questionarios.avulsa, tenant_id: tB, criado_em: criadoB, arquivado_em: null, ...comuns },
    ],
    'pesquisa.questionario_versao': [
      versao({
        id: P.A.versoes.exposicaoV1, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, numero: 1, status: 'publicada', titulo: 'Exposição na loja',
        publico_alvo: publico(['vendedor', 'promotor']), vigencia_inicio: criadoA, perguntas: perguntasA, criada_em: criadoA,
        publicada_em: publicadoA, publicada_por: A.usuarios.analista,
      }),
      versao({
        id: P.A.versoes.exposicaoV2Rascunho, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, numero: 2, status: 'rascunho', titulo: 'Exposição na loja (v2)',
        publico_alvo: publico(['vendedor', 'promotor']), vigencia_inicio: criadoA, perguntas: perguntasA.slice(0, 2), criada_em: instante(hojeA, '10:00'),
      }),
      versao({
        id: P.A.versoes.checkoutV1, tenant_id: tA, questionario_id: P.A.questionarios.checkout, numero: 1, status: 'publicada', titulo: 'Satisfação no checkout',
        modo: 'checkout_obrigatoria', publico_alvo: publico(['vendedor']), vigencia_inicio: criadoA, vigencia_fim: instante(somarDias(hojeA, 60), '03:59'),
        perguntas: [{ id: PA.checkoutNota, tipo: 'escala', enunciado: 'Nota do atendimento', obrigatoria: true, minimo: 1, maximo: 5 }],
        criada_em: criadoA, publicada_em: publicadoA, publicada_por: A.usuarios.admin,
      }),
      versao({
        id: P.B.versoes.avulsaV1, tenant_id: tB, questionario_id: P.B.questionarios.avulsa, numero: 1, status: 'publicada', titulo: 'Avulsa do tenant B',
        frequencia: 'semanal', publico_alvo: publico([]), vigencia_inicio: criadoB,
        perguntas: [
          { id: P.B.perguntas.simNao, tipo: 'sim_nao', enunciado: 'Loja aberta?', obrigatoria: true },
          { id: P.B.perguntas.foto, tipo: 'foto', enunciado: 'Fachada', obrigatoria: false, min_fotos: 1, max_fotos: 5 },
        ],
        criada_em: criadoB, publicada_em: publicadoB, publicada_por: B.usuarios.admin,
      }),
    ],
    'pesquisa.resposta': [
      {
        id: P.A.respostas.v1c1, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, versao_id: P.A.versoes.exposicaoV1, usuario_id: A.usuarios.vendedor1,
        equipe_id: A.equipes.equipe1, cliente_id: A.clientes.c1, visita_id: null, respondida_em: instante(ontemA, '14:05'), recebida_em: instante(ontemA, '14:10'),
        suspeita: false, motivos_suspeita: arrayDeTexto([]),
        itens: [
          { pergunta_id: PA.simNao, tipo: 'sim_nao', valor: true },
          { pergunta_id: PA.unica, tipo: 'unica', opcao_id: OA.boa },
          { pergunta_id: PA.multipla, tipo: 'multipla', opcao_ids: [OA.cafe, OA.feijao] },
          { pergunta_id: PA.numero, tipo: 'numero', numero: 12.5 },
          { pergunta_id: PA.texto, tipo: 'texto', texto: 'Gôndola organizada' },
          { pergunta_id: PA.escala, tipo: 'escala', valor: 4 },
          { pergunta_id: PA.data, tipo: 'data', data: somarDias(hojeA, 30) },
          { pergunta_id: PA.foto, tipo: 'foto', fotos: [{ id: P.A.arquivos.fotoV1c1, referencia: P.A.arquivos.fotoV1c1, capturada_em: capturadaA, largura_px: 1600, altura_px: 1200 }] },
          { pergunta_id: PA.codigo, tipo: 'codigo_barras', codigo: '7891234567895' },
        ],
        ...comuns,
      },
      {
        id: P.B.respostas.c1, tenant_id: tB, questionario_id: P.B.questionarios.avulsa, versao_id: P.B.versoes.avulsaV1, usuario_id: B.usuarios.vendedor,
        equipe_id: null, cliente_id: B.clientes.c1, visita_id: null, respondida_em: instante(ontemB, '15:00'), recebida_em: instante(ontemB, '15:05'),
        suspeita: true, motivos_suspeita: '{RELOGIO_ADIANTADO}',
        itens: [
          { pergunta_id: P.B.perguntas.simNao, tipo: 'sim_nao', valor: false },
          { pergunta_id: P.B.perguntas.foto, tipo: 'foto', fotos: [{ id: P.B.arquivos.fotoC1, referencia: P.B.arquivos.fotoC1, capturada_em: capturadaB }] },
        ],
        ...comuns,
      },
    ],
  };
}

/**
 * Grava a Pesquisa da fixture NA TRANSAÇÃO do chamador (cliente ADMIN; a fixture central já carregada). Idempotente:
 * versão já publicada fica como está (RN-PES-01: o banco recusa alterá-la); o resto é upsert por id.
 */
export async function gravarPesquisaDoisTenants(admin: ClientBase, opcoes: { agora?: Date } = {}): Promise<DadosPesquisaFixture> {
  const dados = dadosPesquisaDoisTenants(opcoes.agora);
  for (const tabela of ORDEM_PESQUISA_FIXTURE) {
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

/** Carga avulsa numa transação própria (usada pelo pesquisa.test.ts enquanto a fixture central não a chama). */
export async function carregarPesquisaDoisTenants(admin: ClientBase, opcoes: { agora?: Date } = {}): Promise<DadosPesquisaFixture> {
  await admin.query('begin');
  try {
    const dados = await gravarPesquisaDoisTenants(admin, opcoes);
    await admin.query('commit');
    return dados;
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
