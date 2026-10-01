import {listTokens, listUsers} from '@ai-knowledge-engine/accounts';
import {PageTitle} from '@/components/ui';
import {services} from '@/lib/services';
import {UsersTable, type UserView} from './users-table';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const {db} = await services();
  const users = await listUsers(db);
  const rows: UserView[] = await Promise.all(
    users.map(async u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      note: u.note,
      disabled: Boolean(u.disabledAt),
      dbAccess: u.dbAccess,
      activeTokens: u.activeTokens,
      lastUsedAt: u.lastUsedAt?.toISOString() ?? null,
      calls30d: u.calls30d,
      tokens: (await listTokens(db, u.id)).map(t => ({
        prefix: t.prefix,
        label: t.label,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
      })),
    })),
  );
  return (
    <>
      <PageTitle>Kullanıcılar</PageTitle>
      <UsersTable users={rows} />
    </>
  );
}
