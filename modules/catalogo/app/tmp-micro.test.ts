import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { expandirAplicacao } from '../domain/aplicacao';
import { tokensDeBuscaSemMemo, tokensDeBusca } from '../domain/texto';
import { pontuacaoTextual, type DocBusca } from '../domain/ranking';
const out = (m: string) => appendFileSync(process.env.MACUXI_PROGRESSO ?? 'NUL', m + '\n');
it('micro', () => {
  let s = 1;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const V = ['Uno', 'Palio', 'Gol', 'Fox', 'Celta', 'Corsa', 'Onix', 'Civic', 'Hilux', 'S10'];
  const docs: DocBusca[] = Array.from({ length: 400 }, (_, k) => {
    const t: string[] = []; let n = 0;
    while (n < 1950) { const de = 1995 + Math.floor(r() * 28); const x = `Fiat ${V[Math.floor(r() * 10)]} 1.0/1.4 ${de}–${de + 4} dianteiro motor flex`; t.push(x); n += x.length + 2; }
    return { id: String(k), sku: 'P' + k, ean: null, nome: 'Pastilha de freio ' + k, marca: 'Fremax', categoria: 'Auto', atributos: '', aplicacao: t.join('; '), referencias: [], estoque: 0, vendas: 0, campanha: false, preco_cents: null };
  });
  const tm = (nome: string, f: (d: DocBusca) => unknown) => { for (let i = 0; i < 2; i++) { const t = performance.now(); for (const d of docs) f(d); out(`${nome} v${i}: ${((performance.now() - t) / 400).toFixed(3)} ms`); } };
  tm('expandir', (d) => expandirAplicacao(d.aplicacao, { anoAtual: 2026 }));
  tm('tokens', (d) => tokensDeBuscaSemMemo(d.aplicacao));
  tm('tokensNome', (d) => tokensDeBusca(d.nome));
  const g = [['pastilha'], ['uno'], ['2012']];
  tm('pontuacao', (d) => pontuacaoTextual(g, d, { anoAtual: 2026 }));
  tm('pontuacao sem ano', (d) => pontuacaoTextual([['pastilha'], ['uno']], d, { anoAtual: 2026 }));
}, 120000);
