/**
 * Break-glass password reset, run on the server by someone who already has access to the database.
 *
 *   npx tsx scripts/reset-user-password.ts admin@yourcompany.com
 *
 * It sets a new random password for that ONE existing account, ends the account's current sessions, re-activates it,
 * and prints the password once. Nothing else is touched: no data is created, changed or deleted.
 * Use it when the last Super Admin password has been lost; afterwards sign in at /login and change the password.
 */
import { PrismaClient } from '@prisma/client';
import { generateTempPassword, hashPassword } from '../src/lib/auth';

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/reset-user-password.ts <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isStation: false } });
    if (!user) {
      console.error(`No user with the email ${email}.`);
      process.exit(1);
    }
    const password = generateTempPassword();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password), status: 'ACTIVE', sessionVersion: { increment: 1 } },
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id, userName: user.name, userRole: user.role, action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: user.id,
        entityLabel: user.email, description: 'Password reset from the server command line (scripts/reset-user-password.ts)',
      },
    });
    console.log(`\nPassword reset for ${user.name} <${user.email}> (${user.role}).`);
    console.log(`New password (shown once): ${password}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
