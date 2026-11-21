'use client';

import { useMemo, useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, GrupoOpcoesCartao, LoadingBlock, Notice, OpcaoCartao, useToast } from '@macuxi/ui/web';
import type { Endereco, EnderecoBase, EnderecoComPonto, SalvarBase } from '../../../contracts';
import { linhaDoEndereco } from '../../../domain';
import { centroDosClientes, corpoDoEndereco, ENDERECO_VAZIO, errosDoEndereco, type FormEndereco, formDoEndereco } from '../../lib/endereco';
import { useSellerCustomers } from '../../lib/queries';
import { useBaseDoUsuario, useSalvarBase } from '../../lib/rotas-criar-api';
import { EnderecoCampos } from '../endereco/endereco-campos';

function Formulario({ usuarioId, casa, base, onClose, onSalva }: { usuarioId: string; casa: Endereco | null; base: EnderecoBase | null; onClose: () => void; onSalva?: () => void }) {
  const toast = useToast();
  const carteira = useSellerCustomers(usuarioId);
  const salvar = useSalvarBase(usuarioId);
  const casaUsavel = casa !== null && casa.lat !== null;
  const [tipo, setTipo] = useState<'casa' | 'outro'>(base?.tipo ?? (casaUsavel ? 'casa' : 'outro'));
  const [form, setForm] = useState<FormEndereco>(base?.tipo === 'outro' ? formDoEndereco(base) : ENDERECO_VAZIO);
  const [tentou, setTentou] = useState(false);
  const centro = useMemo(() => centroDosClientes((carteira.data ?? []).map((c) => ({ lat: c.lat, lng: c.lng }))), [carteira.data]);
  const erros = errosDoEndereco(form, { exigePonto: true });
  const semPonto = tipo === 'outro' && form.lat === null;

  const gravar = () => {
    setTentou(true);
    let corpo: SalvarBase;
    if (tipo === 'casa') corpo = { tipo: 'casa' };
    else {
      if (Object.keys(erros).length > 0) return;
      corpo = { tipo: 'outro', endereco: corpoDoEndereco(form) as EnderecoComPonto };
    }
    salvar.mutate(corpo, {
      onSuccess: () => {
        toast('success', 'Endereço base salvo e registrado na auditoria.');
        onSalva?.();
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      title="Endereço base"
      largura="media-larga"
      onClose={salvar.isPending ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={gravar} disabled={salvar.isPending || semPonto} data-testid="base.salvar">
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-1" data-testid="base.dialogo">
        <GrupoOpcoesCartao rotulo="Endereço base">
          <OpcaoCartao
            nome="base-tipo"
            valor="casa"
            selecionada={tipo === 'casa'}
            onSelecionar={() => setTipo('casa')}
            rotulo="Casa"
            apoio={!casa ? 'Sem endereço no cadastro' : casaUsavel ? linhaDoEndereco(casa) : 'Sem o ponto no mapa. Marque em Usuários.'}
            desabilitada={!casaUsavel}
            testId="base.opcao-casa"
          />
          <OpcaoCartao nome="base-tipo" valor="outro" selecionada={tipo === 'outro'} onSelecionar={() => setTipo('outro')} rotulo="Outro endereço" testId="base.opcao-outro" />
        </GrupoOpcoesCartao>
        {tipo === 'outro' && <EnderecoCampos value={form} onChange={setForm} erros={tentou ? erros : {}} centro={centro} testId="base.endereco" />}
        {salvar.isError && <Notice tone="danger">{errorMessage(salvar.error)}</Notice>}
      </div>
    </Dialog>
  );
}

/**
 * Lápis do endereço base (T-0191, RN-CORE-75; spec §5): Casa (o endereço do cadastro) ou Outro endereço, com o ponto marcado no
 * mapa. Salvar grava a base no vendedor (auditado) e vale para o marcador, o km e as próximas rotas.
 */
export function BaseDialog({ usuarioId, onClose, onSalva }: { usuarioId: string; onClose: () => void; onSalva?: () => void }) {
  const q = useBaseDoUsuario(usuarioId);
  if (q.isPending) {
    return (
      <Dialog open title="Endereço base" onClose={onClose} footer={<Button onClick={onClose}>Cancelar</Button>}>
        <LoadingBlock />
      </Dialog>
    );
  }
  if (q.isError) {
    return (
      <Dialog open title="Endereço base" onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
        <Notice tone="danger">{errorMessage(q.error)}</Notice>
      </Dialog>
    );
  }
  return <Formulario usuarioId={usuarioId} casa={q.data.casa} base={q.data.base} onClose={onClose} onSalva={onSalva} />;
}
