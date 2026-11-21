import { describe, expect, it } from 'vitest';
import type { AtividadeEnvio, TrilhaSyncLinha } from '../../contracts';
import { aplicarAtividade, resolverParametros, resumoDaJornada } from '../../domain';
import {
  atividadeDoEnvio,
  chaveDoRanking,
  conteudoDoAparelho,
  envioDaAtividade,
  estadoDasLinhas,
  idsDePrevia,
  lerLinhas,
  LINHAS_VAZIAS,
  parametrosDoAparelho,
  planejarEnvio,
  projetar,
  rotuloDoPrazo,
  textoDoTempo,
  type ItemDaFila,
  type LinhasTreinamento,
} from './estado';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = id(900);
const EU = id(901);
const OUTRO = id(902);
const TR = id(1);
const L1 = id(3);
const L2 = id(4);
const QUIZ = id(5);
const Q1 = id(6);
const CERTA = id(7);
const ERRADA = id(8);
const MARCO = '2026-11-01T12:00:00Z';
const p = resolverParametros();

const trilha = (extra: Partial<TrilhaSyncLinha> = {}): TrilhaSyncLinha => ({
  id: TR,
  tenant_id: TENANT,
  titulo: 'Boas-vindas',
  descricao: null,
  obrigatoria: true,
  sequencial: true,
  prazo: '2026-11-10',
  publico_alvo: { perfis: [], equipes: [] },
  status: 'publicada',
  publicada_em: MARCO,
  arquivada_em: null,
  created_at: MARCO,
  updated_at: MARCO,
  deleted_at: null,
  modulos: [
    {
      id: id(2),
      ordem: 1,
      titulo: 'Começo',
      pre_requisitos: [],
      licoes: [
        {
          id: L1,
          ordem: 1,
          titulo: 'Quem somos',
          tipo: 'texto',
          texto: 'Olá',
          midia_url: null,
          duracao_estimada_seg: null,
          pre_requisitos: [],
          quiz: null,
        },
        {
          id: L2,
          ordem: 2,
          titulo: 'Produtos',
          tipo: 'texto',
          texto: 'Linha',
          midia_url: null,
          duracao_estimada_seg: null,
          pre_requisitos: [],
          quiz: {
            id: QUIZ,
            questoes: [
              {
                id: Q1,
                ordem: 1,
                enunciado: '2 + 2?',
                alternativas: [
                  { id: CERTA, texto: '4', correta: true },
                  { id: ERRADA, texto: '5', correta: false },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
  ...extra,
});

const linhas = (extra: Partial<LinhasTreinamento> = {}): LinhasTreinamento => ({
  ...LINHAS_VAZIAS,
  trilhas: [trilha()],
  ...extra,
});
const aluno = { id: EU, perfil: 'vendedor', equipe_id: null };

const envioLicao = (n: number, licao: string, em: string): Extract<AtividadeEnvio, { tipo: 'licao' }> => ({
  tipo: 'licao',
  id: id(n),
  trilha_id: TR,
  licao_id: licao,
  concluida_em: em,
  tempo_gasto_seg: 45,
});
const envioQuiz = (n: number, alternativa: string, em: string): AtividadeEnvio => ({
  tipo: 'quiz',
  id: id(n),
  quiz_id: QUIZ,
  realizada_em: em,
  respostas: [{ questao_id: Q1, alternativa_ids: [alternativa] }],
});
const item = (
  payload: AtividadeEnvio,
  situacao = 'pendente',
  extra: Partial<ItemDaFila> = {},
): ItemDaFila => ({
  id: payload.id,
  modulo: 'treinamento',
  entidade: 'progresso',
  payload,
  situacao,
  ultimo_erro: '',
  ...extra,
});

describe('estado do aparelho (offline-first, RN-TRE-04)', () => {
  it('RN-TRE-04: lê só as linhas vivas do motor', async () => {
    const motor = {
      linhas: async (e: string) =>
        (e === 'trilha' ? [trilha(), trilha({ id: id(77), deleted_at: MARCO })] : []) as never[],
    };
    const l = await lerLinhas(motor);
    expect(l.trilhas.map((t) => t.id)).toEqual([TR]);
  });

  it('RN-TRE-07: rascunho nunca entra no conteúdo do aparelho; arquivada entra (conta na medalha)', () => {
    const c = conteudoDoAparelho({
      trilhas: [
        trilha(),
        trilha({ id: id(70), status: 'rascunho' }),
        trilha({ id: id(71), status: 'arquivada' }),
      ],
    });
    expect(c.trilhas.map((t) => [t.id, t.status])).toEqual([
      [TR, 'publicada'],
      [id(71), 'arquivada'],
    ]);
    expect(c.quizzes.map((q) => q.licao_id)).toEqual([L2, L2]);
  });

  it('RN-TRE-07: trilha de equipe que o servidor mandou aparece na prévia mesmo sem a equipe no login', () => {
    const t = trilha({ publico_alvo: { perfis: ['vendedor'], equipes: [id(80)] } });
    const c = conteudoDoAparelho({ trilhas: [t] });
    expect(c.trilhas[0]!.publico_alvo).toEqual({ perfis: [], equipes: [] });
    const r = aplicarAtividade(estadoDasLinhas({ ...LINHAS_VAZIAS, trilhas: [t] }, aluno), { tipo: 'licao', id: id(81), trilha_id: TR, licao_id: L1, tempo_gasto_seg: 60, concluida_em: MARCO }, c, { gerarId: () => id(82), params: p });
    expect(r.resultado.status).toBe('aceito');
  });

  it('RN-TRE-04: o estado vem só das linhas do próprio aluno', () => {
    const progresso = [EU, OUTRO].map((u, i) => ({
      id: id(30 + i),
      tenant_id: TENANT,
      usuario_id: u,
      trilha_id: TR,
      licao_id: L1,
      concluida_em: MARCO,
      tempo_gasto_seg: 40,
      updated_at: MARCO,
      deleted_at: null,
    }));
    const e = estadoDasLinhas(linhas({ progresso }), aluno);
    expect(e.conclusoes.map((c) => c.id)).toEqual([id(30)]);
    expect(e).toMatchObject({
      tenant_id: TENANT,
      usuario_id: EU,
      usuario: { perfil: 'vendedor', equipe_id: null },
    });
  });

  it('RN-TRE-01: a fila do aparelho entra na prévia — XP, nível e trilha concluída aparecem sem sinal', () => {
    const estado = estadoDasLinhas(linhas(), aluno);
    const conteudo = conteudoDoAparelho(linhas());
    const fila = [
      item(envioLicao(10, L1, '2026-11-01T13:00:00Z')),
      item(envioQuiz(11, CERTA, '2026-11-01T13:05:00Z')),
      item(envioLicao(12, L2, '2026-11-01T13:06:00Z')),
    ];
    const proj = projetar(estado, conteudo, fila, p);
    expect(proj.na_fila).toBe(3);
    const j = resumoDaJornada(proj.estado, conteudo, { hoje: '2026-11-01', params: p });
    // 10 + 2 (streak) + 5 (acerto) + 10 + 50 (trilha)
    expect(j.xp_total).toBe(77);
    expect(j.trilhas[0]).toMatchObject({ concluida: true, progresso_pct: 100 });
    expect(
      j.medalhas
        .filter((m) => m.conquistada_em)
        .map((m) => m.codigo)
        .sort(),
    ).toEqual(['nota_maxima', 'primeira_trilha']);
  });

  it('RN-TRE-04: aceito que o pull já trouxe não conta duas vezes; recusado pelo servidor fica fora da prévia com a mensagem', () => {
    const envio = envioLicao(10, L1, '2026-11-01T13:00:00Z');
    const progresso = [
      {
        id: id(10),
        tenant_id: TENANT,
        usuario_id: EU,
        trilha_id: TR,
        licao_id: L1,
        concluida_em: '2026-11-01T13:00:00Z',
        tempo_gasto_seg: 45,
        updated_at: MARCO,
        deleted_at: null,
      },
    ];
    const l = linhas({ progresso });
    const proj = projetar(
      estadoDasLinhas(l, aluno),
      conteudoDoAparelho(l),
      [
        item(envio, 'aceito'),
        item(envioLicao(12, L2, '2026-11-01T13:06:00Z'), 'falhou', { ultimo_erro: 'Passe no quiz.' }),
      ],
      p,
    );
    expect(proj.estado.conclusoes).toHaveLength(1);
    expect(proj.na_fila).toBe(0);
    expect(proj.recusadas).toEqual([{ id: id(12), mensagem: 'Passe no quiz.' }]);
  });

  it('RN-TRE-04: item de outro módulo ou com payload inválido é ignorado', () => {
    const estado = estadoDasLinhas(linhas(), aluno);
    const proj = projetar(
      estado,
      conteudoDoAparelho(linhas()),
      [
        { ...item(envioLicao(10, L1, '2026-11-01T13:00:00Z')), modulo: 'vendedor' },
        { ...item(envioLicao(11, L1, '2026-11-01T13:00:00Z')), payload: { tipo: 'licao' } },
      ],
      p,
    );
    expect(proj.estado.conclusoes).toHaveLength(0);
    expect(proj.na_fila).toBe(1);
  });

  it('RN-TRE-04: envio ↔ atividade sem perder campo', () => {
    for (const e of [
      envioLicao(10, L1, '2026-11-01T13:00:00Z'),
      envioQuiz(11, CERTA, '2026-11-01T13:05:00Z'),
    ])
      expect(envioDaAtividade(atividadeDoEnvio(e))).toEqual(e);
  });
});

describe('planejarEnvio — confere no aparelho antes de enfileirar (RN-TRE-02, RN-TRE-04)', () => {
  const estado = () => estadoDasLinhas(linhas(), aluno);
  const conteudo = () => conteudoDoAparelho(linhas());
  const opcoes = { gerarId: idsDePrevia(), params: p };

  it('RN-TRE-04: lição abaixo do tempo mínimo não vai para a fila e traz a mensagem do domain', () => {
    const plano = planejarEnvio(
      estado(),
      conteudo(),
      [atividadeDoEnvio({ ...envioLicao(10, L1, '2026-11-01T13:00:00Z'), tempo_gasto_seg: 5 })],
      opcoes,
    );
    expect(plano.enviar).toEqual([]);
    expect(plano.recusa).toMatchObject({ codigo: 'TEMPO_MINIMO' });
  });

  it('RN-TRE-02: quiz aprovado + lição → as duas vão para a fila, na ordem', () => {
    const base = planejarEnvio(
      estado(),
      conteudo(),
      [atividadeDoEnvio(envioLicao(10, L1, '2026-11-01T13:00:00Z'))],
      opcoes,
    ).estado;
    const plano = planejarEnvio(
      base,
      conteudo(),
      [
        atividadeDoEnvio(envioQuiz(11, CERTA, '2026-11-01T13:05:00Z')),
        atividadeDoEnvio(envioLicao(12, L2, '2026-11-01T13:05:00Z')),
      ],
      opcoes,
    );
    expect(plano.enviar.map((a) => a.id)).toEqual([id(11), id(12)]);
    expect(plano.recusa).toBeNull();
  });

  it('RN-TRE-02: quiz reprovado vai para a fila (conta a tentativa); a lição para em QUIZ_PENDENTE e não vai', () => {
    const base = planejarEnvio(
      estado(),
      conteudo(),
      [atividadeDoEnvio(envioLicao(10, L1, '2026-11-01T13:00:00Z'))],
      opcoes,
    ).estado;
    const plano = planejarEnvio(
      base,
      conteudo(),
      [
        atividadeDoEnvio(envioQuiz(11, ERRADA, '2026-11-01T13:05:00Z')),
        atividadeDoEnvio(envioLicao(12, L2, '2026-11-01T13:05:00Z')),
      ],
      opcoes,
    );
    expect(plano.enviar.map((a) => a.id)).toEqual([id(11)]);
    expect(plano.recusa).toMatchObject({ codigo: 'QUIZ_PENDENTE' });
  });

  it('RN-TRE-04: lição já concluída (duplicada) não é reenviada', () => {
    const base = planejarEnvio(
      estado(),
      conteudo(),
      [atividadeDoEnvio(envioLicao(10, L1, '2026-11-01T13:00:00Z'))],
      opcoes,
    ).estado;
    expect(
      planejarEnvio(base, conteudo(), [atividadeDoEnvio(envioLicao(13, L1, '2026-11-01T14:00:00Z'))], opcoes)
        .enviar,
    ).toEqual([]);
  });
});

describe('parâmetros e textos', () => {
  it('RN-TRE-04: parâmetro inválido do tenant cai no padrão; o fuso do login prevalece', () => {
    expect(parametrosDoAparelho({ segundos_minimos_licao: -1 }).segundos_minimos_licao).toBe(30);
    expect(parametrosDoAparelho({ segundos_minimos_licao: 60 }).segundos_minimos_licao).toBe(60);
    expect(parametrosDoAparelho({}, 'America/Sao_Paulo').fuso).toBe('America/Sao_Paulo');
    expect(parametrosDoAparelho({}, 'Fuso/Inexistente').fuso).toBe('America/Manaus');
    expect(parametrosDoAparelho({}, null).fuso).toBe('America/Manaus');
  });

  it('RN-TRE-02: fuso do login inválido faz o app cair no padrão em tudo, como a API', () => {
    expect(parametrosDoAparelho({ segundos_minimos_licao: 60 }, 'Fuso/Inexistente').segundos_minimos_licao).toBe(30);
  });

  it('RF-TRE-01: rótulo do prazo da trilha obrigatória', () => {
    const base = { prazo: '2026-11-10', atrasada: false, concluida: false };
    expect(rotuloDoPrazo({ ...base, dias_para_prazo: 0 })).toBe('Vence hoje');
    expect(rotuloDoPrazo({ ...base, dias_para_prazo: 1 })).toBe('Vence amanhã');
    expect(rotuloDoPrazo({ ...base, dias_para_prazo: 5 })).toBe('Vence em 5 dias');
    expect(rotuloDoPrazo({ ...base, atrasada: true, dias_para_prazo: -2 })).toBe('Atrasada há 2 dias');
    expect(rotuloDoPrazo({ ...base, concluida: true, dias_para_prazo: 1 })).toBeNull();
    expect(
      rotuloDoPrazo({ prazo: null, atrasada: false, concluida: false, dias_para_prazo: null }),
    ).toBeNull();
  });

  it('cronômetro e chave do ranking', () => {
    expect(textoDoTempo(65)).toBe('1:05');
    expect(textoDoTempo(-3)).toBe('0:00');
    expect(chaveDoRanking('semanal', 'geral')).toBe('ranking:semanal:geral');
  });
});
