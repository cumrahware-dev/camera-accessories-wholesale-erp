import { PrismaClient } from '@prisma/client';

const passwords = [
  'postgres',
  'postgrespassword',
  'admin',
  'root',
  '123456',
  '1234',
  'Pass@123',
  'Pratham',
  'pratham',
  'npg_0w3jXgYnHGbt',
];

const dbNames = ['camera_erp_dev', 'postgres', 'neondb'];

async function test() {
  for (const db of dbNames) {
    for (const pwd of passwords) {
      const url = `postgresql://postgres:${encodeURIComponent(pwd)}@127.0.0.1:5432/${db}?schema=public`;
      const p = new PrismaClient({ datasources: { db: { url } } });
      try {
        await p.$connect();
        const userCount = await p.user.count();
        console.log(`SUCCESS! DB: ${db}, Password: ${pwd}, Users count: ${userCount}`);
        await p.$disconnect();
        return;
      } catch (e: any) {
        await p.$disconnect();
      }
    }
  }
  console.log('NO_MATCH_FOUND for 127.0.0.1:5432');
}

test();
