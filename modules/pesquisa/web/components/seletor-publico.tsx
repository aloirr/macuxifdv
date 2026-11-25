'use client';

/**
 * Seleção do público da pesquisa por busca (UX-34): equipes por nome, clientes por nome ou código. Os escolhidos
 * aparecem em chips removíveis; o form guarda só os ids (contrato inalterado). Premissa: usa as rotas do Core que o BKO
 * já usa em outras telas (`GET /v1/core/equipes` e `GET /v1/core/clientes?q=`); a API continua decidindo o acesso.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@macuxi/platform-sdk/web';
import { CLASSE_CAMPO } from '@macuxi/ui/web';
import { useState } from 'react';
import { ClienteListaRespostaSchema, EquipeListaRespostaSchema } from '@macuxi/core/contracts';
import { adicionarId, listaDeTexto, removerId, rotuloCliente } from '../lib/construtor';

const MINIMO_BUSCA = 3;

interface Props {
  tipo: 'equipes' | 'clientes';
  /** Ids, um por linha (formato do form). */
  valor: string;
  onChange: (texto: string) => void;
  desabilitado?: boolean;
}

export function SeletorPublico({ tipo, valor, onChange, desabilitado }: Props) {
  const [busca, setBusca] = useState('');
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const ids = listaDeTexto(valor);
  const ehEquipe = tipo === 'equipes';

  const equipes = useQuery({
    queryKey: ['pesquisa', 'publico', 'equipes'],
    queryFn: async () => EquipeListaRespostaSchema.parse(await api<unknown>('/core/equipes')).itens,
    enabled: ehEquipe,
  });
  const termo = busca.trim();
  const clientes = useQuery({
    queryKey: ['pesquisa', 'publico', 'clientes', termo],
    queryFn: async () => ClienteListaRespostaSchema.parse(await api<unknown>('/core/clientes', { query: { q: termo, limite: 8 } })).itens,
    enabled: !ehEquipe && termo.length >= MINIMO_BUSCA,
  });

  const opcoes: { id: string; rotulo: string }[] = ehEquipe
    ? (equipes.data ?? []).filter((e) => !termo || e.nome.toLowerCase().includes(termo.toLowerCase())).map((e) => ({ id: e.id, rotulo: e.nome }))
    : (clientes.data ?? []).map((c) => ({ id: c.id, rotulo: rotuloCliente(c) }));
  const livres = opcoes.filter((o) => !ids.includes(o.id)).slice(0, 8);
  const nomeDe = (id: string) => nomes[id] ?? (ehEquipe ? equipes.data?.find((e) => e.id === id)?.nome : undefined) ?? `${ehEquipe ? 'Equipe' : 'Cliente'} ${id.slice(0, 8)}`;

  return (
    <div className="space-y-2" data-testid={`construtor.publico-${tipo}`}>
      {ids.length ? (
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={id} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-muted px-3 text-sm">
              <span>{nomeDe(id)}</span>
              {desabilitado ? null : (
                <button type="button" aria-label={`Remover ${nomeDe(id)}`} className="px-1 font-semibold" onClick={() => onChange(removerId(valor, id))}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {desabilitado ? null : (
        <>
          <input
            className={CLASSE_CAMPO}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={ehEquipe ? 'Buscar equipe pelo nome' : `Buscar cliente por nome ou código (mínimo ${MINIMO_BUSCA} letras)`}
          />
          {livres.length ? (
            <ul className="rounded border border-border">
              {livres.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="min-h-10 w-full px-3 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setNomes((n) => ({ ...n, [o.id]: o.rotulo }));
                      onChange(adicionarId(valor, o.id));
                      setBusca('');
                    }}
                  >
                    {o.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
