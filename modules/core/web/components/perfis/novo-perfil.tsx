'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MODELOS_PERFIL, type Cargo } from '@macuxi/platform-sdk';
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, rotuloDoPerfil, useToast } from '@macuxi/ui/web';
import { CODIGO_REPETIDO, MENSAGEM_NOME_OBRIGATORIO, MENSAGEM_PERFIL_REPETIDO, PerfilDetalheV2Schema, PerfilListaRespostaV2Schema, type CopiarDe } from '../../../contracts';
import { MENSAGEM_CARGO_OBRIGATORIO } from '../../../contracts/cargos';
import { frasesDaRecusa } from '../../lib/perfis';
import { PARAM_EDITAR_PERFIL } from '../../lib/parametros-url';
import { CabecalhoDoPerfil, IdentificacaoDoPerfil } from './cabecalho-perfil';

const CAMPO = 'h-[44px] w-full max-w-[420px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink';

/**
 * "Novo perfil" (ADR 0073 §4.2): Nome e Cargo, e, se quiser, partir das permissões de outro perfil ou de um modelo (cópia feita uma vez, sem
 * vínculo). Criado, a pessoa cai na tabela do perfil novo para marcar as caixas. A API revalida tudo.
 */
export function NovoPerfil() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState<Cargo | ''>('');
  const [origem, setOrigem] = useState('');
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string[]>([]);
  // o id nasce no aparelho: repetir o envio devolve o mesmo perfil (idempotente)
  const [id] = useState(() => crypto.randomUUID());

  const lista = useQuery({ queryKey: ['core', 'perfis'], queryFn: async () => PerfilListaRespostaV2Schema.parse(await api('/core/perfis')).itens });
  const voltar = () => router.push(pathname);

  const criar = useMutation({
    mutationFn: async () => {
      const copiar_de: CopiarDe | undefined = origem.startsWith('perfil:') ? { perfil: origem.slice(7) } : origem.startsWith('modelo:') ? { modelo: origem.slice(7) as (typeof MODELOS_PERFIL)[number] } : undefined;
      return PerfilDetalheV2Schema.parse(await api('/core/perfis', { method: 'POST', body: { id, nome: nome.trim(), cargo, ...(copiar_de ? { copiar_de } : {}) } }));
    },
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: ['core', 'perfis'] });
      toast('success', 'Perfil criado. Marque as permissões e salve.');
      router.push(`${pathname}?${PARAM_EDITAR_PERFIL}=${encodeURIComponent(d.perfil.codigo)}`);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === CODIGO_REPETIDO) setErro([MENSAGEM_PERFIL_REPETIDO]);
      else if (e instanceof ApiRequestError && e.status === 422) setErro(frasesDaRecusa(e.details, e.message));
      else setErro(['Não foi possível criar agora. Tente de novo.']);
    },
  });

  const enviar = () => {
    setTentou(true);
    setErro([]);
    if (nome.trim() === '' || cargo === '') return;
    criar.mutate();
  };

  if (lista.isPending) return <LoadingBlock label="Carregando os perfis…" />;
  if (lista.isError) return <ErrorBlock message="Não foi possível carregar os perfis. Confira a internet e tente de novo." onRetry={() => void lista.refetch()} />;

  return (
    <div className="flex w-full flex-col gap-5" data-testid="perfil.novo">
      <CabecalhoDoPerfil
        titulo="Novo perfil de acesso"
        acoes={
          <>
            <Button onClick={voltar} data-testid="perfil.novo.cancelar">
              Cancelar
            </Button>
            <Button variant="primary" onClick={enviar} disabled={criar.isPending} data-testid="perfil.novo.salvar">
              {criar.isPending ? 'Criando…' : 'Criar perfil'}
            </Button>
          </>
        }
      />
      <IdentificacaoDoPerfil nome={nome} cargo={cargo} onNome={setNome} onCargo={setCargo} erroNome={tentou && nome.trim() === '' ? MENSAGEM_NOME_OBRIGATORIO : null} erroCargo={tentou && cargo === '' ? MENSAGEM_CARGO_OBRIGATORIO : null} idNome="perfil-novo-nome" />
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        Copiar permissões de (opcional)
        <select className={CAMPO} value={origem} onChange={(e) => setOrigem(e.target.value)} data-testid="perfil.novo.copiar">
          <option value="">Começar sem permissões</option>
          <optgroup label="Perfis da empresa">
            {(lista.data ?? []).filter((p) => p.ativo).map((p) => (
              <option key={p.codigo} value={`perfil:${p.codigo}`}>
                {rotuloDoPerfil(p.codigo, { nome: p.nome })}
              </option>
            ))}
          </optgroup>
          <optgroup label="Modelos">
            {MODELOS_PERFIL.map((m) => (
              <option key={m} value={`modelo:${m}`}>
                {rotuloDoPerfil(m, { nome: m })}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {erro.length > 0 && (
        <Notice tone="danger">
          <span data-testid="perfil.novo.erro">{erro.join(' ')}</span>
        </Notice>
      )}
    </div>
  );
}
