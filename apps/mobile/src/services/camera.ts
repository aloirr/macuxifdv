/**
 * Câmera do aparelho para os módulos (RN-CORE-14: foto da fachada do cliente fechado). O módulo não importa
 * bibliotecas de câmera: o shell registra a captura no Core (`definirCapturaFoto`) e o Core guarda só a referência.
 *
 * Captura: expo-image-picker (câmera do sistema; fachada do checkout, trade e pesquisa só pela câmera, tirada na hora), reduz para no
 * máximo 1600 px no maior lado e grava JPEG 80 (expo-image-manipulator) em `<documentos>/fotos/<uuid>.jpg`
 * (expo-file-system). Devolve o UUID gerado no aparelho; `null` = câmera negada ou cancelada (a tela orienta).
 * A mesma câmera serve ao Core (fachada), ao Promotor (gôndola e tarefa, RN-PRO-02, com a coordenada do momento quando
 * houver) e à Pesquisa (pergunta de foto, RN-PES-06, com largura e altura gravadas).
 *
 * Galeria (T-0147, RN-CORE-38): `escolherFotoDaGaleria` passa pela MESMA redução (1600 px) e regravação em JPEG 80 — a
 * regravação descarta o EXIF, inclusive o GPS da foto — e grava no mesmo `fotos/<uuid>.jpg`. Ela só é registrada para
 * as fotos do PDV no Core (`definirCapturaFotoPdv`); Promotor, Pesquisa e a fachada do checkout seguem só com a câmera.
 * O Core usa `escolher({ titulo })`: o shell abre a folha "Tirar foto / Escolher da galeria" (components/folha-foto-pdv.tsx,
 * imagem aprovada T-0147-fotos-pdv.png) e devolve a foto gravada com a origem, para o `ClienteFotoPush`.
 * O visualizador de arquivos do shell (`abrirArquivo`, services/visualizar-arquivo.ts) vai na porta única `definirAbrirArquivo` do Core
 * (T-0186, RD-2374): fachada e documentos do cliente, com os formatos que ele abre (só imagem), para a tela do Core esconder a
 * ação do que o visor não abre.
 */
import * as appCore from '@macuxi/core/app';
import { definirAbrirArquivo } from '@macuxi/core/app';
import { definirCapturaFotoPesquisa } from '@macuxi/pesquisa/app';
import { definirCapturaFotoPromotor } from '@macuxi/promotor/app';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { pedirOrigemFotoPdv, type OrigemFotoPdv } from '@/lib/folha-foto-pdv';
import { FOTO_QUALIDADE_JPEG, nomeArquivoFoto, PASTA_FOTOS, redimensionamento } from '@/lib/foto';
import { posicaoAgora, uuid } from './device';
import { abrirArquivo } from './visualizar-arquivo';

export type CapturaFoto = () => Promise<string | null>;

/** Foto gravada no aparelho: UUID do arquivo `fotos/<id>.jpg` e o tamanho final (já reduzido). */
export interface FotoGravada {
  id: string;
  largura_px: number;
  altura_px: number;
}

export async function capturarFoto(): Promise<string | null> {
  return (await capturarFotoGravada())?.id ?? null;
}

export async function capturarFotoGravada(): Promise<FotoGravada | null> {
  if (Platform.OS === 'web') return null; // navegador (demonstração): sem câmera
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false });
  const original = r.canceled ? null : r.assets[0];
  return original ? gravarReduzida(original) : null;
}

/**
 * Uma foto da galeria (T-0147, só para as fotos do PDV): o seletor do sistema (Android 13+ não pede permissão), sem EXIF
 * na leitura, e a mesma redução e regravação da câmera. `null` = cancelada ou navegador.
 */
export async function escolherFotoDaGaleria(): Promise<FotoGravada | null> {
  if (Platform.OS === 'web') return null;
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false, allowsEditing: false });
  const original = r.canceled ? null : r.assets[0];
  return original ? gravarReduzida(original) : null;
}

/** Reduz a 1600 px no maior lado, regrava em JPEG 80 (sem EXIF) e move para `fotos/<uuid>.jpg`. */
async function gravarReduzida(original: { uri: string; width: number; height: number }): Promise<FotoGravada> {
  let contexto = ImageManipulator.manipulate(original.uri);
  const reduzir = redimensionamento(original.width, original.height);
  if (reduzir) contexto = contexto.resize(reduzir);
  const imagem = await contexto.renderAsync();
  const salva = await imagem.saveAsync({ format: SaveFormat.JPEG, compress: FOTO_QUALIDADE_JPEG });

  const id = uuid();
  const pasta = new Directory(Paths.document, PASTA_FOTOS);
  if (!pasta.exists) pasta.create({ intermediates: true });
  await new File(salva.uri).move(new File(pasta, nomeArquivoFoto(id)));
  return { id, largura_px: salva.width, altura_px: salva.height };
}

/** Promotor: a foto com a coordenada do momento (sem GPS em 8 s, vai sem coordenada: `sem_gps`, aceito pela RN-PRO-02). */
async function capturarFotoPromotor(): Promise<{ id: string; latitude: number | null; longitude: number | null } | null> {
  const foto = await capturarFotoGravada();
  if (!foto) return null;
  const pos = await posicaoAgora();
  return { id: foto.id, latitude: pos?.lat ?? null, longitude: pos?.lng ?? null };
}

/** Foto do PDV gravada no aparelho, com a origem (`ClienteFotoPush.origem`). */
export interface FotoPdvCapturada extends FotoGravada {
  origem: OrigemFotoPdv;
}

/**
 * Foto do PDV (T-0147): a folha com o tipo no título; "Tirar foto" abre a câmera e "Escolher da galeria" a galeria, com a
 * mesma gravação (JPEG 1600 px / 80, sem EXIF). `null` = fechou a folha, cancelou a câmera/galeria ou câmera negada.
 */
export async function escolherFotoPdv(p: { titulo: string }): Promise<FotoPdvCapturada | null> {
  const origem = await pedirOrigemFotoPdv({ titulo: p.titulo });
  if (!origem) return null;
  const foto = origem === 'camera' ? await capturarFotoGravada() : await escolherFotoDaGaleria();
  return foto ? { ...foto, origem } : null;
}

/** Captura das fotos do PDV no Core (T-0147): `escolher` (com a folha) é o caminho da ficha; câmera e galeria avulsas. */
export interface CapturaFotoPdv {
  escolher: (p: { titulo: string }) => Promise<FotoPdvCapturada | null>;
  camera: () => Promise<FotoGravada | null>;
  galeria: () => Promise<FotoGravada | null>;
}

interface PortasDoCore {
  definirCapturaFoto?: (fn: CapturaFoto | null) => void;
  definirCapturaFotoPdv?: (c: CapturaFotoPdv | null) => void;
}

/**
 * Registra a captura no Core, no Promotor e na Pesquisa, a captura das fotos do PDV no Core (T-0147) e o visualizador de
 * arquivos (T-0186). Porta de captura que o `@macuxi/core/app` ainda não exporta fica sem registro (a tela do Core a deixa
 * desligada). Devolve se a câmera da fachada foi registrada.
 */
export function registrarCameraNosModulos(): boolean {
  const core = appCore as unknown as PortasDoCore;
  definirCapturaFotoPromotor(capturarFotoPromotor);
  definirCapturaFotoPesquisa(capturarFotoGravada);
  // a galeria só para as fotos do PDV (premissa do dono do produto, desenho T-0147 §5)
  if (typeof core.definirCapturaFotoPdv === 'function') core.definirCapturaFotoPdv({ escolher: escolherFotoPdv, camera: capturarFotoGravada, galeria: escolherFotoDaGaleria });
  definirAbrirArquivo(abrirArquivo, { formatos: ['imagem'] });
  if (typeof core.definirCapturaFoto !== 'function') return false;
  core.definirCapturaFoto(capturarFoto);
  return true;
}
