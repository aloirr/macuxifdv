/** Geração de UUIDs estáveis para seeds e fixtures (asserts determinísticos, seed idempotente). */
import { createHash } from 'node:crypto';

/**
 * UUID legível: `<prefixo 8 hex>-<grupo 4 hex>-4000-8000-<seq 12 dígitos>`.
 * Ex.: idFixo('aaaaaaaa', 1, 7) = 'aaaaaaaa-0001-4000-8000-000000000007'.
 */
export function idFixo(prefixo: string, grupo: number, seq: number): string {
  if (!/^[0-9a-f]{8}$/.test(prefixo)) throw new Error(`prefixo inválido: ${prefixo}`);
  return `${prefixo}-${grupo.toString(16).padStart(4, '0')}-4000-8000-${String(seq).padStart(12, '0')}`;
}

/**
 * Gêmea de `plataforma.uuid_de_chave(text)` (migração 0005): md5('macuxi:' + chave) com versão 5 e variante
 * RFC 4122. É o id das linhas PADRÃO que o banco semeia em todo tenant (0006), para fixtures e seeds as
 * referenciarem sem consultar. O teste de banco confere que o SQL e o TS dão o mesmo resultado.
 */
export function idDeChave(chave: string): string {
  const h = createHash('md5').update(`macuxi:${chave}`).digest('hex');
  const variante = '89ab'[parseInt(h[16]!, 16) % 4]!;
  const x = `${h.slice(0, 12)}5${h.slice(13, 16)}${variante}${h.slice(17, 32)}`;
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Motivos que a 0006 semeia em todo tenant (RN-CORE-14: os de `cliente_fechado` são de sistema). */
export const MOTIVOS_PADRAO = {
  loja_fechada: { tipo: 'cliente_fechado', sistema: true },
  acesso_negado: { tipo: 'cliente_fechado', sistema: true },
  estoque_alto: { tipo: 'nao_venda', sistema: false },
  comprador_ausente: { tipo: 'nao_venda', sistema: false },
  sem_limite_credito: { tipo: 'nao_venda', sistema: false },
  preco_concorrente: { tipo: 'nao_venda', sistema: false },
  outro: { tipo: 'nao_venda', sistema: false },
} as const;
export type CodigoMotivoPadrao = keyof typeof MOTIVOS_PADRAO;

/** Id do motivo padrão do tenant (semeado pela 0006 / gatilho core.semear_tenant). */
export function idMotivoPadrao(tenantId: string, codigo: CodigoMotivoPadrao): string {
  return idDeChave(`${tenantId}:core.motivo:${MOTIVOS_PADRAO[codigo].tipo}:${codigo}`);
}

/** Id do parâmetro padrão do Core no tenant (semeado pela 0006): `checkin.raio_m`, `metas.base_apuracao`. */
export function idParametroCore(tenantId: string, chave: 'checkin.raio_m' | 'metas.base_apuracao'): string {
  return idDeChave(`${tenantId}:plataforma.parametro:core:${chave}`);
}

/** UUID (formato v5) derivado de uma chave textual: mesma chave => mesmo id em toda execução. */
export function idDeterministico(chave: string): string {
  const h = createHash('sha1').update(`macuxi:${chave}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
