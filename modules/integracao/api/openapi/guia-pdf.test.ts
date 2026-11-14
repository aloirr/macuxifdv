import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTIDADES, ROTAS_HUB } from '../../contracts';
import { PARAMETROS_PADRAO } from '../../domain';
import { DEPENDENCIAS } from '../../domain/ordem';
import { gerarOpenApiHub } from './gerar';
import { CAMPOS_SEM_TEXTO, entradasDoSumario, hashDoGuia, montarHtml, RECURSOS_VAZIOS, secoesDoGuia } from './guia-pdf';

const doc = gerarOpenApiHub();
const secoes = secoesDoGuia(doc);
const html = montarHtml(secoes, RECURSOS_VAZIOS);
const texto = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
const arquivo = (nome: string) => fileURLToPath(new URL(`../../docs/${nome}`, import.meta.url));

describe('Guia da API em PDF (docs/guia-api-hub.pdf)', () => {
  it('tem sumário com todas as seções, na ordem, e cada entrada aponta para uma seção', () => {
    expect(html).toContain('<h2>Sumário</h2>');
    for (const id of entradasDoSumario(secoes)) {
      expect(html, id).toContain(`<a href="#${id}"`);
      expect(html, id).toMatch(new RegExp(`id="${id}"`));
    }
    const numeros = secoes.map((s) => s.numero);
    expect(numeros.slice(0, 7)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('cobre o primeiro envio ao retorno: credencial, autenticação, ordem de carga, envio, pedidos e status', () => {
    const passo = secoes.find((s) => s.id === 'passo-a-passo')?.html ?? '';
    for (const t of ['Passo 1. Obter a credencial', 'Passo 2. Autenticar', 'Passo 3. Respeitar a ordem de carga', 'Passo 4. Fazer o primeiro envio', 'Passo 5. Buscar os pedidos', 'Passo 6. Devolver o status']) {
      expect(passo, t).toContain(t);
    }
  });

  it('tem uma seção por operação do OpenAPI, com método, caminho, exemplo JSON e tabela de campos', () => {
    const operacoes = Object.entries(doc.paths).flatMap(([caminho, ops]) => Object.entries(ops).map(([metodo, op]) => ({ caminho, metodo, id: (op as { operationId: string }).operationId })));
    expect(operacoes).toHaveLength(7);
    for (const o of operacoes) {
      const s = secoes.find((x) => x.id === `rota-${o.id}`);
      expect(s, o.id).toBeDefined();
      expect(s?.html, o.id).toContain(`/integracao/v1${o.caminho}`.replace('{', '{').replace('}', '}'));
      expect(s?.html, o.id).toContain(`>${o.metodo.toUpperCase()}</span>`);
      expect(s?.html, o.id).toContain('<pre');
      expect(s?.html, o.id).toContain('<table class="campos">');
    }
  });

  it('o Anexo A traz as 16 entidades e todos os campos de cada registro do OpenAPI', () => {
    const env = doc.components.schemas['LoteEnvelope'] as Record<string, unknown>;
    const por = env['x-macuxi-registro-por-entidade'] as Record<string, { $ref: string }>;
    for (const e of ENTIDADES) {
      const s = secoes.find((x) => x.id === `entidade-${e}`);
      expect(s, e).toBeDefined();
      const schema = doc.components.schemas[(por[e] as { $ref: string }).$ref.split('/').pop() as string] as { properties: Record<string, unknown> };
      for (const campo of Object.keys(schema.properties).filter((c) => !['external_id', 'alterado_em', 'ativo'].includes(c))) expect(s?.html, `${e}.${campo}`).toContain(campo);
    }
  });

  it('RD-3: external_id, alterado_em e ativo aparecem numa tabela só (A.1), não em cada entidade', () => {
    const comuns = secoes.find((x) => x.id === 'entidade-comuns')?.html ?? '';
    for (const c of ['external_id', 'alterado_em', 'ativo']) {
      expect(comuns, c).toContain(c);
      for (const e of ENTIDADES) expect(secoes.find((x) => x.id === `entidade-${e}`)?.html, `${e}.${c}`).not.toMatch(new RegExp(`<td><code>${c}</code></td>`));
    }
  });

  it('RN-INT-04: o Anexo A cita as dependências reais de domain/ordem.ts', () => {
    for (const [entidade, deps] of Object.entries(DEPENDENCIAS)) {
      const h = secoes.find((x) => x.id === `entidade-${entidade}`)?.html ?? '';
      for (const d of deps) expect(h, `${entidade} depende de ${d}`).toContain(`<code>${d}</code>`);
      if (deps.length === 0) expect(h).toContain('nada (pode ir primeiro)');
    }
  });

  it('cita as 7 rotas do contrato, as 16 entidades e os cabeçalhos', () => {
    for (const r of ROTAS_HUB) expect(texto, `${r.metodo} ${r.caminho}`).toContain(r.caminho);
    for (const e of ENTIDADES) expect(texto, e).toContain(e);
    for (const h of ['Authorization', 'X-Macuxi-Conector-Id', 'X-Macuxi-Conector-Versao', 'Idempotency-Key', 'Idempotent-Replay', 'Retry-After', 'X-Request-Id']) expect(texto, h).toContain(h);
  });

  it('os limites do guia são os padrões do Hub (PARAMETROS_PADRAO)', () => {
    const p = PARAMETROS_PADRAO;
    expect([p.limiteRegistrosLote, p.limiteLinhasInvalidas, p.limiteCorpoLoteBytes / 2 ** 20, p.limiteCorpoGeralBytes / 2 ** 20]).toEqual([5000, 500, 8, 1]);
    expect([p.taxaPorConector.lote.capacidade, p.taxaPorConector.lote.reposicaoPorMin, p.taxaPorConector.geral.capacidade, p.taxaPorConector.geral.reposicaoPorMin]).toEqual([30, 20, 300, 300]);
    expect([p.timeoutEnvioMin, p.limiteInativacaoPct, p.ttlConfirmacaoInativacaoDias, p.pedidosPorConsulta, p.esperaMaxDependenciaMin]).toEqual([10, 30, 7, 50, 30]);
    for (const trecho of ['5.000', '8 MiB', '1 MiB', 'balde de 30 chamadas, repõe 20 por minuto', 'balde de 300, repõe 300 por minuto', 'mais de 20 por minuto', '30%', '7 dias', '10 minutos', '30 minutos', '24 horas']) {
      expect(texto, trecho).toContain(trecho);
    }
  });

  it('texto sem marcação sobrando: nenhum asterisco ou crase solta, e o Conector Macuxi fica fora do guia da API direta', () => {
    expect(texto).not.toMatch(/\*\*|`/);
    for (const fora of [/SHA-256 do arquivo/, /politica_versao\.pacote/, /atualizacao\./, /Quem usa o Conector Macuxi/]) expect(texto, String(fora)).not.toMatch(fora);
  });

  it('nenhuma linha de bloco de código passa de 95 caracteres (senão perde a indentação ao quebrar)', () => {
    const blocos = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => (m[1] as string).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
    expect(blocos.length).toBeGreaterThan(20);
    for (const b of blocos) for (const linha of b.split('\n')) expect(linha.length, linha).toBeLessThanOrEqual(95);
  });

  it('código de erro só quebra depois de "_" (<wbr>), nunca no meio da palavra', () => {
    expect(html).toContain('<code>referencia_<wbr>ausente</code>');
  });

  it('todo campo de tabela tem explicação em português', () => {
    expect([...CAMPOS_SEM_TEXTO]).toEqual([]);
  });

  it('só API: sem CSV, carga por arquivo nem configuração do portal ("ou é Conector ou é API")', () => {
    for (const proibido of [/\bcsv\b/i, /carga por arquivo/i, /conector de arquivo/i, /importa[çc][ãa]o/i, /portal/i, /\bconfig\b/i, /configura[çc][ãa]o do portal/i]) {
      expect(texto, String(proibido)).not.toMatch(proibido);
    }
  });

  it('o PDF publicado corresponde ao OpenAPI e aos textos atuais (regerar: pnpm --filter @macuxi/integracao guia-pdf)', () => {
    expect(existsSync(arquivo('guia-api-hub.pdf'))).toBe(true);
    expect(readFileSync(arquivo('guia-api-hub.pdf.sha256'), 'utf8').trim(), 'PDF desatualizado: rode "pnpm --filter @macuxi/integracao guia-pdf"').toBe(hashDoGuia());
    const pdf = readFileSync(arquivo('guia-api-hub.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(paginas).toBeGreaterThanOrEqual(secoes.length + 2);
  });
});
