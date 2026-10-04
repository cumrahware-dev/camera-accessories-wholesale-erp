import { PrismaClient, UserRole } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function connectWithRetry() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      console.log(`⏳ Connection attempt ${attempt} failed. Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  await connectWithRetry();
  console.log('🧹 Clearing all data except User Roles...');

  // 1. Truncate all non-user tables
  const tablesResult: Array<{ table_name: string }> = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_prisma_migrations')
  `;

  const tableNames = tablesResult.map((t) => `"${t.table_name}"`).join(', ');

  if (tableNames.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
    console.log('✅ All data tables truncated.');
  }

  // 2. Re-create / Ensure User Accounts for all User Roles exist
  console.log('👤 Creating/Restoring User accounts and roles...');

  const initialUsers = [
    {
      id: 'usr-admin-1',
      name: 'System Administrator',
      email: 'growthbridge16@gmail.com',
      role: UserRole.SUPER_ADMIN,
      passwordHash: hashPassword('Admin@Arib2026!'),
      phone: '+971 4 800 0100',
      status: 'ACTIVE' as const,
    },
    {
      id: 'usr-admin-2',
      name: 'Sarah Jenkins (Super Admin)',
      email: 'admin@aribglobal.com',
      role: UserRole.SUPER_ADMIN,
      passwordHash: hashPassword('Admin@Arib2026!'),
      phone: '+971 4 800 0101',
      status: 'ACTIVE' as const,
    },
    {
      id: 'usr-mgr',
      name: 'Marcus Vance (Manager)',
      email: 'marcus.vance@lenscore.com',
      role: UserRole.MANAGER,
      passwordHash: hashPassword('Manager@Growth2026!'),
      phone: '+971 4 800 0102',
      status: 'ACTIVE' as const,
    },
    {
      id: 'usr-erp',
      name: 'Priya Menon (ERP User)',
      email: 'priya.erp@lenscore.com',
      role: UserRole.ERP_USER,
      passwordHash: hashPassword('ErpUser@Growth2026!'),
      phone: '+971 4 800 0103',
      status: 'ACTIVE' as const,
    },
    {
      id: 'usr-depot',
      name: 'Depot Manager',
      email: 'prajwal0shetty11@gmail.com',
      role: UserRole.DEPOT_USER,
      passwordHash: hashPassword('Depot@Arib2026!'),
      phone: '+971 4 800 0104',
      status: 'ACTIVE' as const,
    },
  ];

  for (const user of initialUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, status: user.status },
      create: user,
    });
    console.log(`  - Restored User: ${user.name} (${user.email}) -> Role: ${user.role}`);
  }

  // 3. Verification
  console.log('\n================ VERIFICATION SUMMARY ================');
  const userCount = await prisma.user.count();
  console.log(`Users Total: ${userCount}`);

  const activeUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  console.table(activeUsers);

  // Single raw SQL query for counts of all other tables
  const nonUserTableCounts: Array<{ table_name: string; count: number }> = await prisma.$queryRaw`
    SELECT table_name, 
           (xpath('/row/cnt/text()', query_to_xml(format('SELECT count(*) as cnt FROM %I', table_name), false, true, '')))[1]::text::int as count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('User', '_prisma_migrations')
  `;

  const nonUserTotal = nonUserTableCounts.reduce((acc, row) => acc + Number(row.count || 0), 0);

  if (nonUserTotal === 0) {
    console.log('🎉 SUCCESS: All business data cleared! Only User roles & accounts remain in the database.');
  } else {
    console.log(`⚠️ WARNING: Found ${nonUserTotal} records in non-user tables:`);
    console.table(nonUserTableCounts.filter((r) => Number(r.count) > 0));
  }
}

main()
  .catch((err) => {
    console.error('❌ Error executing clear script:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
