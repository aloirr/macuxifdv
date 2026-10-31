// shell monta o módulo pelo que ele exporta (web, manifest)
import { paginaB } from '../../modules/b/web/index';
import { manifestoB } from '../../modules/b/manifest';
export const montar = [paginaB, manifestoB.id];
