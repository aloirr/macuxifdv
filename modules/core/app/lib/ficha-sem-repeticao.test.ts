import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('T-0146: ficha do cliente sem dado repetido', () => {
  it('app: o topo não traz limite nem vencidos; só o Financeiro traz', () => {
    const tela = ler('app/telas/cliente.tsx');
    expect(tela).not.toContain('Limite disponível');
    expect(tela).not.toContain('label="Títulos vencidos"');
    const c360 = ler('app/components/cliente360.tsx');
    expect(c360.match(/label="Limite"/g)).toHaveLength(1);
    expect(c360.match(/label="Vencidos"/g)).toHaveLength(1);
  });
  it('14/11: Resumo tem Compras no mês e Última compra; média, ticket, frequência e 12 meses só na aba Compras; sem lista de títulos', () => {
    const c360 = ler('app/components/cliente360.tsx');
    const tela = ler('app/telas/cliente.tsx');
    for (const l of ['Compras no mês', 'Última compra', 'Compra média/mês', 'Ticket médio', 'Frequência média', 'Compras em 12 meses']) {
      expect(c360.match(new RegExp(`label="${l}"`, 'g'))).toHaveLength(1);
    }
    expect(c360.indexOf('label="Compras no mês"')).toBeLessThan(c360.indexOf('export function AbaCompras'));
    expect(c360.indexOf('label="Compra média/mês"')).toBeGreaterThan(c360.indexOf('export function AbaCompras'));
    expect(c360).toContain('title="Histórico de Pedidos"');
    expect(c360).not.toContain('Compras dos últimos 12 meses');
    expect(c360).not.toContain('situacao_calculada');
    expect(tela).not.toContain('Últimos pedidos');
  });
  it('14/11: sem tag Positivado nem "Curva X" solta; segmento é dado de cadastro e a filial é um cartão "Filial"', () => {
    const c360 = ler('app/components/cliente360.tsx');
    const tela = ler('app/telas/cliente.tsx');
    expect(tela).not.toMatch(/Positivado|positivated/);
    expect(tela).not.toContain('abc_curve');
    expect(c360).not.toContain('<Badge label={c.segmento}');
    expect(c360).toContain('label="Segmento"');
    expect(c360).toContain('label="Filial" value={ficha.filial_rotulo}');
    expect(c360).not.toContain('Filial: ');
  });
  it('BKO: limite, crédito e vencidos só no painel Financeiro', () => {
    const web = ler('web/components/cliente360/cliente360-page.tsx');
    expect(web.match(/label="Crédito disponível"/g)).toHaveLength(1);
    expect(web.match(/label="Vencidos"/g)).toHaveLength(1);
    expect(web.indexOf('label="Vencidos"')).toBeGreaterThan(web.indexOf('<Panel title="Financeiro">'));
  });
  it('RD-0065: o selo Bloqueado fica no cabeçalho; o Financeiro só traz o motivo (app e BKO)', () => {
    const c360 = ler('app/components/cliente360.tsx');
    const web = ler('web/components/cliente360/cliente360-page.tsx');
    for (const src of [c360, web]) {
      expect(src.match(/Bloqueado["<]/g)).toHaveLength(1);
      expect(src).toContain('Motivo do bloqueio:');
      expect(src).toContain('fin.motivo_bloqueio ?');
    }
  });
  it('RD-0075: o selo Cadastro incompleto não repete a linha das Observações na ficha (app e BKO)', () => {
    expect(ler('app/components/cliente360.tsx')).not.toContain('EtiquetaCadastroIncompleto');
    expect(ler('web/components/cliente360/cliente360-page.tsx')).not.toContain('EtiquetaCadastroIncompleto');
  });
});
