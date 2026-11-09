/**
 * Câmera do aparelho para os módulos (RN-CORE-14: foto da fachada do cliente fechado). O módulo não importa
 * bibliotecas de câmera: o shell registra a captura no Core (`definirCapturaFoto`) e o Core guarda só a referência.
 *
 * Captura: expo-image-picker (câmera do sistema, sem galeria — a foto precisa ser tirada na hora), reduz para no
 * máximo 1600 px no maior lado e grava JPEG 80 (expo-image-manipulator) em `<documentos>/fotos/<uuid>.jpg`
 * (expo-file-system). Devolve o UUID gerado no aparelho; `null` = câmera negada ou cancelada (a tela orienta).
 * A mesma câmera serve ao Core (fachada), ao Promotor (gôndola e tarefa, RN-PRO-02, com a coordenada do momento quando
 * houver) e à Pesquisa (pergunta de foto, RN-PES-06, com largura e altura gravadas).
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
  if (!original) return null;

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

/**
 * Registra a captura no Core, no Promotor e na Pesquisa. Enquanto `@macuxi/core/app` não exporta `definirCapturaFoto` (recado ao modulo-core),
 * não faz nada e a folha de checkout segue orientando o usuário.
 */
export function registrarCameraNosModulos(): boolean {
  const definir = (appCore as unknown as { definirCapturaFoto?: (fn: CapturaFoto | null) => void }).definirCapturaFoto;
  definirCapturaFotoPromotor(capturarFotoPromotor);
  definirCapturaFotoPesquisa(capturarFotoGravada);
  if (typeof definir !== 'function') return false;
  definir(capturarFoto);
  return true;
}
