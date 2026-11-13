/**
 * Pedido da folha "Tirar foto / Escolher da galeria" da foto do PDV (T-0147, RN-CORE-38; imagem aprovada
 * docs/design/telas/T-0147-fotos-pdv.png, tela 2). O Core pede pela porta `definirCapturaFotoPdv().escolher({ titulo })`; o
 * shell mostra a folha (components/folha-foto-pdv.tsx) e devolve a origem tocada. Um pedido por vez: um novo pedido com a
 * folha aberta encerra o anterior como cancelado. Sem folha montada (navegador, testes), o pedido é cancelado na hora.
 */
export type OrigemFotoPdv = 'camera' | 'galeria';

export interface PedidoFolhaFotoPdv {
  titulo: string;
}

type Ouvinte = (pedido: PedidoFolhaFotoPdv | null) => void;

let ouvinte: Ouvinte | null = null;
let pendente: { pedido: PedidoFolhaFotoPdv; responder: (o: OrigemFotoPdv | null) => void } | null = null;

/** A folha do shell assina os pedidos; devolve a função que desfaz a assinatura (o pedido aberto sai cancelado). */
export function assinarFolhaFotoPdv(fn: Ouvinte): () => void {
  ouvinte = fn;
  fn(pendente?.pedido ?? null);
  return () => {
    if (ouvinte !== fn) return;
    ouvinte = null;
    responderFolhaFotoPdv(null);
  };
}

/** Abre a folha e espera a escolha; `null` = fechou (✕, Voltar, toque fora, Voltar do Android) ou não há folha. */
export function pedirOrigemFotoPdv(pedido: PedidoFolhaFotoPdv): Promise<OrigemFotoPdv | null> {
  responderFolhaFotoPdv(null);
  if (!ouvinte) return Promise.resolve(null);
  return new Promise((resolve) => {
    pendente = { pedido, responder: resolve };
    ouvinte?.(pedido);
  });
}

/** Resposta da folha (a origem tocada ou `null`); fecha a folha. Sem pedido aberto, não faz nada. */
export function responderFolhaFotoPdv(origem: OrigemFotoPdv | null): void {
  const atual = pendente;
  if (!atual) return;
  pendente = null;
  ouvinte?.(null);
  atual.responder(origem);
}
