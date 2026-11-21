'use client';

import Link from 'next/link';
import { usePode } from '@macuxi/platform-sdk/react';
import { formatarCep } from '@macuxi/comum/endereco';
import { Button, Dialog } from '@macuxi/ui/web';
import type { ClienteFora } from '../../../contracts';
import { enderecoPermiteGerar, linhaDoEndereco, MENSAGEM_SEM_ENDERECO_CADASTRO } from '../../../domain';
import { GerarCoordenada } from '../coordenadas/gerar-coordenada';

const enderecoDe = (c: ClienteFora) => [linhaDoEndereco({ logradouro: c.logradouro ?? '', numero: c.numero ?? '', bairro: c.bairro ?? '', cidade: c.cidade ?? '', uf: c.uf ?? '' }), c.cep ? `CEP ${formatarCep(c.cep)}` : null].filter(Boolean).join(' · ') || 'Sem endereço no cadastro';

/** "Ver clientes" do alerta "ficaram fora" (T-0191, spec §4): o endereço e o CEP de cada um, o botão Gerar coordenada e o atalho para Coordenadas sugeridas. */
export function ClientesForaSemCoordenada({ itens, onClose, onGerada }: { itens: readonly ClienteFora[]; onClose: () => void; onGerada: () => void }) {
  const pode = usePode('cliente.aprovar_coordenada');
  return (
    <Dialog
      open
      title="Clientes sem coordenada"
      onClose={onClose}
      footer={
        <>
          {pode && (
            <Link href="/coordenadas-sugeridas" className="mr-auto flex h-[38px] items-center text-[13px] font-semibold text-accent-ink underline">
              Abrir Coordenadas sugeridas
            </Link>
          )}
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Clientes sem coordenada" data-testid="fora.lista">
        {itens.map((c) => (
          <li key={c.cliente_id} className="flex flex-col gap-2 border-b border-line-2 py-2.5 last:border-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="break-words text-[15px] font-semibold">{c.nome}</span>
              <span className="break-words text-[13px] text-ink-2">{enderecoDe(c)}</span>
            </div>
            {enderecoPermiteGerar(c) ? (
              <div className="flex flex-wrap items-center justify-end gap-2 sm:max-w-[200px]">
                <GerarCoordenada clienteId={c.cliente_id} jaTentado={c.ja_tentado} onGerada={onGerada} testId={`fora.cliente.${c.cliente_id}`} />
              </div>
            ) : (
              <span className="text-[13px] text-ink-2 sm:max-w-[200px]" data-testid={`fora.cliente.${c.cliente_id}.sem-endereco`}>
                {MENSAGEM_SEM_ENDERECO_CADASTRO}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** "Ver clientes" do alerta "não couberam no limite do dia": só os nomes (a carteira passa do limite de visitas por dia). */
export function ClientesForaLimite({ itens, onClose }: { itens: ReadonlyArray<{ cliente_id: string; nome: string; cidade: string | null }>; onClose: () => void }) {
  return (
    <Dialog
      open
      title="Clientes que não couberam"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Clientes que não couberam no limite do dia" data-testid="fora-limite.lista">
        {itens.map((c) => (
          <li key={c.cliente_id} className="flex min-h-[44px] flex-col justify-center border-b border-line-2 py-1.5 last:border-0">
            <span className="break-words text-[15px] font-semibold">{c.nome}</span>
            {c.cidade && <span className="text-[13px] text-ink-2">{c.cidade}</span>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
