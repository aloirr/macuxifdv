/**
 * Porta `abrirArquivo` que o shell registra no Core (T-0186, RD-2356, RD-2374 e RD-2384): foto de fachada e documentos do
 * cliente no Cliente 360. Só visualizar (P15 e P17), no visor de foto comum (`abrirFoto`, RD-0088), que olha os bytes e os
 * mantém só em memória. O que o shell abre vai no registro da porta (`{ formatos: ['imagem'] }`, services/camera.ts).
 */
import type { PedidoAbrirArquivo } from '@macuxi/core/app';

import { abrirFoto } from './visor-foto';

/** A porta registrada no Core. */
export function abrirArquivo(p: PedidoAbrirArquivo): void {
  abrirFoto({
    arquivo_id: p.arquivo_id,
    titulo: p.titulo,
    ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}),
  });
}
