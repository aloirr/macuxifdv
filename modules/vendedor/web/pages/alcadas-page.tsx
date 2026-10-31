'use client';

import { ROLE_LABEL } from '@macuxi/core/contracts';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, ErrorBlock, IconLock, LoadingBlock } from '@macuxi/ui/web';
import { DiscountEditor } from '../components/alcadas/discount-editor';
import { useDiscountPolicy, useMe, useSellers } from '../lib/queries';
import { canEditParams } from '../lib/rules';

/** Alçadas de desconto (parte da antiga tela Parâmetros; o plano de RV fica no core). */
export function AlcadasPage() {
  const me = useMe();
  const policy = useDiscountPolicy();
  const sellers = useSellers();
  const role = me.data?.user.role;
  const canEdit = canEditParams(role);
  const tz = me.data?.tenant.timezone ?? DEFAULT_TZ;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5">
      {!canEdit && role && (
        <div className="flex items-center gap-2 rounded-[10px] bg-neutral-soft px-3 py-2.5 text-[13px] text-ink-3" role="status">
          <IconLock size={15} />
          Seu perfil ({ROLE_LABEL[role]}) só consulta. Só o perfil analista edita as alçadas; o servidor também bloqueia.
        </div>
      )}
      {policy.isError && <ErrorBlock message={errorMessage(policy.error)} onRetry={() => void policy.refetch()} />}
      {policy.isPending && <LoadingBlock label="Carregando as alçadas…" />}
      {policy.data && <DiscountEditor policy={policy.data} sellers={sellers.data ?? []} canEdit={canEdit} tz={tz} />}
    </div>
  );
}
