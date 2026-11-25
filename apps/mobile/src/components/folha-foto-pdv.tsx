/**
 * Folha "Tirar foto / Escolher da galeria" da foto do PDV (T-0147; imagem aprovada T-0147-fotos-pdv.png, tela 2): título =
 * tipo da foto ("Contrato social"), as duas opções e "Cancelar", o único jeito visível de sair (spec
 * docs/design/telas/cliente-documentacao-v1034.md §5; sem ✕). Câmera negada no pedido anterior: o motivo em "Tirar foto". Montada uma vez no layout raiz; abre quando o Core pede
 * pela porta da captura (lib/folha-foto-pdv.ts). A resposta só sai depois de a folha descer, para a câmera ou a galeria do
 * sistema não abrir por cima da folha ainda saindo.
 */
import { useEffect, useRef, useState } from 'react';

import { Folha, OpcaoFolha } from '@macuxi/ui/mobile';
import { assinarFolhaFotoPdv, responderFolhaFotoPdv, TEXTO_CAMERA_NEGADA, type OrigemFotoPdv } from '@/lib/folha-foto-pdv';

/** Espera a saída da folha (280 ms do kit) antes de abrir a câmera ou a galeria. */
export const ESPERA_SAIDA_FOLHA_MS = 300;

export function FolhaFotoPdv() {
  const [titulo, setTitulo] = useState('');
  const [cameraNegada, setCameraNegada] = useState(false);
  const [visivel, setVisivel] = useState(false);
  const respondendo = useRef(false);
  useEffect(
    () =>
      assinarFolhaFotoPdv((pedido) => {
        if (pedido) {
          respondendo.current = false;
          setTitulo(pedido.titulo);
          setCameraNegada(pedido.cameraNegada === true);
        }
        setVisivel(pedido !== null);
      }),
    [],
  );
  const responder = (origem: OrigemFotoPdv | null) => {
    if (respondendo.current) return;
    respondendo.current = true;
    setVisivel(false);
    setTimeout(() => responderFolhaFotoPdv(origem), ESPERA_SAIDA_FOLHA_MS);
  };
  return (
    <Folha
      visivel={visivel}
      onFechar={() => responder(null)}
      rotuloFechar="Fechar"
      titulo={titulo}
      rodape={{ rotulo: 'Cancelar', onPress: () => responder(null), testID: 'folha-foto-pdv-cancelar' }}
      testID="folha-foto-pdv">
      <OpcaoFolha
        icone="camera"
        titulo="Tirar foto"
        {...(cameraNegada ? { subtitulo: TEXTO_CAMERA_NEGADA, subtituloErro: true } : {})}
        tom="neutro"
        onPress={() => responder('camera')}
        testID="folha-foto-pdv-camera"
      />
      <OpcaoFolha icone="galeria" titulo="Escolher da galeria" tom="neutro" onPress={() => responder('galeria')} testID="folha-foto-pdv-galeria" />
    </Folha>
  );
}
