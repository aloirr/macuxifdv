/**
 * Rota do visor de PDF (T-0186, v1.0.16): aberta pela porta `abrirArquivo` (`services/visualizar-arquivo.ts`) quando o Core
 * pede `formato: 'pdf'` (NF e documentos do cliente). Sob demanda e só com sinal ("Sem internet" sem ele); o arquivo fica
 * num temporário que a tela apaga ao fechar (`services/visor-pdf.ts`).
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { PaginasDoPdf } from '@/components/visor-pdf';
import { VisorDeFoto } from '@/components/visor-foto';
import { TEXTO_FOTO_INDISPONIVEL } from '@/lib/foto-pdv';
import type { EstadoVisor } from '@/lib/visor-foto';
import { pedidoDoVisorPdf } from '@/lib/visor-pdf';
import { abrirPdfNaTela } from '@/services/visor-pdf';
import { usePlataforma } from '@/state/plataforma';

export default function TelaVisorDePdf() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const pedido = pedidoDoVisorPdf(params);
  const { sessao } = usePlataforma();
  const [estado, setEstado] = useState<EstadoVisor>({ tipo: 'carregando' });
  const arquivo = pedido?.arquivo_id ?? null;

  useEffect(() => {
    if (!arquivo) return;
    return abrirPdfNaTela(arquivo, setEstado);
  }, [arquivo]);

  if (!sessao) return <Redirect href="/login" />;
  if (!pedido) return <Redirect href="/" />;

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const falhou = () => setEstado({ tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL });

  return (
    <VisorDeFoto
      {...(pedido.titulo ? { titulo: pedido.titulo } : {})}
      {...(pedido.subtitulo ? { subtitulo: pedido.subtitulo } : {})}
      estado={estado}
      aoFechar={fechar}
      conteudo={(uri) => <PaginasDoPdf uri={uri} aoFalhar={falhou} />}
    />
  );
}
