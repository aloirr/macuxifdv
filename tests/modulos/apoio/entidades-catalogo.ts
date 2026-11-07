/**
 * Entidades de sync que o Catálogo registra no aparelho, lidas do `moduloApp.entidadesSync` de
 * `modules/catalogo/app/index.ts` (T-0085, R-20261107-123613-banco-dados). O `index.ts` importa as telas (React Native,
 * que não roda no Node), então a lista é lida do FONTE e cada nome é resolvido no `@macuxi/catalogo/contracts` real.
 * Assim os testes do aparelho montam as mesmas tabelas que o app: uma entidade nova no shell (ex.: `produto_no` e
 * `produto_relacao`, exigidas pelos índices da v4 do `db/aparelho.ts`) entra sozinha, sem lista à mão para divergir.
 * Se o shell passar a declarar algo que não vem do contracts, ou mudar a forma da lista, o helper lança erro em vez de
 * devolver uma lista menor.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as contratosCatalogo from '@macuxi/catalogo/contracts';
import type { DefinicaoEntidadeSync } from '@macuxi/platform-sdk';

const ARQUIVO = join(__dirname, '..', '..', '..', 'modules', 'catalogo', 'app', 'index.ts');

const ehEntidade = (x: unknown): x is DefinicaoEntidadeSync =>
  typeof x === 'object' && x !== null && typeof (x as { nome?: unknown }).nome === 'string' && (x as { modulo?: unknown }).modulo === 'catalogo';

/** Identificadores que o shell importa de `../contracts` (os únicos que este helper sabe resolver). */
function importadosDoContracts(fonte: string): Set<string> {
  const nomes = new Set<string>();
  for (const [, lista] of fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/contracts'/g)) {
    for (const n of lista!.split(',')) {
      const limpo = n.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/).pop()!.trim();
      if (limpo) nomes.add(limpo);
    }
  }
  return nomes;
}

export function entidadesSyncCatalogo(): DefinicaoEntidadeSync[] {
  const fonte = readFileSync(ARQUIVO, 'utf8').replace(/\/\/[^\n]*/g, '');
  const bloco = /entidadesSync:\s*\[([^\]]*)\]/.exec(fonte)?.[1];
  if (bloco === undefined) throw new Error(`entidadesSync não encontrado em ${ARQUIVO}: atualize tests/modulos/apoio/entidades-catalogo.ts`);
  const doContracts = importadosDoContracts(fonte);
  const contratos = contratosCatalogo as Record<string, unknown>;
  const entidades: DefinicaoEntidadeSync[] = [];
  for (const termo of bloco.split(',').map((t) => t.trim()).filter(Boolean)) {
    const espalhado = termo.startsWith('...');
    const nome = espalhado ? termo.slice(3).trim() : termo;
    if (!doContracts.has(nome)) throw new Error(`entidadesSync do Catálogo usa "${termo}", que não vem de '../contracts': atualize tests/modulos/apoio/entidades-catalogo.ts`);
    const valor = contratos[nome];
    const itens = espalhado ? valor : [valor];
    if (!Array.isArray(itens) || !itens.every(ehEntidade)) throw new Error(`"${termo}" do entidadesSync do Catálogo não resolve para entidades do Catálogo no contracts`);
    entidades.push(...itens);
  }
  if (entidades.length === 0) throw new Error('entidadesSync do Catálogo vazio no fonte');
  return entidades;
}
