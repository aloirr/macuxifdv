/**
 * Hook do slot `rota.parada_complemento` (RN-CORE-52, RN-CORE-04): nome da vendedora da carteira do cliente, lido só
 * do aparelho. O Core roda o hook em cada parada; por isso a carteira (pull `carteira` do Core) é lida uma vez por
 * ciclo de sync e indexada por cliente num armazenamento do módulo, com chave (motor, sincronizado_em): N paradas
 * chamam o loader uma vez e todas recebem a mesma referência. Os membros vêm de `useMembrosEquipeEmNome` (já sem o
 * próprio usuário). Nada novo é gravado; sem dado, devolve null.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useSyncExternalStore } from 'react';
import { complementoDaParada, indexarCarteiraPorCliente, type VinculoCarteira } from '../../domain/membros-da-equipe';
import { criarArmazenamentoPorChave } from './armazenamento-por-chave';
import { useMembrosEquipeEmNome } from './membros-equipe-em-nome';

type Motor = NonNullable<ReturnType<typeof useMotorSync>['motor']>;
type Indice = ReadonlyMap<string, readonly VinculoCarteira[]>;

const VAZIO: Indice = new Map();
const armazenamento = criarArmazenamentoPorChave<Indice>(VAZIO);

const idsDosMotores = new WeakMap<object, number>();
let proximoId = 0;
const idDoMotor = (motor: object): number => {
  let id = idsDosMotores.get(motor);
  if (id === undefined) idsDosMotores.set(motor, (id = ++proximoId));
  return id;
};

async function carregar(motor: Motor): Promise<Indice> {
  const vinculos = await motor.linhas<VinculoCarteira & LinhaSync>('carteira').catch(() => [] as (VinculoCarteira & LinhaSync)[]);
  return indexarCarteiraPorCliente(vinculos);
}

export function useComplementoDaParada(clienteId: string): string | null {
  const { motor, estado } = useMotorSync();
  const membros = useMembrosEquipeEmNome();
  useEffect(() => {
    if (motor) armazenamento.solicitar(`${idDoMotor(motor)}|${estado.sincronizado_em ?? ''}`, () => carregar(motor));
  }, [motor, estado.sincronizado_em]);
  const indice = useSyncExternalStore(armazenamento.assinar, armazenamento.obter, armazenamento.obter);
  return complementoDaParada(indice.get(clienteId), membros, new Date().toISOString());
}
