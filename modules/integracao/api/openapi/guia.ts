/**
 * Exemplos do guia do Hub (`docs/guia-api-hub.md`, T-0087): os blocos JSON do guia saem dos MESMOS exemplos testados do OpenAPI.
 * No guia, `<!-- exemplo:<id> -->` ... `<!-- /exemplo -->` delimita um bloco que `aplicarExemplosNoGuia` reescreve; o teste de deriva
 * (`guia.test.ts`) falha se o arquivo divergir. Regerar: `pnpm --filter @macuxi/integracao openapi`.
 * Ids: `lote:<chave>`, `aceito:<chave>`, `resultado:<chave>`, `cursor:<chave>`, `pendentes:<chave>`, `retorno:<chave>`,
 * `retorno-aceito:<chave>`, `reconciliacao:<chave>`, `sinal:<chave>` e `erro:<rota|comum>:<status>:<chave>`.
 */
import {
  EXEMPLOS_CURSOR,
  EXEMPLOS_ERRO_COMUM,
  EXEMPLOS_ERRO_ROTA,
  EXEMPLOS_LOTE,
  EXEMPLOS_LOTE_ACEITO,
  EXEMPLOS_LOTE_RESULTADO,
  EXEMPLOS_PEDIDOS_PENDENTES,
  EXEMPLOS_RECONCILIACAO,
  EXEMPLOS_RETORNO,
  EXEMPLOS_RETORNO_ACEITO,
  EXEMPLOS_SINAL,
  type Exemplo,
} from './exemplos';

const REGEX_BLOCO = /<!-- exemplo:([\w:.-]+) -->[\s\S]*?<!-- \/exemplo -->/g;

function achar(lista: readonly Exemplo[] | undefined, chave: string, id: string): unknown {
  const e = lista?.find((x) => x.chave === chave);
  if (!e) throw new Error(`guia: exemplo "${id}" não existe`);
  return e.valor;
}

export function valorDoExemplo(id: string): unknown {
  const [tipo = '', a = '', b = '', c = ''] = id.split(':');
  switch (tipo) {
    case 'lote':
      return achar(EXEMPLOS_LOTE, a, id);
    case 'aceito':
      return achar(EXEMPLOS_LOTE_ACEITO, a, id);
    case 'resultado':
      return achar(EXEMPLOS_LOTE_RESULTADO, a, id);
    case 'cursor':
      return achar(EXEMPLOS_CURSOR, a, id);
    case 'pendentes':
      return achar(EXEMPLOS_PEDIDOS_PENDENTES, a, id);
    case 'retorno':
      return achar(EXEMPLOS_RETORNO, a, id);
    case 'retorno-aceito':
      return achar(EXEMPLOS_RETORNO_ACEITO, a, id);
    case 'reconciliacao':
      return achar(EXEMPLOS_RECONCILIACAO, a, id);
    case 'sinal':
      return achar(EXEMPLOS_SINAL, a, id);
    case 'erro': {
      const lista = a === 'comum' ? (EXEMPLOS_ERRO_COMUM as Record<number, readonly Exemplo[]>)[Number(b)] : EXEMPLOS_ERRO_ROTA[a]?.[Number(b)];
      return achar(lista, c, id);
    }
    default:
      throw new Error(`guia: tipo de exemplo desconhecido em "${id}"`);
  }
}

/** Ids de exemplo citados no guia. */
export function idsDoGuia(texto: string): string[] {
  return [...texto.matchAll(REGEX_BLOCO)].map((m) => m[1] as string);
}

/** Reescreve cada bloco de exemplo do guia com o JSON do exemplo testado. */
export function aplicarExemplosNoGuia(texto: string): string {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  return texto.replace(REGEX_BLOCO, (_bloco, id: string) => {
    const json = JSON.stringify(valorDoExemplo(id), null, 2);
    return ['<!-- exemplo:' + id + ' -->', '```json', json, '```', '<!-- /exemplo -->'].join(eol);
  });
}
