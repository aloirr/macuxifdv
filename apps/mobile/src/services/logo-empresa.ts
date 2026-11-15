/**
 * Logo da empresa no aparelho (T-0182): a porta de disco, registro e rede da `lib/logo-empresa.ts`. Os bytes ficam nos
 * documentos do app (`empresa/<tenant>/logo-<sha256>.<ext>`, não no cache: a carga e o Mais usam a cópia sem sinal) e o
 * registro no AsyncStorage (`CHAVE_LOGO_EMPRESA`). Download pelo `ApiClient.bytes` (token da sessão, renova no 401), até
 * `LIMITES_LOGO.bytes`. Navegador (demonstração): sem disco, sem logo.
 */
import { LIMITES_LOGO } from '@macuxi/platform-sdk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { CHAVE_LOGO_EMPRESA, dataUriDaLogo, PASTA_EMPRESA, type LogoGuardada, type PortaLogoEmpresa } from '@/lib/logo-empresa';
import type { ApiClient } from '@/services/api';
import { readJson, writeJson } from '@/services/storage';

function arquivo(caminho: string): File {
  const partes = caminho.split('/');
  const nome = partes.pop()!;
  return new File(new Directory(Paths.document, ...partes), nome);
}

export function portaLogoEmpresa(api: () => ApiClient): PortaLogoEmpresa {
  return {
    lerRegistro: () => readJson<LogoGuardada>(CHAVE_LOGO_EMPRESA),
    gravarRegistro: (l) => writeJson(CHAVE_LOGO_EMPRESA, l),
    baixar: (rota) => api().bytes(rota, { maxBytes: LIMITES_LOGO.bytes, timeoutMs: 20_000 }),
    async gravarArquivo(caminho, bytes) {
      const f = arquivo(caminho);
      f.create({ intermediates: true, overwrite: true });
      f.write(bytes);
    },
    async apagarTudo() {
      apagarPastaDaEmpresa();
    },
    async apagarArquivo(caminho) {
      const f = arquivo(caminho);
      if (f.exists) f.delete();
    },
  };
}

/** RN-CORE-15 (aparelho bloqueado) e troca de empresa: a pasta das logos inteira sai. */
export function apagarPastaDaEmpresa(): void {
  if (Platform.OS === 'web') return;
  const pasta = new Directory(Paths.document, PASTA_EMPRESA);
  if (pasta.exists) pasta.delete();
}

/** `file://` da cópia, se o arquivo ainda está lá; `null` no navegador ou sem o arquivo. */
export function uriDaLogo(l: LogoGuardada): string | null {
  if (Platform.OS === 'web') return null;
  try {
    const f = arquivo(l.caminho);
    return f.exists && f.size > 0 ? f.uri : null;
  } catch {
    return null;
  }
}

/** A cópia como data URI, para o PDF (`AmbienteAparelho.logoDaEmpresa`); `null` sem a cópia. */
export async function dataUriDaLogoGuardada(l: LogoGuardada | null): Promise<string | null> {
  if (!l || Platform.OS === 'web') return null;
  try {
    const f = arquivo(l.caminho);
    return f.exists ? dataUriDaLogo(l.tipo, await f.base64()) : null;
  } catch {
    return null;
  }
}
