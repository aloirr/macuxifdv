import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditPage } from '@/components/audit/audit-page';

export const metadata: Metadata = { title: 'Auditoria' };

export default function Page() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
