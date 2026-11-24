/**
 * Captura da foto da fachada (RN-CORE-14). O shell do app registra a câmera real (`definirCapturaFoto`);
 * o core só guarda a referência (id) devolvida. Sem câmera registrada, devolve null e a tela orienta o usuário.
 */
import { dataLocal } from '../../domain';
import type { PedidoAbrirArquivo } from './abrir-arquivo';
import type { Cliente360Local } from './cliente360-local';

export type CapturaFoto = () => Promise<string | null>;

let captura: CapturaFoto | null = null;

export function definirCapturaFoto(fn: CapturaFoto | null): void {
  captura = fn;
}

export async function capturarFotoFachada(): Promise<string | null> {
  return captura ? captura() : null;
}

/** dd/mm/aaaa de um instante UTC no fuso do tenant; `null` sem instante ou inválido. */
export function dataBrNoFuso(instante: string | null | undefined, tz: string): string | null {
  if (!instante || Number.isNaN(new Date(instante).getTime())) return null;
  const iso = dataLocal(instante, tz);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** RN-CORE-38: o cadeado só existe onde há foto que o perfil não abre: tipo que não é fachada e que TEM foto (sensível ou não). Sem foto: "Falta" + "Adicionar", sem cadeado. */
export function fotoPdvTrancada(item: { fachada: boolean; situacao: 'tem' | 'falta' }): boolean {
  return !item.fachada && item.situacao === 'tem';
}

/** Foto do PDV gravada no aparelho (`fotos/<id>.jpg`, JPEG 1600 px, sem EXIF/GPS) e de onde veio. */
export interface FotoPdvCapturada {
  id: string;
  largura_px: number;
  altura_px: number;
  origem: 'camera' | 'galeria';
}

/**
 * Captura das fotos do PDV (T-0147, RN-CORE-38). O shell registra (`definirCapturaFotoPdv`): `escolher` abre a folha "Tirar foto /
 * Escolher da galeria" (título = nome do tipo), roda a câmera ou a galeria e devolve a foto com a origem; `null` = cancelou
 * (a tela não mostra erro). `camera` e `galeria` avulsas ficam para "Trocar foto". Só o Core tem a galeria (a fachada do checkout,
 * o Promotor e a Pesquisa seguem só com a câmera). Sem captura registrada (navegador), o "Adicionar" fica desligado.
 */
export interface CapturaFotoPdv {
  escolher(p: { titulo: string }): Promise<FotoPdvCapturada | null>;
  camera(): Promise<Omit<FotoPdvCapturada, 'origem'> | null>;
  galeria(): Promise<Omit<FotoPdvCapturada, 'origem'> | null>;
}

let capturaPdv: CapturaFotoPdv | null = null;

export function definirCapturaFotoPdv(c: CapturaFotoPdv | null): void {
  capturaPdv = c;
}

export function capturaFotoPdvRegistrada(): CapturaFotoPdv | null {
  return capturaPdv;
}

/** Entrada da linha da foto do PDV: o item da ficha (`fotos_pdv.itens`), com `tirada_em` = instante UTC da foto MAIS RECENTE do tipo (pull ou fila) e `arquivo_id` dela. */
export type ItemLinhaFotoPdv = NonNullable<Cliente360Local['fotos_pdv']>['itens'][number];

export interface LinhaFotoPdv {
  /** 2ª linha: Falta | Opcional | Enviada | Na fila */
  segunda: 'Falta' | 'Opcional' | 'Enviada' | 'Na fila';
  perigo: boolean;
  /** dd/mm/aaaa no fuso do tenant; "—" sem foto */
  data: string;
  /** Cadeado (RN-CORE-38): tipo que não é fachada, com foto, que o perfil não abre. */
  trancada: boolean;
  ver: { ligado: boolean; rotulo: string };
  /** `null` = o perfil não envia */
  adicionar: { rotulo: string } | null;
}

/**
 * RN-CORE-38 (v1.0.34): decide a linha da foto do PDV na aba Documentação. Dois botões: ver (olho; ligado com foto, enviada ou na fila, e visualizador disponível, fora do cadeado)
 * e adicionar (câmera; sempre que o perfil envia, mesmo com foto: a foto só é adicionada, nunca trocada). Situação e data = a foto mais recente.
 */
export function linhaDaFotoDoPdv(item: ItemLinhaFotoPdv, o: { tz: string; podeAbrir: boolean; podeEnviar: boolean }): LinhaFotoPdv {
  const tem = item.situacao === 'tem';
  const segunda = item.na_fila ? 'Na fila' : tem ? 'Enviada' : item.obrigatorio ? 'Falta' : 'Opcional';
  const data = (tem && dataBrNoFuso(item.tirada_em, o.tz)) || '—';
  const trancada = fotoPdvTrancada(item);
  const nomeVer = item.fachada ? 'Ver foto da fachada' : `Ver foto: ${item.nome}`;
  const nomeAdd = item.fachada ? 'Adicionar foto da fachada' : `Adicionar foto: ${item.nome}`;
  return { segunda, perigo: segunda === 'Falta', data, trancada, ver: { ligado: tem && Boolean(item.arquivo_id) && !trancada && o.podeAbrir, rotulo: nomeVer }, adicionar: o.podeEnviar ? { rotulo: nomeAdd } : null };
}

/**
 * RN-CORE-38 (v1.0.34): pedido do visualizador para o olho de UMA linha: a foto mais recente do próprio tipo, "<Nome do tipo> · dd/mm/aaaa" no
 * fuso do tenant. `null` = sem arquivo. Quem decide se a linha abre (foto, cadeado, perfil) é `linhaDaFotoDoPdv`.
 */
export function pedidoDeAbrirFotoPdv(nomeCliente: string, item: Pick<ItemLinhaFotoPdv, 'nome' | 'tirada_em' | 'arquivo_id'>, tz: string): PedidoAbrirArquivo | null {
  if (!item.arquivo_id) return null;
  const data = dataBrNoFuso(item.tirada_em, tz);
  return { arquivo_id: item.arquivo_id, titulo: nomeCliente, subtitulo: data ? `${item.nome} · ${data}` : item.nome };
}
