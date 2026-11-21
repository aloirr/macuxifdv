'use client';

import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, IconCheck } from '@macuxi/ui/web';
import { CODIGOS_GERAR_COORDENADA, type GerarCoordenadaResposta } from '../../../contracts';
import { MENSAGEM_NAO_LOCALIZADO_CADASTRO } from '../../../domain';
import { useGerarCoordenada } from '../../lib/rotas-criar-api';

const PRECISAO: Record<GerarCoordenadaResposta['precisao'], string> = { numero: 'Localizada pelo número', rua: 'Localizada pela rua', cep: 'Localizada pelo CEP' };
const CODIGOS_SEM_NOVA_TENTATIVA: readonly string[] = CODIGOS_GERAR_COORDENADA.filter((c) => c !== 'JA_TEM_COORDENADA');

/**
 * "Gerar coordenada" por cliente sem coordenada (T-0191, RN-CORE-77): um clique, uma consulta ao OpenStreetMap pelo servidor, sem
 * tentativa automática. Localizou: check e a precisão no lugar do botão. Não localizou ou já tentado: o botão some e fica só o texto
 * em vermelho. Renderiza o botão e, abaixo (linha inteira), a mensagem: o pai é uma linha `flex flex-wrap` com as ações à direita.
 * Só quem aprova coordenada vê o botão (`cliente.aprovar_coordenada`); o servidor revalida.
 */
export function GerarCoordenada({ clienteId, jaTentado = false, onGerada, testId }: { clienteId: string; jaTentado?: boolean; onGerada?: (r: GerarCoordenadaResposta) => void; testId: string }) {
  const pode = usePode('cliente.aprovar_coordenada');
  const gerar = useGerarCoordenada();
  if (!pode) return null;
  if (gerar.data) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-success" role="status" data-testid={testId}>
        <IconCheck size={15} />
        {PRECISAO[gerar.data.precisao]}
      </span>
    );
  }
  const codigo = gerar.isError && gerar.error instanceof ApiRequestError ? gerar.error.code : null;
  const semNovaTentativa = jaTentado || (codigo !== null && CODIGOS_SEM_NOVA_TENTATIVA.includes(codigo));
  if (semNovaTentativa) {
    return (
      <span className="w-full text-right text-[13px] break-words text-danger" role="status" data-testid={testId}>
        {MENSAGEM_NAO_LOCALIZADO_CADASTRO}
      </span>
    );
  }
  return (
    <>
      <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={gerar.isPending} onClick={() => gerar.mutate(clienteId, { onSuccess: (r) => onGerada?.(r) })} data-testid={`${testId}.gerar`}>
        {gerar.isPending ? 'Gerando…' : 'Gerar coordenada'}
      </Button>
      {gerar.isError && (
        <span className="w-full text-right text-[13px] text-danger" role="status">
          {errorMessage(gerar.error)}
        </span>
      )}
    </>
  );
}
