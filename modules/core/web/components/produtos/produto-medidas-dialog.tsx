'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, Drawer, Notice, useToast } from '@macuxi/ui/web';
import type { Medida, ProdutoPreco } from '../../../contracts';
import { corpoDasMedidasDoProduto, opcoesDeMedida } from '../../lib/medidas';

/**
 * Medida da unidade (obrigatória, só medida ativa) e embalagem opcional (medida + quantidade de unidades) do produto
 * (RN-CORE-19). A mesma conferência da API roda aqui para avisar antes de salvar; a API revalida.
 */
export function ProdutoMedidasDialog({ produto, medidas, onFechar, onSalvo }: { produto: ProdutoPreco; medidas: readonly Medida[]; onFechar: () => void; onSalvo: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [unidade, setUnidade] = useState(produto.unidade);
  const [embMedida, setEmbMedida] = useState(produto.embalagem_medida ?? '');
  const [embQtd, setEmbQtd] = useState(produto.embalagem_quantidade ? String(produto.embalagem_quantidade) : '');
  const [erroApi, setErroApi] = useState<string | null>(null);

  const opcoes = opcoesDeMedida(medidas, [produto.unidade, produto.embalagem_medida]);
  const conferido = corpoDasMedidasDoProduto({ unidade, embalagem_medida: embMedida, embalagem_quantidade: embQtd }, medidas, { unidade: produto.unidade, embalagem_medida: produto.embalagem_medida });
  const salvar = useMutation({
    mutationFn: (corpo: { unidade: string; embalagem_medida: string | null; embalagem_quantidade: number | null }) => api(`/core/produtos/${produto.id}/medidas`, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      toast('success', 'Medidas salvas.');
      onSalvo();
      await qc.invalidateQueries({ queryKey: ['core'] });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });

  return (
    <Drawer
      open
      title={`Medidas de ${produto.nome}`}
      onClose={onFechar}
      rodape={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" disabled={salvar.isPending || !conferido.ok} onClick={() => conferido.ok && salvar.mutate(conferido.corpo)} data-testid="produtos.medidas-salvar">
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erroApi && <Notice tone="danger">{erroApi}</Notice>}
        <CampoFormulario rotulo="Medida da unidade">
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)} data-testid="produtos.medida-unidade" className={CLASSE_CAMPO}>
            {opcoes.map((m) => (
              <option key={m.sigla} value={m.sigla}>
                {m.sigla} · {m.descricao}
                {m.ativo ? '' : ' (inativa)'}
              </option>
            ))}
          </select>
        </CampoFormulario>
        <CampoFormulario rotulo="Medida da embalagem" opcional>
          <select value={embMedida} onChange={(e) => setEmbMedida(e.target.value)} data-testid="produtos.medida-embalagem" className={CLASSE_CAMPO}>
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
        </CampoFormulario>
        <CampoFormulario rotulo="Unidades por embalagem" erro={!conferido.ok ? conferido.mensagem : undefined}>
          <input inputMode="numeric" value={embQtd} disabled={embMedida === ''} onChange={(e) => setEmbQtd(e.target.value.replace(/\D/g, ''))} aria-invalid={!conferido.ok} data-testid="produtos.medida-quantidade" className={CLASSE_CAMPO} />
        </CampoFormulario>
      </div>
    </Drawer>
  );
}
