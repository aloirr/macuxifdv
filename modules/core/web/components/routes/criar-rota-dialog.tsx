'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, GrupoOpcoesCartao, IconRoute, Notice, OpcaoCartao, SelectField } from '@macuxi/ui/web';
import type { ModoConflitoRota, PreviaRotaPedido, PreviaRotaResposta, Seller } from '../../../contracts';
import { estadoDoDialogo, existentesDoPeriodo, textosDoConflito } from '../../lib/rotas-criar';
import { useBaseDoUsuario, usePrevia, useRotasBrutas } from '../../lib/rotas-criar-api';
import { useSellerCustomers } from '../../lib/queries';
import { type CalendarioDaTela, type PeriodMode, periodLabel, periodRange, shiftAnchor } from '../../lib/routes';
import { BaseDialog } from './base-dialog';
import { PeriodNav, Segmented } from './periodo-controles';

export interface PreviaCriada {
  pedido: PreviaRotaPedido;
  resposta: PreviaRotaResposta;
  mode: PeriodMode;
  anchor: string;
}

/**
 * Diálogo "Criar rota" (T-0191, RN-CORE-76; spec §3 e §3.1): vendedor e período; o botão monta a prévia, que não grava nada.
 * Os estados que bloqueiam (sem base, carteira vazia, período passado) e o conflito com rota existente vêm antes do botão.
 */
export function CriarRotaDialog({ sellers, calendario, inicial, hoje, onClose, onCriada }: { sellers: readonly Seller[]; calendario: CalendarioDaTela | null; inicial: { sellerId: string; mode: PeriodMode; anchor: string }; hoje: string; onClose: () => void; onCriada: (p: PreviaCriada) => void }) {
  const [sellerId, setSellerId] = useState(inicial.sellerId);
  const [mode, setMode] = useState<PeriodMode>(inicial.mode);
  const [anchor, setAnchor] = useState(inicial.anchor);
  const [modo, setModo] = useState<ModoConflitoRota>('so_vazios');
  const [cadastrandoBase, setCadastrandoBase] = useState(false);
  const range = useMemo(() => periodRange(mode, anchor, calendario), [mode, anchor, calendario]);

  const base = useBaseDoUsuario(sellerId || null);
  const carteira = useSellerCustomers(sellerId || null);
  const brutas = useRotasBrutas({ usuario_id: sellerId, de: range.from, ate: range.to }, true);
  const previa = usePrevia();

  const estado = !sellerId
    ? ({ tipo: 'carregando' } as const)
    : estadoDoDialogo({
        carteira: carteira.data ? carteira.data.length : null,
        base: base.data ? base.data.base : undefined,
        existentes: brutas.data ? existentesDoPeriodo(brutas.data.itens) : null,
        calendario,
        range,
        hoje,
      });
  const conflito = estado.tipo === 'pronto' ? estado.conflito : null;
  const textos = conflito ? textosDoConflito(mode === 'day', conflito) : null;
  const modoEfetivo: ModoConflitoRota = conflito && conflito.substituiveis > 0 ? modo : 'so_vazios';
  const erroDeLeitura = base.isError ? base.error : carteira.isError ? carteira.error : brutas.isError ? brutas.error : null;

  const criar = () => {
    const pedido: PreviaRotaPedido = { usuario_id: sellerId, de: range.from, ate: range.to, modo: modoEfetivo };
    previa.mutate(pedido, { onSuccess: (resposta) => onCriada({ pedido, resposta, mode, anchor }) });
  };

  const rotuloDoBotao = previa.isPending ? 'Criando…' : estado.tipo === 'carregando' && sellerId ? 'Carregando…' : 'Criar por proximidade';
  return (
    <>
      <Dialog
        open
        title="Criar rota"
        largura="media"
        onClose={previa.isPending ? () => {} : onClose}
        footer={
          <>
            <Button onClick={onClose} disabled={previa.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={criar} disabled={estado.tipo !== 'pronto' || previa.isPending} data-testid="criar-rota.criar">
              <IconRoute size={16} />
              {rotuloDoBotao}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 py-1" data-testid="criar-rota.dialogo">
          <SelectField label="Vendedor" value={sellerId} onChange={(e) => setSellerId(e.target.value)} className="h-[44px] w-full" data-testid="criar-rota.vendedor">
            <option value="">Escolha o vendedor</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-wrap items-end gap-3">
            <Segmented value={mode} onChange={setMode} grande />
            <PeriodNav label={periodLabel(mode, anchor, calendario)} onPrev={() => setAnchor(shiftAnchor(mode, anchor, -1, calendario))} onNext={() => setAnchor(shiftAnchor(mode, anchor, 1, calendario))} grande />
          </div>

          {estado.tipo === 'sem_base' && (
            <Notice tone="warning">
              Sem endereço base.{' '}
              <Button variant="link" onClick={() => setCadastrandoBase(true)} data-testid="criar-rota.cadastrar-base">
                Cadastrar
              </Button>
            </Notice>
          )}
          {estado.tipo === 'carteira_vazia' && (
            <Notice tone="warning">
              Sem clientes na carteira.{' '}
              <Link href="/carteira" className="font-semibold text-accent-ink underline">
                Abrir Carteira
              </Link>
            </Notice>
          )}
          {estado.tipo === 'passado' && <Notice tone="warning">Esse período já passou.</Notice>}
          {conflito && textos && (
            <>
              <Notice tone="warning">{textos.aviso}</Notice>
              <GrupoOpcoesCartao rotulo="Rota existente no período" testId="criar-rota.conflito">
                <OpcaoCartao nome="conflito" valor="so_vazios" selecionada={modoEfetivo === 'so_vazios'} onSelecionar={() => setModo('so_vazios')} rotulo={textos.manter} testId="criar-rota.opcao-manter" />
                <OpcaoCartao
                  nome="conflito"
                  valor="substituir"
                  selecionada={modoEfetivo === 'substituir'}
                  onSelecionar={() => setModo('substituir')}
                  rotulo={textos.substituir}
                  apoio={textos.apoio}
                  desabilitada={conflito.substituiveis === 0}
                  testId="criar-rota.opcao-substituir"
                />
              </GrupoOpcoesCartao>
            </>
          )}
          {erroDeLeitura !== null && <Notice tone="danger">{errorMessage(erroDeLeitura)}</Notice>}
          {previa.isError && <Notice tone="danger">{errorMessage(previa.error)}</Notice>}
        </div>
      </Dialog>
      {cadastrandoBase && sellerId && <BaseDialog usuarioId={sellerId} onClose={() => setCadastrandoBase(false)} />}
    </>
  );
}
