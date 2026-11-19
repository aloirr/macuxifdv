/**
 * Rota do visualizador de arquivos da ficha (T-0186, RD-2356): aberta pela porta `abrirArquivo`
 * (`services/visualizar-arquivo.ts`) que o shell registra no Core para "Ver PDF" da NF e os documentos do cliente.
 * Baixa com sinal; imagem fica em memória (visor de foto comum); PDF vai ao cache temporário, apagado ao fechar e ao sair.
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { VisorDeFoto } from '@/components/visor-foto';
import { VisorDePdf } from '@/components/visor-pdf';
import { pedidoDaRotaArquivo, TEXTO_ARQUIVO_INDISPONIVEL } from '@/lib/visualizar-arquivo';
import type { EstadoVisor } from '@/lib/visor-foto';
import { baixarArquivo, limparTemporarios, type ArquivoBaixado } from '@/services/visualizar-arquivo';
import { usePlataforma } from '@/state/plataforma';

type Estado = { tipo: 'carregando' } | ArquivoBaixado;

export default function TelaVisorDeArquivo() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const pedido = pedidoDaRotaArquivo(params);
  const { sessao } = usePlataforma();
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const arquivo = pedido?.arquivo_id ?? null;

  useEffect(() => {
    if (!arquivo) return;
    let vivo = true;
    setEstado({ tipo: 'carregando' });
    void baixarArquivo(arquivo, { pdf: VisorDePdf !== null }).then((r) => {
      if (vivo) setEstado(r);
      else limparTemporarios(); // saiu da tela antes do fim do download
    });
    return () => {
      vivo = false;
      limparTemporarios();
    };
  }, [arquivo]);

  if (!sessao) return <Redirect href="/login" />;
  if (!pedido) return <Redirect href="/" />;

  const fechar = () => {
    limparTemporarios();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const subtitulo = pedido.subtitulo ? { subtitulo: pedido.subtitulo } : {};

  if (estado.tipo === 'pdf' && VisorDePdf) return <VisorDePdf uri={estado.uri} aoFechar={fechar} titulo={pedido.titulo} {...subtitulo} />;
  const visor: EstadoVisor = estado.tipo === 'imagem' ? { tipo: 'ok', uri: estado.uri } : estado.tipo === 'pdf' ? { tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL } : estado;
  return <VisorDeFoto {...(pedido.titulo ? { titulo: pedido.titulo } : {})} {...subtitulo} estado={visor} aoFechar={fechar} aoFalharImagem={() => setEstado({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL })} />;
}
