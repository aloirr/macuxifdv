'use client';

import dynamic from 'next/dynamic';
import { UFS_BRASIL, formatarCep } from '@macuxi/comum/endereco';
import { CampoFormulario } from '@macuxi/ui/web';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import type { CampoEndereco, FormEndereco } from '../../lib/endereco';

const PontoNoMapa = dynamic(() => import('./ponto-no-mapa'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-neutral-soft text-[13px] text-ink-2">Carregando mapa…</div>,
});

export interface EnderecoCamposProps {
  value: FormEndereco;
  onChange: (v: FormEndereco) => void;
  /** erros já calculados (`errosDoEndereco`); só aparecem depois de a pessoa tentar salvar */
  erros?: Partial<Record<CampoEndereco, string>>;
  centro: [number, number];
  disabled?: boolean;
  /** prefixo dos `data-testid` */
  testId: string;
}

/**
 * Componente único do endereço com o ponto no mapa (T-0191, RN-CORE-75; spec §5): CEP, rua, número, bairro, cidade, UF e o mapa de
 * 150 px com o marcador arrastável. Vale para a casa (gaveta "Editar usuário") e para o "Outro endereço" do diálogo da base.
 */
export function EnderecoCampos({ value, onChange, erros = {}, centro, disabled, testId }: EnderecoCamposProps) {
  const set = (p: Partial<FormEndereco>) => onChange({ ...value, ...p });
  const campo = (c: Exclude<CampoEndereco, 'ponto' | 'uf'>, rotulo: string, extra: { classe?: string; maxLength?: number; inputMode?: 'numeric'; formatar?: (v: string) => string } = {}) => (
    <CampoFormulario rotulo={rotulo} erro={erros[c]} className={extra.classe}>
      <input
        value={value[c]}
        maxLength={extra.maxLength}
        inputMode={extra.inputMode}
        disabled={disabled}
        aria-invalid={erros[c] ? true : undefined}
        onChange={(e) => set({ [c]: extra.formatar ? extra.formatar(e.target.value) : e.target.value })}
        className={`${CLASSE_CAMPO_BKO} w-full`}
        data-testid={`${testId}.${c}`}
      />
    </CampoFormulario>
  );
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="grid grid-cols-[130px_minmax(0,1fr)_90px] gap-3">
        {campo('cep', 'CEP', { maxLength: 9, inputMode: 'numeric', formatar: (v) => (v.replace(/\D/g, '').length === 8 ? formatarCep(v) : v) })}
        {campo('logradouro', 'Logradouro', { maxLength: 120 })}
        {campo('numero', 'Número', { maxLength: 20 })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] gap-3">
        {campo('bairro', 'Bairro', { maxLength: 80 })}
        {campo('cidade', 'Cidade', { maxLength: 80 })}
        <CampoFormulario rotulo="UF" erro={erros.uf}>
          <select
            value={value.uf.toUpperCase()}
            disabled={disabled}
            aria-invalid={erros.uf ? true : undefined}
            onChange={(e) => set({ uf: e.target.value })}
            className={`${CLASSE_CAMPO_BKO} w-full`}
            data-testid={`${testId}.uf`}
          >
            <option value="" />
            {UFS_BRASIL.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </CampoFormulario>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink">Ponto no mapa</span>
        <div className="relative isolate z-0 h-[150px] overflow-hidden rounded-xl border border-line-2" data-testid={`${testId}.mapa`}>
          <PontoNoMapa valor={value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null} onChange={(p) => set({ lat: p.lat, lng: p.lng })} centro={centro} disabled={disabled} />
        </div>
        {erros.ponto ? <span className="text-[12px] font-medium text-danger">{erros.ponto}</span> : <span className="text-[12px] text-ink-2">{value.lat !== null && value.lng !== null ? 'Arraste o marcador até a porta.' : 'Clique no mapa, na porta.'}</span>}
      </div>
    </div>
  );
}
