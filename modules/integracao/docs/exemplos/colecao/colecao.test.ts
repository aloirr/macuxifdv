/**
 * T-0108: a coleção Postman, o ambiente Postman e o export Insomnia do kit do TI são GERADOS do OpenAPI publicado
 * (`docs/openapi-hub-v1.json`) e este teste falha se algum dos três arquivos divergir do que o gerador produz hoje.
 * Regerar: `node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos (script de Node puro do kit do TI)
import { ARQUIVOS, gerarArquivos, lerOpenApi, operacoes } from './gerar-colecao.mjs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const lerArquivo = (nome: string): string => readFileSync(fileURLToPath(new URL(`./${nome}`, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');
const doc = lerOpenApi() as Json;
const ops = operacoes(doc) as Json[];
const gerados = gerarArquivos(doc) as Record<string, string>;
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

const postman = JSON.parse(lerArquivo(ARQUIVOS.postman)) as Json;
const ambiente = JSON.parse(lerArquivo(ARQUIVOS.ambientePostman)) as Json;
const insomnia = JSON.parse(lerArquivo(ARQUIVOS.insomnia)) as Json;

/** Todas as requisições Postman (pastas aninhadas), com a pasta-rota pai. */
function requisicoesPostman(itens: Json[], pai = ''): { pai: string; item: Json }[] {
  return itens.flatMap((i) => (i.item ? requisicoesPostman(i.item as Json[], i.name as string) : [{ pai, item: i }]));
}
const reqsPostman = requisicoesPostman(postman.item as Json[]);
const reqsInsomnia = (insomnia.resources as Json[]).filter((r) => r._type === 'request');

describe('Kit do TI: coleção Postman / Insomnia gerada do OpenAPI', () => {
  for (const nome of Object.values(ARQUIVOS) as string[]) {
    it(`${nome} está em dia com o OpenAPI (senão rode: node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs)`, () => {
      expect(
        lerArquivo(nome) === gerados[nome],
        `${nome} diverge do que o gerador produz do openapi-hub-v1.json. Regere com: node modules/integracao/docs/exemplos/colecao/gerar-colecao.mjs`,
      ).toBe(true);
    });
  }

  it('a geração é determinística (duas execuções, mesmos bytes)', () => {
    expect(gerarArquivos(lerOpenApi())).toEqual(gerados);
  });

  it('toda rota do OpenAPI (método + caminho) aparece no Postman e no Insomnia', () => {
    expect(ops).toHaveLength(7);
    for (const op of ops) {
      const rota = `${op.metodo} ${op.caminho}`;
      const caminhoPostman = (op.caminho as string).replace(/\{([^}]+)\}/g, (_, n: string) => `{{${n === 'id' ? 'lote_id' : n}}}`);
      const doPostman = reqsPostman.filter((r) => r.pai === rota);
      expect(doPostman.length, `Postman: ${rota}`).toBeGreaterThan(0);
      for (const r of doPostman) {
        expect(r.item.request.method).toBe(op.metodo);
        expect(r.item.request.url.raw).toBe(`{{base_url}}${caminhoPostman}`);
      }
      const doInsomnia = reqsInsomnia.filter((r) => r.method === op.metodo && (r.url as string).startsWith('{{ _.base_url }}') && r.url.replace(/\{\{ _\.\w+ \}\}/g, '{}') === `{}${(op.caminho as string).replace(/\{[^}]+\}/g, '{}')}`);
      expect(doInsomnia.length, `Insomnia: ${rota}`).toBeGreaterThan(0);
    }
  });

  it('todo exemplo de corpo do OpenAPI vira uma requisição com o corpo idêntico (Postman e Insomnia)', () => {
    let total = 0;
    for (const op of ops) {
      for (const ex of op.exemplosCorpo as { nome: string; valor: unknown }[]) {
        total += 1;
        const rota = `${op.metodo} ${op.caminho}`;
        const noPostman = reqsPostman
          .filter((r) => r.pai === rota)
          .map((r) => JSON.parse(r.item.request.body.raw as string) as unknown);
        expect(noPostman, `Postman ${rota} / ${ex.nome}`).toContainEqual(ex.valor);
        const noInsomnia = reqsInsomnia.filter((r) => r._id === `req_${op.id}_${ex.nome}`).map((r) => JSON.parse(r.body.text as string) as unknown);
        expect(noInsomnia, `Insomnia ${rota} / ${ex.nome}`).toEqual([ex.valor]);
      }
    }
    // 15 entidades + 3 (completo parte 1, última parte, só linhas inválidas) + 2 reconciliações + 5 retornos + sinal
    expect(total).toBeGreaterThanOrEqual(26);
  });

  it('as requisições GET não levam corpo e a primeira de cada rota traz as respostas de exemplo do OpenAPI', () => {
    for (const op of ops) {
      const doPostman = reqsPostman.filter((r) => r.pai === `${op.metodo} ${op.caminho}`);
      if (op.metodo === 'GET') for (const r of doPostman) expect(r.item.request.body).toBeUndefined();
      expect(doPostman[0]?.item.response.length, `${op.id}: respostas de exemplo`).toBe((op.respostas as unknown[]).length);
      for (const r of doPostman.slice(1)) expect(r.item.response).toEqual([]);
    }
  });

  it('autenticação: Bearer {{chave_conector}}, X-Macuxi-Conector-Id ligado e X-Macuxi-Conector-Versao DESLIGADO por padrão', () => {
    expect(postman.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{chave_conector}}', type: 'string' }] });
    for (const { item } of reqsPostman) {
      const h = item.request.header as Json[];
      expect(h.find((x) => x.key === 'X-Macuxi-Conector-Id')).toMatchObject({ value: '{{conector_id}}' });
      expect(h.find((x) => x.key === 'X-Macuxi-Conector-Id').disabled).toBeUndefined();
      expect(h.find((x) => x.key === 'X-Macuxi-Conector-Versao').disabled).toBe(true);
    }
    for (const r of reqsInsomnia) {
      expect(r.authentication).toEqual({ type: 'bearer', token: '{{ _.chave_conector }}' });
      expect((r.headers as Json[]).find((x) => x.name === 'X-Macuxi-Conector-Versao').disabled).toBe(true);
    }
  });

  it('POST /lotes: Idempotency-Key é o SHA-256 do corpo (formato do contrato) e o Postman recalcula no script de pré-requisição', () => {
    const lotes = reqsPostman.filter((r) => r.pai === 'POST /lotes');
    expect(lotes.length).toBeGreaterThanOrEqual(18);
    for (const { item } of lotes) {
      const chave = (item.request.header as Json[]).find((x) => x.key === 'Idempotency-Key')?.value as string;
      expect(chave).toBe(sha256(item.request.body.raw as string));
      expect(chave).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
      const pre = (item.event as Json[]).find((e) => e.listen === 'prerequest');
      expect((pre?.script.exec as string[]).join('\n')).toContain('Idempotency-Key');
    }
    const insomniaLotes = reqsInsomnia.filter((r) => r.method === 'POST' && (r.url as string).endsWith('/lotes'));
    expect(insomniaLotes).toHaveLength(lotes.length);
    for (const r of insomniaLotes) {
      expect((r.headers as Json[]).find((x) => x.name === 'Idempotency-Key').value).toBe(sha256(r.body.text as string));
    }
  });

  it('variáveis: base_url montada do servidor; ambiente com servidor, chave_conector (secret), conector_id e conector_versao', () => {
    const vars = Object.fromEntries((postman.variable as Json[]).map((v) => [v.key, v.value]));
    expect(vars.base_url).toBe('https://{{servidor}}/integracao/v1');
    for (const k of ['lote_id', 'entidade', 'pedido_uuid']) expect(vars, k).toHaveProperty(k);
    expect((ambiente.values as Json[]).map((v) => v.key)).toEqual(['servidor', 'chave_conector', 'conector_id', 'conector_versao']);
    expect((ambiente.values as Json[]).find((v) => v.key === 'chave_conector').type).toBe('secret');
    expect((ambiente.values as Json[]).find((v) => v.key === 'servidor').value).toBe('api-demo.macuxifdv.com.br');
  });

  it('nenhuma chave real: só o placeholder (nenhum mxc_ + 43 caracteres) em nenhum dos três arquivos', () => {
    const chaveReal = /mxc_[A-Za-z0-9_-]{43}/;
    for (const nome of Object.values(ARQUIVOS) as string[]) expect(lerArquivo(nome), nome).not.toMatch(chaveReal);
    const placeholder = (ambiente.values as Json[]).find((v) => v.key === 'chave_conector').value as string;
    expect(placeholder).toMatch(/^mxc_COLE_AQUI/);
    expect(placeholder).not.toMatch(/^mxc_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(insomnia)).toContain(placeholder);
  });

  it('o export do Insomnia é v4, com ids únicos e todo pai existente', () => {
    expect(insomnia._type).toBe('export');
    expect(insomnia.__export_format).toBe(4);
    const ids = (insomnia.resources as Json[]).map((r) => r._id as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of insomnia.resources as Json[]) if (r.parentId) expect(ids, `${r._id}: pai`).toContain(r.parentId);
  });
});
