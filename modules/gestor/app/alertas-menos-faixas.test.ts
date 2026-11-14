/** T-0166 / RD-0188: sem faixas "Sem conexão" nas telas do Gestão; Dispensar desligado sem sinal e Ficha/Ranking com a hora. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (n: string) => readFileSync(join(__dirname, 'screens', n), 'utf8');

describe('T-0166: menos alertas no Gestão', () => {
  it('RD-0188: nenhuma das 4 telas tem a faixa "Sem conexão:"', () => {
    for (const n of ['alertas-screen.tsx', 'aprovacoes-screen.tsx', 'ficha-screen.tsx', 'ranking-screen.tsx']) {
      expect(ler(n), n).not.toMatch(/Sem conexão:/);
    }
  });
  it('RD-0188: Dispensar fica desligado sem sinal e, ao tocar, diz "Sem sinal. Precisa de internet."', () => {
    const s = ler('alertas-screen.tsx');
    expect(s).toContain("'Sem sinal. Precisa de internet.'");
    expect(s).toMatch(/g\.offline \? \(/);
    expect(s).toMatch(/rotulo="Dispensar" nivel="neutro" desligado \/>/);
  });
  it('RD-0188: Ficha e Ranking mostram a hora da atualização no cabeçalho (SeloFaixa)', () => {
    expect(ler('ficha-screen.tsx')).toMatch(/direita: <SeloFaixa g=\{g\} \/>/);
    expect(ler('ranking-screen.tsx')).toMatch(/direita: <SeloFaixa g=\{g\} \/>/);
  });
  it('§5.2: as 5 telas usam o cabeçalho Azul noite do Screen, sem título próprio, BackLink nem SyncStamp', () => {
    for (const n of ['alertas-screen.tsx', 'aprovacoes-screen.tsx', 'equipe-screen.tsx', 'ficha-screen.tsx', 'ranking-screen.tsx']) {
      const s = ler(n);
      expect(s, n).toMatch(/cabecalho=\{/);
      expect(s, n).not.toMatch(/t\.h1|BackLink|SyncStamp/);
    }
  });
});
