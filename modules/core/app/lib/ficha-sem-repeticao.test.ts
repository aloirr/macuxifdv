import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('T-0186: ficha do cliente v2 (Resumo, Histórico e Documentação)', () => {
  it('R-20261119-0440: nenhum alerta financeiro na ficha (sem Vencidos, sem selo Bloqueado, sem "Última compra" nem mix)', () => {
    const fontes = ['app/telas/cliente.tsx', 'app/components/aba-resumo.tsx', 'app/components/aba-historico.tsx', 'app/components/aba-documentacao.tsx', 'app/components/cliente360.tsx'].map(ler).join('\n');
    for (const proibido of ['label="Vencidos"', 'Títulos vencidos', 'Limite disponível', 'Última compra', 'Sugestão de mix', 'Badge label="Bloqueado"', 'situacao_calculada']) {
      expect(fontes).not.toContain(proibido);
    }
  });
  it('T-0146: sem Positivado nem tag de curva solta (as curvas são linhas da Performance)', () => {
    const fontes = ler('app/telas/cliente.tsx') + ler('app/components/aba-resumo.tsx');
    expect(fontes).not.toMatch(/Positivado|positivated|abc_curve/);
    expect(fontes).not.toContain('<Badge label={c.rotulo}');
  });
  it('spec §3: a ficha tem três abas fixas, sem faixa rolável', () => {
    const tela = ler('app/telas/cliente.tsx');
    expect(tela).toContain('abasDoApp(locais.perfil, locais.verPedidos)');
    expect(tela).not.toMatch(/<Abas[^>]*rolavel/);
  });
  it('spec §3: Resumo na ordem Dados cadastrais · crédito · Endereços · Contatos · Performance', () => {
    const r = ler('app/components/aba-resumo.tsx');
    const ordem = ['title="Dados cadastrais"', 'cliente-credito', 'title="Endereços"', 'title="Contatos"', 'title={perf.titulo}'].map((x) => r.indexOf(x));
    expect(ordem.every((n) => n > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
  it('spec §3: toda lista é tabela com cabeçalho (notas, documentos, contatos, endereços e itens)', () => {
    for (const f of ['aba-resumo', 'aba-historico', 'aba-documentacao']) expect(ler(`app/components/${f}.tsx`)).toContain('<TabelaDados');
    expect(ler('app/components/aba-historico.tsx')).toContain("titulo: 'Nº NF'");
  });
  it('P15 e P17: nada é baixado nem guardado (sem gravar em disco, SQLite ou fila)', () => {
    const fontes = ler('app/lib/ficha-online.ts') + ler('app/lib/usar-ficha-online.ts');
    expect(fontes).not.toMatch(/FileSystem|writeFile|AsyncStorage|motor\.gravar|enfileirar|download/i);
  });
  it('RD-0075: o selo Cadastro incompleto não repete a linha das Observações na ficha', () => {
    expect(ler('app/components/aba-resumo.tsx')).not.toContain('EtiquetaCadastroIncompleto');
  });
});
