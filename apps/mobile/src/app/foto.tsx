/**
 * Rota do visor de foto comum (RD-0088): aberta pela porta `abrirFoto` (`services/visor-foto.ts`) que os módulos recebem no
 * ambiente e o Core usa para a foto do PDV. Fonte `arquivo_id`: foto deste aparelho abre sem sinal; a da nuvem precisa de
 * sinal e fica só em memória (`carregarFotoPdv`). Fonte `uri`: local abre sempre; de rede, só com sinal. O desenho é do
 * `VisorDeFoto` (tela cheia, zoom, fechar).
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { VisorDeFoto } from '@/components/visor-foto';
import { TEXTO_FOTO_INDISPONIVEL, TEXTO_SEM_SINAL_FOTO } from '@/lib/foto-pdv';
import { estadoDoEndereco, pedidoDoVisor, type EstadoVisor } from '@/lib/visor-foto';
import { carregarFotoPdv } from '@/services/foto-pdv';
import { usePlataforma } from '@/state/plataforma';

export default function TelaVisorDeFoto() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const pedido = pedidoDoVisor(params);
  const { sessao, offline } = usePlataforma();
  const online = !offline;
  const [estado, setEstado] = useState<EstadoVisor>({ tipo: 'carregando' });
  const arquivo = pedido?.arquivo_id ?? null;
  const uri = pedido?.uri ?? null;

  useEffect(() => {
    if (uri) {
      setEstado(estadoDoEndereco(uri, online));
      return;
    }
    if (!arquivo) return;
    let vivo = true;
    setEstado({ tipo: 'carregando' });
    void carregarFotoPdv(arquivo).then((r) => {
      if (vivo) setEstado(r);
    });
    return () => {
      vivo = false;
    };
    // `online` fora das dependências: o sinal vale no momento de abrir (a carga do arquivo também o lê na hora)
  }, [arquivo, uri]);

  if (!sessao) return <Redirect href="/login" />;
  if (!pedido) return <Redirect href="/" />;

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const falhou = () => setEstado({ tipo: 'erro', mensagem: online ? TEXTO_FOTO_INDISPONIVEL : TEXTO_SEM_SINAL_FOTO });

  return <VisorDeFoto {...(pedido.titulo ? { titulo: pedido.titulo } : {})} {...(pedido.subtitulo ? { subtitulo: pedido.subtitulo } : {})} estado={estado} aoFechar={fechar} aoFalharImagem={falhou} />;
}
