/**
 * Folha "Tirar foto / Escolher da galeria" da foto do PDV (T-0147; imagem aprovada T-0147-fotos-pdv.png, tela 2): título =
 * tipo da foto ("Contrato social"), ✕, as duas opções e "Voltar". Montada uma vez no layout raiz; abre quando o Core pede
 * pela porta da captura (lib/folha-foto-pdv.ts). A resposta só sai depois de a folha descer, para a câmera ou a galeria do
 * sistema não abrir por cima da folha ainda saindo.
 */
import { useEffect, useRef, useState } from 'react';

import { Folha, OpcaoFolha } from '@macuxi/ui/mobile';
import { assinarFolhaFotoPdv, responderFolhaFotoPdv, type OrigemFotoPdv } from '@/lib/folha-foto-pdv';

/** Espera a saída da folha (280 ms do kit) antes de abrir a câmera ou a galeria. */
export const ESPERA_SAIDA_FOLHA_MS = 300;

export function FolhaFotoPdv() {
  const [titulo, setTitulo] = useState('');
  const [visivel, setVisivel] = useState(false);
  const respondendo = useRef(false);
  useEffect(
    () =>
      assinarFolhaFotoPdv((pedido) => {
        if (pedido) {
          respondendo.current = false;
          setTitulo(pedido.titulo);
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
      fechar={{ rotulo: 'Fechar', testID: 'folha-foto-pdv-fechar' }}
      rodape={{ rotulo: 'Voltar', onPress: () => responder(null), testID: 'folha-foto-pdv-voltar' }}
      testID="folha-foto-pdv">
      <OpcaoFolha icone="camera" titulo="Tirar foto" tom="neutro" onPress={() => responder('camera')} testID="folha-foto-pdv-camera" />
      <OpcaoFolha icone="galeria" titulo="Escolher da galeria" tom="neutro" onPress={() => responder('galeria')} testID="folha-foto-pdv-galeria" />
    </Folha>
  );
}
