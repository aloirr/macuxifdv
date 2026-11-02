import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvPct, pessoasParaCsv, trilhasParaCsv } from './csv';

describe('exportar CSV (RF-TRE-05, RF-TRE-01)', () => {
  it('RF-TRE-05: pessoas com nota em vírgula decimal, sem nota = vazio, hora no fuso do tenant', () => {
    const csv = pessoasParaCsv(
      [
        { usuario_id: '0b000000-0000-4000-8000-000000000001', nome: 'Ana; Silva', perfil: 'vendedor', equipe_id: null, licoes_no_mes: 3, trilhas_concluidas: 1, obrigatorias_pendentes: 0, nota_media_pct: 87.5, ultima_atividade_em: '2026-11-02T15:00:00Z' },
        { usuario_id: '0b000000-0000-4000-8000-000000000002', nome: 'Bruno', perfil: 'promotor', equipe_id: null, licoes_no_mes: 0, trilhas_concluidas: 0, obrigatorias_pendentes: 2, nota_media_pct: null, ultima_atividade_em: null },
      ],
      'America/Manaus',
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
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
