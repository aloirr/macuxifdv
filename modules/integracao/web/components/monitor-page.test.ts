import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('monitor-page: botão Atualizar (R-20261120-090347)', () => {
  const fonte = readFileSync(new URL('./monitor-page.tsx', import.meta.url), 'utf8');
  const botao = fonte.slice(fonte.indexOf('<Button'), fonte.indexOf('</Button>'));

  it('R-20261120-090347: o rótulo é sempre "Atualizar", inclusive durante a busca', () => {
    expect(botao).toMatch(/>\s*Atualizar\s*$/);
    expect(botao).not.toMatch(/isFetching\s*\?/);
  });

  it('R-20261120-090347: o botão fica desligado durante a busca', () => {
    expect(botao).toMatch(/disabled=\{monitor\.isFetching\}/);
  });

  it('R-20261120-090347: "Atualizando" e "Sem resposta" não aparecem na página', () => {
    expect(fonte).not.toMatch(/Atualizando/);
    expect(fonte).not.toMatch(/Sem resposta/);
  });
});

describe('monitor-page: um só ClienteIntegracaoProvider no BKO (engenheiro-apps v1.0.31)', () => {
  const pagina = readFileSync(new URL('./monitor-page.tsx', import.meta.url), 'utf8');
  const painel = readFileSync(new URL('./monitor-painel.tsx', import.meta.url), 'utf8');

  it('RF-INT-04: a página passa o cliente ao `useMonitor` e ao painel; só o painel monta o provider', () => {
    expect(pagina).not.toMatch(/ClienteIntegracaoProvider/);
    expect(pagina).toMatch(/useMonitor\(cliente\)/);
    expect(pagina).toMatch(/<MonitorPainel cliente=\{cliente\}/);
    expect(painel.match(/<ClienteIntegracaoProvider/g)).toHaveLength(1);
  });
});
