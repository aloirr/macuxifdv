/**
 * Marca na faixa Azul noite (marca v1, T-0172; docs/marca/manual.md §4): o logo horizontal negativo e, ao lado, o nome da
 * área no texto claro da faixa (`faixa-texto`, 8,07:1). Usada no topo do portal de implantação e do login do BKO, sobre o
 * Pérola. O nome "Macuxi Força de Vendas" é o `alt` do logo.
 */
import { PROPORCAO_LOGO_HORIZONTAL, SRC_LOGO_NEGATIVO_HORIZONTAL } from '@/lib/logo-marca';

const LARGURA_LOGO = 130;

export function MarcaNaFaixa({ area }: { area: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-faixa px-3.5 py-2.5">
      {/* data URI do SVG da marca: sem a otimização do Next (não há o que otimizar num vetor) */}
      <img
        src={SRC_LOGO_NEGATIVO_HORIZONTAL}
        alt="Macuxi Força de Vendas"
        width={LARGURA_LOGO}
        height={Math.round(LARGURA_LOGO / PROPORCAO_LOGO_HORIZONTAL)}
        className="block h-auto w-[130px]"
      />
      <span aria-hidden="true" className="h-6 w-px bg-faixa-texto/40" />
      <span className="font-display text-[15px] font-bold text-faixa-texto">{area}</span>
    </div>
  );
}
