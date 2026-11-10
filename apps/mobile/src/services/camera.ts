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
 * O visualizador da foto do PDV (`abrirFotoPdv`, services/foto-pdv.ts) também é registrado no Core.
 */
import * as appCore from '@macuxi/core/app';
import { definirCapturaFotoPesquisa } from '@macuxi/pesquisa/app';
import { definirCapturaFotoPromotor } from '@macuxi/promotor/app';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { FOTO_QUALIDADE_JPEG, nomeArquivoFoto, PASTA_FOTOS, redimensionamento } from '@/lib/foto';
import { posicaoAgora, uuid } from './device';
import { abrirFotoPdv } from './foto-pdv';

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

/** Captura das fotos do PDV no Core (T-0147): câmera ou galeria. */
export interface CapturaFotoPdv {
  camera: () => Promise<FotoGravada | null>;
  galeria: () => Promise<FotoGravada | null>;
}

interface PortasDoCore {
  definirCapturaFoto?: (fn: CapturaFoto | null) => void;
  definirCapturaFotoPdv?: (c: CapturaFotoPdv | null) => void;
  definirAbrirFotoPdv?: (fn: typeof abrirFotoPdv | null) => void;
}

/**
 * Registra a captura no Core, no Promotor e na Pesquisa, e a captura e o visualizador das fotos do PDV no Core (T-0147).
 * Porta que o `@macuxi/core/app` ainda não exporta fica sem registro (a tela do Core a deixa desligada). Devolve se a
 * câmera da fachada foi registrada.
 */
export function registrarCameraNosModulos(): boolean {
  const core = appCore as unknown as PortasDoCore;
  definirCapturaFotoPromotor(capturarFotoPromotor);
  definirCapturaFotoPesquisa(capturarFotoGravada);
  // a galeria só para as fotos do PDV (premissa do dono do produto, desenho T-0147 §5)
  if (typeof core.definirCapturaFotoPdv === 'function') core.definirCapturaFotoPdv({ camera: capturarFotoGravada, galeria: escolherFotoDaGaleria });
  if (typeof core.definirAbrirFotoPdv === 'function') core.definirAbrirFotoPdv(abrirFotoPdv);
  if (typeof core.definirCapturaFoto !== 'function') return false;
  core.definirCapturaFoto(capturarFoto);
  return true;
}
