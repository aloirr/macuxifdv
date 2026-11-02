/**
 * Fixture dois-tenants — parte do schema `pesquisa` (0016, T-0057). Dono: banco-dados. Separada de dois-tenants.ts para a
 * mudança lá ser mínima (import + tabelas no fim de ORDEM_TABELAS + dados + as fotos em plataforma.arquivo).
 *
 * - Linha de A e de B em TODA tabela do schema (os testes de vazamento exigem). questionario, questionario_versao e
 *   resposta vêm daqui; resposta_item e resposta_foto nascem do gatilho pesquisa.normalizar_resposta ao inserir a
 *   resposta (ids = plataforma.uuid_de_chave(...), por isso ficam fora de ORDEM_PESQUISA).
 * - UUIDs `aaaaaaaa-`/`bbbbbbbb-` nos grupos 0x160–0x165 (sem colidir com os de dois-tenants.ts, os do Gestor 0x70–0x73
 *   em ./gestor.ts e os do Promotor 0x84–0x97 em ./promotor.ts; conferido em db/testes/pesquisa.test.ts).
 * - A: "Exposição" (avulsa) v1 publicada + v2 rascunho; "Checkout" (checkout_obrigatoria) v1 publicada; resposta do
 *   vendedor-1 no c1 (ontem) com os 9 tipos (foto = arquivo recebido em plataforma.arquivo).
 *   B: "Avulsa B" v1 publicada; resposta SUSPEITA (relógio adiantado) do vendedor no c1 (ontem), sim/não e foto.
 * - Versões e questionários com instantes FIXOS no passado (2026-01): a fixture é regravada por upsert e a versão
 *   publicada é imutável no banco (RN-PES-01) — com datas relativas ao "hoje", recarregar em outro dia falharia.
 *   Nada disso é comparado com o relógio. A resposta é relativa ao "hoje" de cada tenant (ontem), como o resto da fixture.
 */
import { createHash } from 'node:crypto';
import { idFixo } from '../../src/ids';
import { instante, somarDias } from '../../src/datas';
import type { Linha } from '../../src/gravar';

const GP = { questionario: 0x160, versao: 0x161, pergunta: 0x162, opcao: 0x163, resposta: 0x164, arquivo: 0x165 } as const;
const a = (g: keyof typeof GP, seq: number) => idFixo('aaaaaaaa', GP[g], seq);
const b = (g: keyof typeof GP, seq: number) => idFixo('bbbbbbbb', GP[g], seq);
const comuns = { deleted_at: null, external_id: null } as const;

/** Faixa de grupos de id da Pesquisa na fixture. */
export const GRUPOS_PESQUISA_FIXTURE = Object.values(GP);

export const PESQUISA_FIXTURE = {
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
    /** Data respondida na pergunta de data (fixa: não depende do relógio). */
    dataRespondida: '2027-06-30',
  },
  B: {
    questionarios: { avulsa: b('questionario', 1) },
    versoes: { avulsaV1: b('versao', 1) },
    perguntas: { simNao: b('pergunta', 1), foto: b('pergunta', 2) },
    respostas: { c1: b('resposta', 1) },
    arquivos: { fotoC1: b('arquivo', 1) },
  },
} as const;

/** Tabelas gravadas pela fixture, na ordem das FKs (resposta_item e resposta_foto: gatilho). */
export const ORDEM_PESQUISA = ['pesquisa.questionario', 'pesquisa.questionario_versao', 'pesquisa.resposta'] as const;
export type TabelaPesquisa = (typeof ORDEM_PESQUISA)[number];
/** Tabelas que o banco preenche sozinho a partir de pesquisa.resposta (gatilho). */
export const TABELAS_PESQUISA_DO_GATILHO = ['pesquisa.resposta_item', 'pesquisa.resposta_foto'] as const;

export interface BasePesquisaFixture {
  A: { tenantId: string; vendedor: string; analista: string; admin: string; equipe: string; cliente: string };
  B: { tenantId: string; vendedor: string; admin: string; cliente: string };
}

const publico = (perfis: string[]) => ({ perfis, equipes: [], segmentos: [], regioes: [], clientes: [] });
const versao = (v: Linha): Linha => ({
  descricao: null, modo: 'avulsa', frequencia: 'a_cada_visita', vigencia_fim: null, regras: [], publicada_em: null, publicada_por: null, ...comuns, ...v,
});

/** Instantes fixos (passado) das versões e questionários — ver o cabeçalho. */
const CRIADO = '2026-01-05T12:00:00Z';
const PUBLICADO = '2026-01-06T13:00:00Z';
const RASCUNHO = '2026-01-20T10:00:00Z';

/**
 * Linhas da Pesquisa nos dois tenants + as fotos (`arquivos`, que vão para plataforma.arquivo ANTES das respostas:
 * resposta_foto tem FK para o arquivo). hojeA/hojeB = "hoje" de cada tenant no fuso dele.
 */
export function dadosPesquisaFixture(base: BasePesquisaFixture, hojeA: string, hojeB: string): Record<TabelaPesquisa, Linha[]> & { arquivos: Linha[] } {
  const { A, B } = base;
  const P = PESQUISA_FIXTURE;
  const tA = A.tenantId;
  const tB = B.tenantId;
  const [ontemA, ontemB] = [somarDias(hojeA, -1), somarDias(hojeB, -1)];
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

  return {
    arquivos: [
      {
        id: P.A.arquivos.fotoV1c1, tenant_id: tA, modulo: 'pesquisa', finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: P.A.respostas.v1c1,
        cliente_id: A.cliente, enviado_por: A.vendedor, tipo: 'image/jpeg', tamanho_bytes: 180_224,
        sha256: createHash('sha256').update('fixture-pesquisa-alfa').digest('hex'), largura_px: 1600, altura_px: 1200, situacao: 'recebido',
        recebido_em: instante(ontemA, '14:10'), chave_armazenamento: `${tA}/pesquisa/${ontemA.slice(0, 7)}/${P.A.arquivos.fotoV1c1}.jpg`, ...comuns,
      },
      {
        id: P.B.arquivos.fotoC1, tenant_id: tB, modulo: 'pesquisa', finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: P.B.respostas.c1,
        cliente_id: B.cliente, enviado_por: B.vendedor, tipo: 'image/jpeg', tamanho_bytes: 98_304,
        sha256: createHash('sha256').update('fixture-pesquisa-beta').digest('hex'), largura_px: null, altura_px: null, situacao: 'recebido',
        recebido_em: instante(ontemB, '15:06'), chave_armazenamento: `${tB}/pesquisa/${ontemB.slice(0, 7)}/${P.B.arquivos.fotoC1}.jpg`, ...comuns,
      },
    ],
    'pesquisa.questionario': [
      { id: P.A.questionarios.exposicao, tenant_id: tA, criado_em: CRIADO, arquivado_em: null, ...comuns },
      { id: P.A.questionarios.checkout, tenant_id: tA, criado_em: CRIADO, arquivado_em: null, ...comuns },
      { id: P.B.questionarios.avulsa, tenant_id: tB, criado_em: CRIADO, arquivado_em: null, ...comuns },
    ],
    'pesquisa.questionario_versao': [
      versao({
        id: P.A.versoes.exposicaoV1, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, numero: 1, status: 'publicada', titulo: 'Exposição na loja',
        publico_alvo: publico(['vendedor', 'promotor']), vigencia_inicio: CRIADO, perguntas: perguntasA, criada_em: CRIADO,
        publicada_em: PUBLICADO, publicada_por: A.analista,
      }),
      versao({
        id: P.A.versoes.exposicaoV2Rascunho, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, numero: 2, status: 'rascunho', titulo: 'Exposição na loja (v2)',
        publico_alvo: publico(['vendedor', 'promotor']), vigencia_inicio: CRIADO, perguntas: perguntasA.slice(0, 2), criada_em: RASCUNHO,
      }),
      versao({
        id: P.A.versoes.checkoutV1, tenant_id: tA, questionario_id: P.A.questionarios.checkout, numero: 1, status: 'publicada', titulo: 'Satisfação no checkout',
        modo: 'checkout_obrigatoria', publico_alvo: publico(['vendedor']), vigencia_inicio: CRIADO, vigencia_fim: '2099-12-31T03:59:59Z',
        perguntas: [{ id: PA.checkoutNota, tipo: 'escala', enunciado: 'Nota do atendimento', obrigatoria: true, minimo: 1, maximo: 5 }],
        criada_em: CRIADO, publicada_em: PUBLICADO, publicada_por: A.admin,
      }),
      versao({
        id: P.B.versoes.avulsaV1, tenant_id: tB, questionario_id: P.B.questionarios.avulsa, numero: 1, status: 'publicada', titulo: 'Avulsa do tenant B',
        frequencia: 'semanal', publico_alvo: publico([]), vigencia_inicio: CRIADO,
        perguntas: [
          { id: P.B.perguntas.simNao, tipo: 'sim_nao', enunciado: 'Loja aberta?', obrigatoria: true },
          { id: P.B.perguntas.foto, tipo: 'foto', enunciado: 'Fachada', obrigatoria: false, min_fotos: 1, max_fotos: 5 },
        ],
        criada_em: CRIADO, publicada_em: PUBLICADO, publicada_por: B.admin,
      }),
    ],
    'pesquisa.resposta': [
      {
        id: P.A.respostas.v1c1, tenant_id: tA, questionario_id: P.A.questionarios.exposicao, versao_id: P.A.versoes.exposicaoV1, usuario_id: A.vendedor,
        equipe_id: A.equipe, cliente_id: A.cliente, visita_id: null, respondida_em: instante(ontemA, '14:05'), recebida_em: instante(ontemA, '14:10'),
        suspeita: false, motivos_suspeita: '{}',
        itens: [
          { pergunta_id: PA.simNao, tipo: 'sim_nao', valor: true },
          { pergunta_id: PA.unica, tipo: 'unica', opcao_id: OA.boa },
          { pergunta_id: PA.multipla, tipo: 'multipla', opcao_ids: [OA.cafe, OA.feijao] },
          { pergunta_id: PA.numero, tipo: 'numero', numero: 12.5 },
          { pergunta_id: PA.texto, tipo: 'texto', texto: 'Gôndola organizada' },
          { pergunta_id: PA.escala, tipo: 'escala', valor: 4 },
          { pergunta_id: PA.data, tipo: 'data', data: P.A.dataRespondida },
          {
            pergunta_id: PA.foto, tipo: 'foto',
            fotos: [{ id: P.A.arquivos.fotoV1c1, referencia: P.A.arquivos.fotoV1c1, capturada_em: instante(ontemA, '14:00'), largura_px: 1600, altura_px: 1200 }],
          },
          { pergunta_id: PA.codigo, tipo: 'codigo_barras', codigo: '7891234567895' },
        ],
        ...comuns,
      },
      {
        id: P.B.respostas.c1, tenant_id: tB, questionario_id: P.B.questionarios.avulsa, versao_id: P.B.versoes.avulsaV1, usuario_id: B.vendedor,
        equipe_id: null, cliente_id: B.cliente, visita_id: null, respondida_em: instante(ontemB, '15:00'), recebida_em: instante(ontemB, '15:05'),
        suspeita: true, motivos_suspeita: '{RELOGIO_ADIANTADO}',
        itens: [
          { pergunta_id: P.B.perguntas.simNao, tipo: 'sim_nao', valor: false },
          { pergunta_id: P.B.perguntas.foto, tipo: 'foto', fotos: [{ id: P.B.arquivos.fotoC1, referencia: P.B.arquivos.fotoC1, capturada_em: instante(ontemB, '15:00') }] },
        ],
        ...comuns,
      },
    ],
  };
}
