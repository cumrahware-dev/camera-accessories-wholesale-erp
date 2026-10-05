import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashSeedPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('🌱 Starting clean database seed for ARIB GLOBAL ERP...');

  // Clear existing data
  console.log('🧹 Clearing existing data...');
  // Purchasing / ledger tables are immutable for normal deletes (row triggers); a dev reseed truncates them.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "SupplierPriceSupportEvent", "SupplierPriceSupport", "JournalLine", "JournalEntry", "PurchaseInvoiceItem", "PurchaseInvoice", "DocumentSequence"'
  ).catch(() => {});
  await prisma.ocrLineItem.deleteMany();
  await prisma.ocrRawResult.deleteMany();
  await prisma.ocrDocumentEvent.deleteMany();
  await prisma.ocrDocument.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.serviceInvoiceItem.deleteMany();
  await prisma.serviceInvoice.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.cloudDocument.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.packingDetails.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.taxInvoice.deleteMany();
  await prisma.proformaItem.deleteMany();
  await prisma.proforma.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.stockTransferItem.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.stockTransaction.deleteMany();
  await prisma.depotInventory.deleteMany();
  await prisma.serialNumber.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.user.deleteMany();
  await prisma.companySettings.deleteMany();

  console.log('✅ Existing data cleared');

  // Create Company Settings
  console.log('⚙️ Creating company settings...');
  await prisma.companySettings.upsert({
    where: { id: 'global-settings' },
    update: {
      companyName: 'Arib Global General Trading LLC',
      tradingName: 'ARIB GLOBAL',
      email: 'contact@aribglobal.com',
      website: 'https://aribglobal.com',
    },
    create: {
      id: 'global-settings',
      companyName: 'Arib Global General Trading LLC',
      tradingName: 'ARIB GLOBAL',
      logoUrl: '/pdflogo.png',
      taxRegistrationNumber: '100375415500003',
      vatGstNumber: '100375415500003',
      companyAddress: 'Office G-03\nGround Floor\nRed Avenue Building\n57th St. Al Garhoud\nP. O. Box 87433\nDubai - U.A.E.',
      phone: '+971 4 800 0100',
      email: 'contact@aribglobal.com',
      website: 'https://aribglobal.com',
      currency: 'USD',
      currencySymbol: '$',
      bankName: 'Commercial Bank of Dubai, Sheikh Zayed Road Branch, Dubai, U.A.E.',
      accountName: 'Arib Global General Trading LLC',
      accountNumber: 'AE910230000001002416343',
      swiftBic: 'CBDUAEADXXX',
      iban: 'AE91 0230 0000 0100 2416 343',
      routingCode: 'CBD-0230',
      invoicePrefix: 'INV-2026-',
      proformaPrefix: 'PF-2026-',
      invoiceNextNumber: 1,
      proformaNextNumber: 1,
    },
  });
  console.log('✅ Company settings created');

  // Create Depots (Central Hub and Regional Depot for transfer testing)
  console.log('🏭 Creating depots...');
  const centralDepot = await prisma.depot.create({
    data: {
      id: 'dep-central',
      code: 'DEP-CENTRAL',
      name: 'Central Depot',
      address: 'Central Logistics Hub, Warehouse 1',
      city: 'Dubai',
      country: 'United Arab Emirates',
      contactPerson: 'Depot Manager',
      phone: '+971 4 800 0100',
      email: 'depot@aribglobal.com',
      isCentralHub: true,
      activeOrdersCount: 0,
      totalStockUnits: 0,
      totalStockValue: 0,
    },
  });

  const regionalDepot = await prisma.depot.create({
    data: {
      id: 'dep-regional',
      code: 'DEP-REGIONAL',
      name: 'Regional Depot',
      address: 'Dubai South Aviation City, Unit 4B',
      city: 'Dubai',
      country: 'United Arab Emirates',
      contactPerson: 'Regional Logistics Officer',
      phone: '+971 4 881 2299',
      email: 'regional@aribglobal.com',
      isCentralHub: false,
      activeOrdersCount: 0,
      totalStockUnits: 0,
      totalStockValue: 0,
    },
  });
  console.log(`✅ Created depots: ${centralDepot.name}, ${regionalDepot.name}`);

  // Create Standard Product Categories
  console.log('📦 Creating product categories...');
  const categories = await Promise.all([
    prisma.category.create({
      data: {
        id: 'cat-cam',
        name: 'Camera Bodies',
        slug: 'camera-bodies',
        description: 'Professional cinema and mirrorless camera bodies',
        icon: 'Camera',
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-len',
        name: 'Cinema Lenses',
        slug: 'cinema-lenses',
        description: 'High-speed cinema primes and zoom optics',
        icon: 'Disc',
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-sto',
        name: 'Storage & Media',
        slug: 'storage-media',
        description: 'CFexpress, Cinema SSDs and SDXC memory cards',
        icon: 'HardDrive',
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-lig',
        name: 'Lighting & Grip',
        slug: 'lighting-grip',
        description: 'Continuous LED lights and studio grip',
        icon: 'SunMedium',
      },
    }),
  ]);
  console.log(`✅ Created ${categories.length} categories`);

  // Create System Users matching Credential Matrix
  console.log('👤 Creating initial system users...');
  const users = await Promise.all([
    prisma.user.create({
      data: {
        id: 'usr-admin',
        name: 'Sarah Jenkins (Super Admin)',
        email: 'admin@aribglobal.com',
        role: 'SUPER_ADMIN',
        avatar: '',
        phone: '+971 4 800 0100',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Admin@Arib2026!'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-mgr',
        name: 'Marcus Vance (Manager)',
        email: 'marcus.vance@lenscore.com',
        role: 'MANAGER',
        avatar: '',
        phone: '+971 4 800 0102',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Manager@Growth2026!'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-erp',
        name: 'Priya Menon (ERP User)',
        email: 'priya.erp@lenscore.com',
        role: 'ERP_USER',
        avatar: '',
        phone: '+971 4 800 0103',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('ErpUser@Growth2026!'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-depot',
        name: 'Tariq Al-Mansoor (Depot User)',
        email: 'depot@aribglobal.com',
        role: 'DEPOT_USER',
        assignedDepotId: 'dep-central',
        assignedDepotName: 'Central Depot',
        avatar: '',
        phone: '+971 4 800 0104',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Depot@Arib2026!'),
      },
    }),
  ]);
  console.log(`✅ Created ${users.length} users`);

  console.log('🎉 Clean database seed completed successfully!');
  console.log('📝 ARIB GLOBAL ERP Database initialized.');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
