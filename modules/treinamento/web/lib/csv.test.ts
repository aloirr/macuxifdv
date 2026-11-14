import { describe, expect, it } from 'vitest';
import { BOM_CSV } from '@macuxi/comum/csv';
import { csvPct, pessoasParaCsv, trilhasParaCsv } from './csv';

describe('exportar CSV (RF-TRE-05, RF-TRE-01)', () => {
  it('RF-TRE-05: pessoas com nota em vírgula decimal, sem nota = vazio, hora no fuso do tenant', () => {
    const csv = pessoasParaCsv(
      [
        { usuario_id: '0b000000-0000-4000-8000-000000000001', nome: 'Ana; Silva', perfil: 'vendedor', equipe_id: null, licoes_no_mes: 3, trilhas_concluidas: 1, obrigatorias_pendentes: 0, nota_media_pct: 87.5, ultima_atividade_em: '2026-11-02T15:00:00Z' },
        { usuario_id: '0b000000-0000-4000-8000-000000000002', nome: 'Bruno', perfil: 'promotor', equipe_id: null, licoes_no_mes: 0, trilhas_concluidas: 0, obrigatorias_pendentes: 2, nota_media_pct: null, ultima_atividade_em: null },
      ],
      'America/Manaus',
    );
    expect(csv.startsWith(BOM_CSV)).toBe(true);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('Pessoa;Perfil;Lições no mês;Trilhas concluídas;Obrigatórias pendentes;Nota média (%);Última atividade');
    expect(linhas[1]).toMatch(/^"Ana; Silva";Vendedor;3;1;0;87,50;02\/11\/2026/);
    expect(linhas[1]).toContain('11:00');
    expect(linhas[2]).toBe('Bruno;Promotor;0;0;2;;');
  });

  it('RF-TRE-01: trilhas com público por extenso', () => {
    const csv = trilhasParaCsv([
      { id: '00000000-0000-4000-8000-000000000001', titulo: 'Boas-vindas', status: 'publicada', obrigatoria: true, prazo: '2026-11-30', modulos: 2, licoes: 5, quizzes: 1, publico_perfis: [], publico_equipes: 0, publicada_em: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z' },
      { id: '00000000-0000-4000-8000-000000000002', titulo: 'Gôndola', status: 'rascunho', obrigatoria: false, prazo: null, modulos: 1, licoes: 1, quizzes: 0, publico_perfis: ['promotor', 'supervisor'], publico_equipes: 2, publicada_em: null, updated_at: '2026-11-01T12:00:00Z' },
    ]);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[1]).toBe('Boas-vindas;Publicada;Sim;2026-11-30;2;5;1;Todos;Todas');
    expect(linhas[2]).toBe('Gôndola;Rascunho;Não;;1;1;0;Promotor, Supervisor;2');
  });

  it('RF-TRE-05: percentual sem dado (público vazio) fica em branco', () => {
    expect(csvPct(null)).toBe('');
    expect(csvPct(100)).toBe('100,00');
  });
});

describe('RD-0051: saída do CSV byte a byte', () => {
  const pessoa = (nome: string, nota: number | null) => ({ usuario_id: '0b000000-0000-4000-8000-000000000001', nome, perfil: 'vendedor' as const, equipe_id: null, licoes_no_mes: 1, trilhas_concluidas: 2, obrigatorias_pendentes: 3, nota_media_pct: nota, ultima_atividade_em: null });

  it('RD-0051: BOM, ; , CRLF, aspas, nomes com cara de fórmula e vírgula decimal', () => {
    const csv = pessoasParaCsv(
      [pessoa('Ana "Aninha"; Silva', 87.5), pessoa('=1+1', 33.333), pessoa('+Davi', 0), pessoa('@Caio', null), pessoa('-Bia\r\nLinha', 10)],
      'America/Manaus',
    );
    expect(csv).toBe(
      '\uFEFF' +
        'Pessoa;Perfil;Lições no mês;Trilhas concluídas;Obrigatórias pendentes;Nota média (%);Última atividade\r\n' +
        '"Ana ""Aninha""; Silva";Vendedor;1;2;3;87,50;\r\n' +
        '=1+1;Vendedor;1;2;3;33,33;\r\n' +
        '+Davi;Vendedor;1;2;3;0,00;\r\n' +
        '@Caio;Vendedor;1;2;3;;\r\n' +
        '"-Bia\r\nLinha";Vendedor;1;2;3;10,00;\r\n',
    );
  });
});
