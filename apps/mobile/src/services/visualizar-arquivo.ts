/**
 * Porta `abrirArquivo` que o shell registra no Core (T-0186, RD-2356, RD-2374 e RD-2384): foto de fachada e documentos do
 * cliente no Cliente 360 e o PDF da NF. Só visualizar (P15 e P17). O PDF (`formato: 'pdf'`, v1.0.16) abre o visor de PDF
 * (`/pdf`, `app/pdf.tsx`); o resto, o visor de foto comum (`abrirFoto`, RD-0088). Nada fica guardado no aparelho. Os
 * formatos vão no registro da porta (`{ formatos: ['imagem', 'pdf'] }`, services/camera.ts).
 */
import { normalizarFormato, type PedidoAbrirArquivo } from '@macuxi/core/app';
import { router } from 'expo-router';

import { rotaDoVisorPdf } from '@/lib/visor-pdf';

import { abrirFoto } from './visor-foto';

/** A porta registrada no Core. Nunca lança (arquivo que não é UUID não abre nada). */
export function abrirArquivo(p: PedidoAbrirArquivo): void {
  const pedido = { arquivo_id: p.arquivo_id, titulo: p.titulo, ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) };
  if (normalizarFormato(p.formato) !== 'pdf') {
    abrirFoto(pedido);
    return;
  }
  try {
    router.push(rotaDoVisorPdf(pedido) as never);
  } catch {
    // arquivo inválido: nada abre
  }
}
