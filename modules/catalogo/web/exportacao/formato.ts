/**
 * Formato dos dados da exportação do catálogo (RF-CAT-09, RN-CAT-09, RN-CAT-11; T-0085 fatia C): só reexporta o contrato
 * da rota `GET /v1/catalogo/exportacao` (fatia B) e os limites do domain. A API confere perfil (analista e admin, ação
 * `produto.enriquecer`), licença do Catálogo e tenant (RLS); o BKO só valida a forma da resposta.
 */
import { ProdutoExportacao, RespostaExportacao, ROTAS_CATALOGO } from '../../contracts';
import { LIMITES_CADASTRO_CATALOGO } from '../../domain/cadastro-catalogo';
import { MAX_OFERECE_JUNTO_EXPORTACAO, MAX_REFERENCIAS_EXPORTACAO } from '../../domain/exportacao';

export { ProdutoExportacao, RespostaExportacao };
/** Resposta da rota de exportação, como o layout a consome. */
export const DadosExportacao = RespostaExportacao;
export type DadosExportacao = RespostaExportacao;

export const MAX_REFERENCIAS = MAX_REFERENCIAS_EXPORTACAO;
export const MAX_CODIGO_REFERENCIA = LIMITES_CADASTRO_CATALOGO.codigo;
export const MAX_OFERECE_JUNTO = MAX_OFERECE_JUNTO_EXPORTACAO;
/** RN-CAT-11: `aplicacao_max_cadastro` padrão (2.000); o cadastro e o ERP já cortam, aqui é só a defesa do layout. */
export const MAX_APLICACAO = 2000;

/** Caminho para o `api()` do BKO (a base `/v1` vem do cliente), como o `BASE = '/catalogo'` da página. */
export const ROTA_EXPORTACAO = `/catalogo/${ROTAS_CATALOGO.exportacao}`;
