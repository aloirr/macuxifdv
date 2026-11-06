/** PDF do catálogo (RF-CAT-09): HTML A4 para `imprimirHtml`. Tudo escapado. */
import { COLUNAS, sumario, type Catalogo } from './layout';

export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface OpcoesPdf {
  empresa: string;
  tz: string;
  /** ISO em UTC. */
  gerado_em: string;
}

function partesData(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, texto: `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` };
}

const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function nomeArquivoCatalogo(opc: { sistema?: string; tz: string; gerado_em: string }): string {
  const s = opc.sistema ? slug(opc.sistema) || 'completo' : 'completo';
  return `catalogo-${s}-${partesData(opc.gerado_em, opc.tz).dia}`;
}

const CSS = `@page{size:A4;margin:14mm}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111}h1{font-size:18px;margin:0}h2{font-size:13px;margin:14px 0 4px}table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}.apl{white-space:pre-wrap}section{break-inside:auto}tr{break-inside:avoid}.sec{break-before:auto}`;

export function htmlDoCatalogo(catalogo: Catalogo, opc: OpcoesPdf): string {
  const e = escapeHtml;
  const sum = sumario(catalogo);
  const linhasSum = sum.linhas.map((l) => `<tr><td>${e(l.sistema)}</td><td>${e(l.grupo)}</td><td>${e(l.linha)}</td><td>${l.itens}</td></tr>`).join('');
  const secoes = catalogo
    .map((s) => {
      const corpo = s.itens
        .map((i) => `<tr><td>${e(i.codigo)}</td><td class="apl">${e(i.aplicacao)}</td><td>${e(i.oferece_junto.join(', '))}</td><td>${e(i.equivale_a.join(', '))}</td></tr>`)
        .join('');
      return `<section class="sec"><h2>${e(s.sistema)} › ${e(s.grupo)} › ${e(s.linha)}</h2><table><thead><tr>${COLUNAS.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></section>`;
    })
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Catálogo</title><style>${CSS}</style></head><body><header><h1>Catálogo de produtos</h1><div>${e(opc.empresa)} · Gerado em ${e(partesData(opc.gerado_em, opc.tz).texto)}</div></header><h2>Sumário</h2><table><thead><tr><th>Sistema</th><th>Grupo</th><th>Linha</th><th>Itens</th></tr></thead><tbody>${linhasSum}<tr><td colspan="3"><strong>Total</strong></td><td><strong>${sum.total}</strong></td></tr></tbody></table>${secoes}</body></html>`;
}
