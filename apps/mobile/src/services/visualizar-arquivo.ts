/**
 * Porta `abrirArquivo` que o shell registra no Core (T-0186, RD-2356 e RD-2374): foto de fachada e documentos do cliente no
 * Cliente 360. Só visualizar (P15 e P17), só JPEG e PNG. Regras puras em `@/lib/visualizar-arquivo`.
 * - Formato que o visor abre (`FORMATOS_DO_VISOR`) ou sem formato: o visor de foto comum (`abrirFoto`, RD-0088), que olha os
 *   bytes e os mantém só em memória.
 * - Outro formato (PDF de um Core antigo): não abre nem baixa nada.
 */
import type { PedidoAbrirArquivo } from '@macuxi/core/app';

import { ehImagem, semFormato } from '@/lib/visualizar-arquivo';
import { abrirFoto } from './visor-foto';

/** A porta registrada no Core. Nunca lança: arquivo inválido ou formato que o visor não abre não abre nada. */
export function abrirArquivo(p: PedidoAbrirArquivo): void {
  if (!ehImagem(p.formato) && !semFormato(p.formato)) return;
  abrirFoto({ arquivo_id: p.arquivo_id, titulo: p.titulo, ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) });
}
