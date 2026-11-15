'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog } from '@macuxi/ui/web';
import type { Medida, ProdutoPreco } from '../../../contracts';
import { corpoDasMedidasDoProduto, opcoesDeMedida } from '../../lib/medidas';

const campo = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal';

/**
 * Medida da unidade (obrigatória, só medida ativa) e embalagem opcional (medida + quantidade de unidades) do produto
 * (RN-CORE-19). A mesma conferência da API roda aqui para avisar antes de salvar; a API revalida.
 */
export function ProdutoMedidasDialog({ produto, medidas, onFechar, onSalvo }: { produto: ProdutoPreco; medidas: readonly Medida[]; onFechar: () => void; onSalvo: (texto: string) => void }) {
  const qc = useQueryClient();
  const [unidade, setUnidade] = useState(produto.unidade);
  const [embMedida, setEmbMedida] = useState(produto.embalagem_medida ?? '');
  const [embQtd, setEmbQtd] = useState(produto.embalagem_quantidade ? String(produto.embalagem_quantidade) : '');
  const [erroApi, setErroApi] = useState<string | null>(null);

  const opcoes = opcoesDeMedida(medidas, [produto.unidade, produto.embalagem_medida]);
  const conferido = corpoDasMedidasDoProduto({ unidade, embalagem_medida: embMedida, embalagem_quantidade: embQtd }, medidas, { unidade: produto.unidade, embalagem_medida: produto.embalagem_medida });
  const salvar = useMutation({
    mutationFn: (corpo: { unidade: string; embalagem_medida: string | null; embalagem_quantidade: number | null }) => api(`/core/produtos/${produto.id}/medidas`, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      onSalvo(`Medidas de ${produto.nome} salvas. O aparelho recebe na próxima sincronização.`);
      await qc.invalidateQueries({ queryKey: ['core'] });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });

  return (
    <Dialog
      open
      title={`Medida e embalagem · ${produto.nome}`}
      onClose={onFechar}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" disabled={salvar.isPending || !conferido.ok} onClick={() => conferido.ok && salvar.mutate(conferido.corpo)} data-testid="produtos.medidas-salvar">
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
        <label className="flex flex-col gap-1">
          Medida da unidade
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)} data-testid="produtos.medida-unidade" className={campo}>
            {opcoes.map((m) => (
              <option key={m.sigla} value={m.sigla}>
                {m.sigla} · {m.descricao}
                {m.ativo ? '' : ' (inativa)'}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2 rounded-xl border border-field p-3">
          <legend className="px-1">Embalagem (opcional)</legend>
          <label className="flex flex-col gap-1">
            Medida da embalagem
            <select value={embMedida} onChange={(e) => setEmbMedida(e.target.value)} data-testid="produtos.medida-embalagem" className={campo}>
              <option value="">Sem embalagem</option>
              {opcoes
                .filter((m) => m.sigla !== unidade)
                .map((m) => (
                  <option key={m.sigla} value={m.sigla}>
                    {m.sigla} · {m.descricao}
                    {m.ativo ? '' : ' (inativa)'}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Unidades por embalagem
            <input inputMode="numeric" value={embQtd} disabled={embMedida === ''} onChange={(e) => setEmbQtd(e.target.value.replace(/\D/g, ''))} data-testid="produtos.medida-quantidade" className={campo} />
          </label>
        </fieldset>
        {!conferido.ok && <p className="font-normal text-danger">{conferido.mensagem}</p>}
        {erroApi && <p className="font-normal text-danger">{erroApi}</p>}
        <p className="font-normal text-ink-2">Pedido, app e PDFs mostram sempre a sigla da medida vendida.</p>
      </div>
    </Dialog>
  );
}
