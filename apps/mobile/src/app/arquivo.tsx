/**
 * Rota do visualizador de arquivos da ficha (T-0186, RD-2356): aberta pela porta `abrirArquivo`
 * (`services/visualizar-arquivo.ts`) quando o Core não diz o formato. Baixa com sinal e mostra só imagem, em memória, no
 * visor de foto comum.
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { VisorDeFoto } from '@/components/visor-foto';
import { pedidoDaRotaArquivo, TEXTO_ARQUIVO_INDISPONIVEL } from '@/lib/visualizar-arquivo';
import type { EstadoVisor } from '@/lib/visor-foto';
import { baixarArquivo } from '@/services/visualizar-arquivo';
import { usePlataforma } from '@/state/plataforma';

export default function TelaVisorDeArquivo() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const pedido = pedidoDaRotaArquivo(params);
  const { sessao } = usePlataforma();
  const [estado, setEstado] = useState<EstadoVisor>({ tipo: 'carregando' });
  const arquivo = pedido?.arquivo_id ?? null;

  useEffect(() => {
    if (!arquivo) return;
    let vivo = true;
    setEstado({ tipo: 'carregando' });
    void baixarArquivo(arquivo).then((r) => {
      if (vivo) setEstado(r.tipo === 'imagem' ? { tipo: 'ok', uri: r.uri } : r);
    });
    return () => {
      vivo = false;
    };
  }, [arquivo]);

  if (!sessao) return <Redirect href="/login" />;
  if (!pedido) return <Redirect href="/" />;

  const fechar = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <VisorDeFoto
      {...(pedido.titulo ? { titulo: pedido.titulo } : {})}
      {...(pedido.subtitulo ? { subtitulo: pedido.subtitulo } : {})}
      estado={estado}
      aoFechar={fechar}
      aoFalharImagem={() => setEstado({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL })}
    />
  );
}
