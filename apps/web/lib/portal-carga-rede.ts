/**
 * A `PortaCarga` (lib/portal-carga.ts) ligada às rotas reais da Integração com o tenant do cabeçalho `x-macuxi-tenant`
 * (T-0087 §5.2; R-20261106-011153). O Conector tipo arquivo do portal é criado na primeira importação (RN-INT-13): se outro
 * Conector já recebe alguma base, cria só com as livres (`detalhes.entidades_livres` do 409 `topologia_conflitante`).
 */
import {
  CargaArquivoAceita,
  ConectorCriado,
  ConferenciaArquivo,
  ENTIDADES,
  LoteResultadoBko,
  ProgressoSessaoArquivo,
  type Entidade,
} from '@macuxi/integracao/contracts';

import { chamarPortal, ErroPortal } from './portal-api';
import type { PortaCarga } from './portal-carga';
import { CONECTOR_ARQUIVO_PORTAL, ROTAS_PORTAL } from './portal-rotas';

async function criarConectorArquivo(tenant: string, entidades: readonly Entidade[]): Promise<void> {
  await chamarPortal(ROTAS_PORTAL.conectores, { metodo: 'POST', tenant, corpo: { ...CONECTOR_ARQUIVO_PORTAL, entidades }, schema: ConectorCriado });
}

export function criarPortaCarga(tenant: string): PortaCarga {
  return {
    conferir: (corpo) => chamarPortal(ROTAS_PORTAL.conferirArquivo, { metodo: 'POST', tenant, corpo, schema: ConferenciaArquivo }),
    enviarParte: (corpo) => chamarPortal(ROTAS_PORTAL.cargaArquivo, { metodo: 'POST', tenant, corpo, schema: CargaArquivoAceita }),
    garantirConectorArquivo: async (entidade) => {
      try {
        await criarConectorArquivo(tenant, ENTIDADES);
      } catch (x) {
        if (x instanceof ErroPortal && x.status === 409 && x.codigo === 'conector_ja_existe') return;
        const sugeridas = x instanceof ErroPortal && x.codigo === 'topologia_conflitante' ? x.detalhes?.entidades_livres : undefined;
        const livres = Array.isArray(sugeridas) ? (sugeridas as Entidade[]) : null;
        if (livres && livres.includes(entidade)) return criarConectorArquivo(tenant, livres);
        throw x;
      }
    },
    lerLote: (id) => chamarPortal(ROTAS_PORTAL.lote(id), { tenant, schema: LoteResultadoBko }),
    lerSessao: (id) => chamarPortal(ROTAS_PORTAL.sessaoArquivo(id), { tenant, schema: ProgressoSessaoArquivo }),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    agora: () => Date.now(),
    ehConectorAusente: (x) => x instanceof ErroPortal && x.status === 404 && x.codigo === 'CONECTOR_NAO_ENCONTRADO',
  };
}
