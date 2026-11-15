/**
 * Filtro padrão do Campo (R-20261115-072200/074500/082500; docs/design/filtro-padrao-campo/spec.md): Rota, Clientes e
 * Performance. Valor × regra dos textos da tela (subtítulo, título, botão da folha, etiqueta) com "hoje" no fuso do tenant,
 * e a costura: as telas desenham o que o domínio calcula, sem regra própria.
 */
import { describe, expect, it } from 'vitest';
import { dataLocal } from '../../../modules/core/domain';
import { textoDosDiasUteis } from '../../../modules/core/app/telas/performance/cards-performance';
import { contarFiltros, intervaloDaSelecao, rotuloDoPeriodo, SELECAO_PADRAO } from '../../../modules/core/app/telas/performance/periodo-performance';
import { existe, importar, ler } from '../apoio/v1013';

const DOMINIO = 'modules/core/domain/filtro-padrao.ts';
const COM_FILTRO = existe(DOMINIO);

interface Parada {
  sequence: number;
  status: string;
  customer: { trade_name: string; erp_code?: string; city: string; district: string };
}
interface Filtro {
  cliente: string;
  cidade: string | null;
  bairro: string | null;
  data: string | null;
}
interface FiltroPadrao {
  FILTRO_ROTA_PADRAO: Filtro;
  comData(f: Filtro, data: string, hoje: string): Filtro;
  comCidade(f: Filtro, cidade: string | null, p: readonly Parada[]): Filtro;
  bairrosDaRota(p: readonly Parada[], cidade: string | null): string[];
  filtrarParadas<T extends Parada>(p: readonly T[], f: Filtro): T[];
  contarFiltrosRota(f: Filtro): number;
  tituloDaRota(f: Filtro): string;
  etiquetasDaRota(f: Filtro): Array<{ texto: string }>;
  subtituloDaRota(o: { filtradas: number; total: number; totalKm: number; regiao: string; comFiltro: boolean }): string;
  textoDasFeitas(p: readonly Parada[]): string;
  textoVerVisitas(n: number): string;
  textoVerClientes(n: number): string;
  subtituloDaCarteira(filtrados: number, total: number): string | undefined;
  situacaoNaLinha(s: string, garantidas: readonly string[]): string | null;
}

const FUSO = 'America/Boa_Vista';
const LUGAR: Record<number, [string, string]> = { 2: ['Boa Vista', 'Centro'], 5: ['Boa Vista', 'Centro'], 7: ['Boa Vista', 'Centro'], 9: ['Boa Vista', 'Centro'], 3: ['Boa Vista', 'Caçari'], 4: ['Mucajaí', 'Centro'] };
const ROTA: Parada[] = Array.from({ length: 12 }, (_, i) => {
  const [city, district] = LUGAR[i + 1] ?? ['Cantá', 'Vila'];
  return { sequence: i + 1, status: i + 1 === 2 || i + 1 === 7 || i + 1 === 1 ? 'done' : 'pending', customer: { trade_name: `Cliente ${i + 1}`, city, district } };
});

describe('Filtro padrão do Campo — Rota, Clientes e Performance', () => {
  if (!COM_FILTRO) {
    it('antes do PR: a Rota não tem filtro', () => {
      expect(ler('modules/core/app/telas/rota.tsx')).not.toContain('BotaoFiltro');
    });
    return;
  }

  it('Rota: o padrão é hoje no fuso do tenant e não conta; outra data vira "Rota de ter, 17/11" e conta 1', async () => {
    const d = await importar<FiltroPadrao>(DOMINIO);
    const hoje = dataLocal(new Date('2026-11-17T03:30:00Z'), FUSO);
    expect(hoje).toBe('2026-11-16');
    const voltouParaHoje = d.comData(d.FILTRO_ROTA_PADRAO, hoje, hoje);
    expect([d.contarFiltrosRota(voltouParaHoje), d.tituloDaRota(voltouParaHoje), d.etiquetasDaRota(voltouParaHoje)]).toEqual([0, 'Rota de hoje', []]);
    const terca = d.comData(d.FILTRO_ROTA_PADRAO, '2026-11-17', hoje);
    expect([d.contarFiltrosRota(terca), d.tituloDaRota(terca), d.etiquetasDaRota(terca).map((e) => e.texto)]).toEqual([1, 'Rota de ter, 17/11', ['Ter, 17/11']]);
  });

  it('Rota: com cidade e bairro, "4 de 12 visitas · 38 km" sem a região, a numeração da rota e "Ver 4 visitas"', async () => {
    const d = await importar<FiltroPadrao>(DOMINIO);
    const f = { ...d.comCidade(d.FILTRO_ROTA_PADRAO, 'Boa Vista', ROTA), bairro: 'Centro' };
    const vistas = d.filtrarParadas(ROTA, f);
    const sub = (comFiltro: boolean) => d.subtituloDaRota({ filtradas: vistas.length, total: ROTA.length, totalKm: 37.6, regiao: 'Centro-Sul', comFiltro });
    expect(sub(d.contarFiltrosRota(f) > 0)).toBe('4 de 12 visitas · 38 km');
    expect(sub(false)).toBe('12 visitas · 38 km · Centro-Sul');
    expect(vistas.map((p) => p.sequence)).toEqual([2, 5, 7, 9]);
    expect([d.textoDasFeitas(vistas), d.textoVerVisitas(vistas.length), d.textoVerVisitas(1)]).toEqual(['2 feitas', 'Ver 4 visitas', 'Ver 1 visita']);
  });

  it('Rota: o bairro segue a cidade; trocar a cidade tira o bairro que não é dela', async () => {
    const d = await importar<FiltroPadrao>(DOMINIO);
    expect(d.bairrosDaRota(ROTA, 'Boa Vista')).toEqual(['Caçari', 'Centro']);
    const f = { ...d.comCidade(d.FILTRO_ROTA_PADRAO, 'Boa Vista', ROTA), bairro: 'Caçari' };
    expect(d.comCidade(f, 'Mucajaí', ROTA).bairro).toBeNull();
    expect(d.comCidade({ ...f, bairro: 'Centro' }, 'Mucajaí', ROTA).bairro).toBe('Centro');
  });

  it('Clientes: "5 de 20 na carteira", "Ver 1 cliente", carteira vazia sem subtítulo (RD-0501) e a etiqueta filtrada não se repete (RD-0500)', async () => {
    const d = await importar<FiltroPadrao>(DOMINIO);
    expect([d.subtituloDaCarteira(5, 20), d.subtituloDaCarteira(20, 20), d.subtituloDaCarteira(0, 0)]).toEqual(['5 de 20 na carteira', '20 na carteira', undefined]);
    expect([d.textoVerClientes(1), d.textoVerClientes(5)]).toEqual(['Ver 1 cliente', 'Ver 5 clientes']);
    expect([d.situacaoNaLinha('devendo', ['devendo']), d.situacaoNaLinha('bloqueado', ['devendo'])]).toEqual([null, 'bloqueado']);
  });

  it('Performance: o padrão é o mês, não conta e se chama "Novembro de 2026"; dia não útil diz "Não é dia útil" (RD-0502); virada de mês', () => {
    expect([contarFiltros(SELECAO_PADRAO), rotuloDoPeriodo(SELECAO_PADRAO, '2026-11-15'), rotuloDoPeriodo(SELECAO_PADRAO, '2026-12-01')]).toEqual([0, 'Novembro de 2026', 'Dezembro de 2026']);
    expect(rotuloDoPeriodo({ tipo: 'atalho', id: 'mes_passado' }, '2027-01-01')).toBe('Dezembro de 2026');
    const nov = intervaloDaSelecao(SELECAO_PADRAO, '2026-11-15');
    expect(textoDosDiasUteis({ du_hoje: null, du_total: 21, du_restantes: 11 } as Parameters<typeof textoDosDiasUteis>[0], nov, '2026-11-15')).toBe('Não é dia útil · 11 restantes');
    expect(textoDosDiasUteis({ du_hoje: 10, du_total: 21, du_restantes: 11 } as Parameters<typeof textoDosDiasUteis>[0], nov, '2026-11-16')).toBe('DU 10 de 21 · 11 restantes');
  });

  it('costura: as telas usam o domínio (contagem, subtítulos, título, botões) e numeram pela sequência da rota', () => {
    const rota = ler('modules/core/app/telas/rota.tsx');
    expect(rota).toContain('const stops = filtrarParadas(route.stops, filtro)');
    expect(rota).toContain('comFiltro: contagem > 0');
    expect(rota).toContain('const titulo = tituloDaRota(filtro)');
    expect(rota).toContain('linhaDeCima(stops)');
    expect(rota).toContain('{String(s.sequence)}');
    const clientes = ler('modules/core/app/telas/clientes.tsx');
    expect(clientes).toContain('subtitulo={subtituloDaCarteira(');
    expect(clientes).toContain('situacaoNaLinha(');
    for (const tela of [rota, clientes]) expect(tela).not.toMatch(/`Ver \$\{|na carteira`|visitas`/);
  });
});
