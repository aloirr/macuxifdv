/**
 * Marca na faixa Azul noite (marca v1, T-0172; docs/marca/manual.md §4): o logo horizontal negativo e, ao lado, o nome da
 * área no texto claro da faixa (`faixa-texto`, 8,07:1). Usada no topo do portal de implantação e do login do BKO, sobre o
 * Pérola. O nome "Macuxi Força de Vendas" é o `alt` do logo.
 * `naBarra`: dentro do cabeçalho do portal, que já é a faixa inteira (MC-0022/MC-0023, docs/design/telas/portal-config-enxuto.md
 * §0): sem fundo nem arredondado próprios, logo a 104 px com 14 px de folga.
 */
import { cx } from '@macuxi/ui/web';

import { PROPORCAO_LOGO_HORIZONTAL, SRC_LOGO_NEGATIVO_HORIZONTAL } from '@/lib/logo-marca';

export function MarcaNaFaixa({ area, naBarra }: { area: string; naBarra?: boolean }) {
  const largura = naBarra ? 104 : 130;
  return (
    <div className={cx('flex items-center', naBarra ? 'gap-3.5 py-3.5' : 'gap-3 rounded-xl bg-faixa px-3.5 py-2.5')}>
      {/* data URI do SVG da marca: sem a otimização do Next (não há o que otimizar num vetor) */}
      <img
        src={SRC_LOGO_NEGATIVO_HORIZONTAL}
        alt="Macuxi Força de Vendas"
        width={largura}
        height={Math.round(largura / PROPORCAO_LOGO_HORIZONTAL)}
        className={cx('block h-auto', naBarra ? 'w-[104px]' : 'w-[130px]')}
      />
      <span aria-hidden="true" className="h-6 w-px bg-faixa-texto/40" />
      <span className="text-[15px] font-bold text-faixa-texto">{area}</span>
    </div>
  );
}
