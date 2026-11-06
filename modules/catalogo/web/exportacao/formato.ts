/**
 * Formato dos dados da exportação do catálogo (RF-CAT-09, RN-CAT-09, RN-CAT-11; T-0085).
 *
 * PROVISÓRIO: este schema Zod vive aqui até a fatia B publicar o contrato do produto (aplicação, referências,
 * oferece junto, hierarquia) em `../../contracts`; quando chegar, este arquivo passa a só reexportar de lá.
 */
import { Id } from '@macuxi/core/contracts';
import { z } from 'zod';

export const MAX_REFERENCIAS = 3;
export const MAX_CODIGO_REFERENCIA = 30;
export const MAX_OFERECE_JUNTO = 5;
export const MAX_APLICACAO = 2000;

/** Rota que a fatia B deve expor (somente leitura, escopo do tenant). */
export const ROTA_EXPORTACAO = '/catalogo/exportacao';

export const ProdutoExportacao = z.object({
  id: Id,
  codigo: z.string().min(1),
  descricao: z.string(),
  aplicacao: z.string().nullable(),
  hierarquia: z.object({ sistema: z.string().nullable(), grupo: z.string().nullable(), linha: z.string().nullable() }),
  referencias: z.array(z.object({ marca_id: Id, codigo: z.string().min(1).max(MAX_CODIGO_REFERENCIA) })).max(MAX_REFERENCIAS),
  oferece_junto: z.array(Id).max(MAX_OFERECE_JUNTO),
});
export type ProdutoExportacao = z.infer<typeof ProdutoExportacao>;

export const MarcaConcorrente = z.object({ id: Id, nome: z.string() });
export type MarcaConcorrente = z.infer<typeof MarcaConcorrente>;

export const DadosExportacao = z.object({ produtos: z.array(ProdutoExportacao), marcas: z.array(MarcaConcorrente) });
export type DadosExportacao = z.infer<typeof DadosExportacao>;
