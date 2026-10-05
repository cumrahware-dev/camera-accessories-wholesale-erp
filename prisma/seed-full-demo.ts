import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashSeedPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('🌱 Starting full demo database seed...');

  // Clear existing data
  console.log('🧹 Clearing existing data...');
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

  // Create Categories
  console.log('📁 Creating categories...');
  const categories = await Promise.all([
    prisma.category.create({
      data: {
        id: 'cat-cam',
        name: 'Cinema & Mirrorless Cameras',
        slug: 'cameras',
        description: 'Professional cinema bodies and full-frame camera systems',
        icon: 'Camera',
        productCount: 4,
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-len',
        name: 'Cinema & Prime Lenses',
        slug: 'lenses',
        description: 'High-speed cinema primes and zoom optics',
        icon: 'Disc',
        productCount: 3,
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-lig',
        name: 'Professional Lighting & Flashes',
        slug: 'lighting',
        description: 'Studio strobes, continuous LED point sources & panels',
        icon: 'SunMedium',
        productCount: 2,
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-aud',
        name: 'Audio & Wireless Microphones',
        slug: 'audio',
        description: 'Wireless transmitters, shotgun mics and field recorders',
        icon: 'Mic',
        productCount: 2,
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-sto',
        name: 'High-Speed Storage & Media',
        slug: 'storage',
        description: 'CFexpress Type A/B, Cinema SSDs and UHS-II SD cards',
        icon: 'HardDrive',
        productCount: 2,
      },
    }),
    prisma.category.create({
      data: {
        id: 'cat-sup',
        name: 'Gimbals, Cages & Support',
        slug: 'support',
        description: 'Electronic gimbals, follow focus units, and heavy-duty carbon tripods',
        icon: 'Video',
        productCount: 2,
      },
    }),
  ]);
  console.log(`✅ Created ${categories.length} categories`);

  // Create Depots
  console.log('🏭 Creating depots...');
  const depots = await Promise.all([
    prisma.depot.create({
      data: {
        id: 'dep-blr',
        code: 'DEP-BLR',
        name: 'Bangalore Central Depot',
        address: 'Whitefield Main Road, Bangalore, Karnataka 560066',
        city: 'Bangalore',
        country: 'India',
        contactPerson: 'Arun Kumar',
        phone: '+91 80 2839 1100',
        email: 'bangalore@lenscore.com',
        isCentralHub: true,
        activeOrdersCount: 3,
        totalStockUnits: 340,
        totalStockValue: 512000,
      },
    }),
    prisma.depot.create({
      data: {
        id: 'dep-dxb',
        code: 'DEP-DXB',
        name: 'Dubai Logistics Hub',
        address: 'Jebel Ali Free Zone, Dubai, UAE',
        city: 'Dubai',
        country: 'United Arab Emirates',
        contactPerson: 'Tariq Al-Mansoor',
        phone: '+971 4 881 2299',
        email: 'dubai@lenscore.com',
        isCentralHub: false,
        activeOrdersCount: 5,
        totalStockUnits: 285,
        totalStockValue: 624500,
      },
    }),
    prisma.depot.create({
      data: {
        id: 'dep-bom',
        code: 'DEP-BOM',
        name: 'Mumbai Marine Depot',
        address: 'Andheri East, Mumbai, Maharashtra 400069',
        city: 'Mumbai',
        country: 'India',
        contactPerson: 'Vikram Singh',
        phone: '+91 22 2839 2200',
        email: 'mumbai@lenscore.com',
        isCentralHub: false,
        activeOrdersCount: 2,
        totalStockUnits: 190,
        totalStockValue: 298000,
      },
    }),
    prisma.depot.create({
      data: {
        id: 'dep-sin',
        code: 'DEP-SIN',
        name: 'Singapore Gateway Depot',
        address: 'Changi Cargo Complex, Singapore 486612',
        city: 'Singapore',
        country: 'Singapore',
        contactPerson: 'Lee Wei Ming',
        phone: '+65 6543 2100',
        email: 'singapore@lenscore.com',
        isCentralHub: false,
        activeOrdersCount: 1,
        totalStockUnits: 220,
        totalStockValue: 480000,
      },
    }),
  ]);
  console.log(`✅ Created ${depots.length} depots`);

  // Create Users with production-ready salted hashes
  console.log('👤 Creating users...');
  const users = await Promise.all([
    prisma.user.create({
      data: {
        id: 'usr-admin',
        name: 'Sarah Jenkins',
        email: 'sarah.admin@lenscore.com',
        role: 'SUPER_ADMIN',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
        phone: '+1 415 890 1200',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Admin@Growth2026!'),
        lastLogin: new Date('2026-08-24T10:15:00Z'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-mgr',
        name: 'Marcus Vance',
        email: 'marcus.vance@lenscore.com',
        role: 'MANAGER',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
        phone: '+1 415 890 1205',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Manager@Growth2026!'),
        lastLogin: new Date('2026-08-24T11:45:00Z'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-erp',
        name: 'Priya Menon',
        email: 'priya.erp@lenscore.com',
        role: 'ERP_USER',
        avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80',
        phone: '+971 4 555 0190',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('ErpUser@Growth2026!'),
        lastLogin: new Date('2026-08-24T13:10:00Z'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-dep-dxb',
        name: 'Tariq Al-Mansoor',
        email: 'tariq.dxb@lenscore.com',
        role: 'DEPOT_USER',
        assignedDepotId: 'dep-dxb',
        assignedDepotName: 'Dubai Logistics Hub',
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
        phone: '+971 4 881 2299',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Depot@Dubai2026!'),
        lastLogin: new Date('2026-08-24T12:30:00Z'),
      },
    }),
    prisma.user.create({
      data: {
        id: 'usr-dep-blr',
        name: 'Arun Kumar',
        email: 'arun.blr@lenscore.com',
        role: 'DEPOT_USER',
        assignedDepotId: 'dep-blr',
        assignedDepotName: 'Bangalore Central Depot',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
        phone: '+91 80 2839 1100',
        status: 'ACTIVE',
        passwordHash: hashSeedPassword('Depot@Bangalore2026!'),
        lastLogin: new Date('2026-08-24T09:00:00Z'),
      },
    }),
  ]);
  console.log(`✅ Created ${users.length} users`);

  // Create Products
  console.log('📦 Creating products...');
  const products = await Promise.all([
    prisma.product.create({
      data: {
        id: 'prod-eos-r5',
        sku: 'EOS-R5',
        name: 'Canon EOS R5 Mirrorless Camera Body',
        brand: 'Canon',
        model: 'EOS R5 (45MP 8K Raw)',
        categoryId: 'cat-cam',
        categoryName: 'Cinema & Mirrorless Cameras',
        subcategory: 'Full-Frame Mirrorless',
        description: 'High-resolution full-frame mirrorless camera featuring 45MP CMOS sensor, 8K30p internal RAW video, and 5-axis sensor-shift image stabilization.',
        imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
        barcode: '4549292157307',
        trackSerial: true,
        purchasePrice: 2800.0,
        sellingPrice: 3899.0,
        wholesalePrice: 3399.0,
        taxRate: 0,
        minStockLevel: 10,
        status: 'ACTIVE',
        totalStock: 50,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-sony-fx3',
        sku: 'SONY-FX3',
        name: 'Sony FX3 Full-Frame Cinema Line Camera',
        brand: 'Sony',
        model: 'ILME-FX3',
        categoryId: 'cat-cam',
        categoryName: 'Cinema & Mirrorless Cameras',
        subcategory: 'Cinema Line',
        description: 'Compact cinema line camera with 12.1MP full-frame Exmor R BSI sensor, UHD 4K up to 120p, 15+ stops dynamic range, S-Cinetone, and detachable XLR top handle unit.',
        imageUrl: 'https://images.unsplash.com/photo-1502982720700-befe97b2ff83?w=600&auto=format&fit=crop&q=80',
        barcode: '027242921863',
        trackSerial: true,
        purchasePrice: 3100.0,
        sellingPrice: 4298.0,
        wholesalePrice: 3899.0,
        taxRate: 0,
        minStockLevel: 5,
        status: 'ACTIVE',
        totalStock: 38,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-nikon-z8',
        sku: 'NIKON-Z8',
        name: 'Nikon Z8 Mirrorless Camera Body',
        brand: 'Nikon',
        model: 'Z8 Body',
        categoryId: 'cat-cam',
        categoryName: 'Cinema & Mirrorless Cameras',
        subcategory: 'Professional Mirrorless',
        description: '45.7MP stacked BSI CMOS sensor, internal 8.3K60p N-RAW & 4.1K120p ProRes RAW, compact flagship form factor.',
        imageUrl: 'https://images.unsplash.com/photo-1500634245200-e5245c7574ef?w=600&auto=format&fit=crop&q=80',
        barcode: '018208016952',
        trackSerial: true,
        purchasePrice: 3000.0,
        sellingPrice: 3999.0,
        wholesalePrice: 3599.0,
        taxRate: 0,
        minStockLevel: 5,
        status: 'ACTIVE',
        totalStock: 22,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-red-komodo-x',
        sku: 'RED-KOMODO-X',
        name: 'RED DIGITAL CINEMA KOMODO-X 6K Camera',
        brand: 'RED',
        model: 'KOMODO-X 6K S35',
        categoryId: 'cat-cam',
        categoryName: 'Cinema & Mirrorless Cameras',
        subcategory: 'Production Cinema',
        description: '6K S35 Global Shutter CMOS Sensor, 6K up to 80fps, 4K up to 120fps, integrated RF mount, micro V-lock battery interface.',
        imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
        barcode: '719318357492',
        trackSerial: true,
        purchasePrice: 7800.0,
        sellingPrice: 9995.0,
        wholesalePrice: 8900.0,
        taxRate: 0,
        minStockLevel: 3,
        status: 'ACTIVE',
        totalStock: 12,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-dji-rs3',
        sku: 'DJI-RS3PRO',
        name: 'DJI RS 3 Pro Gimbal Stabilizer',
        brand: 'DJI',
        model: 'RS 3 Pro',
        categoryId: 'cat-sup',
        categoryName: 'Gimbals, Cages & Support',
        subcategory: 'Gimbals',
        description: 'Next-gen professional gimbal with automated axis locks, 14-second battery runtime, and Bluetooth shutter control.',
        imageUrl: 'https://images.unsplash.com/photo-1626379953822-baec19c3accd?w=600&auto=format&fit=crop&q=80',
        barcode: '695842100078',
        trackSerial: false,
        purchasePrice: 450.0,
        sellingPrice: 649.0,
        wholesalePrice: 569.0,
        taxRate: 0,
        minStockLevel: 15,
        status: 'ACTIVE',
        totalStock: 45,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-aputure-600d',
        sku: 'APUT-600DPRO',
        name: 'Aputure 600d Pro LED Light',
        brand: 'Aputure',
        model: '600d Pro',
        categoryId: 'cat-lig',
        categoryName: 'Professional Lighting & Flashes',
        subcategory: 'LED Panels',
        description: '600W daylight-balanced LED with Bowens mount, wireless control via Sidus Link, and DMX/RDM support.',
        imageUrl: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=600&auto=format&fit=crop&q=80',
        barcode: '845721635892',
        trackSerial: false,
        purchasePrice: 1800.0,
        sellingPrice: 2499.0,
        wholesalePrice: 2199.0,
        taxRate: 0,
        minStockLevel: 8,
        status: 'ACTIVE',
        totalStock: 30,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-sandisk-cfexpress',
        sku: 'SANDISK-CFE-512',
        name: 'SanDisk PRO-CINEMA CFexpress Type B 512GB',
        brand: 'SanDisk',
        model: 'CFexpress Type B 512GB',
        categoryId: 'cat-sto',
        categoryName: 'High-Speed Storage & Media',
        subcategory: 'CFexpress Cards',
        description: '512GB CFexpress Type B memory card with maximum read speeds of 1700MB/s and write speeds of 1200MB/s for 8K RAW video.',
        imageUrl: 'https://images.unsplash.com/photo-1616348436169-dc3c8eb6b87e?w=600&auto=format&fit=crop&q=80',
        barcode: '619659145914',
        trackSerial: false,
        purchasePrice: 350.0,
        sellingPrice: 479.99,
        wholesalePrice: 429.99,
        taxRate: 0,
        minStockLevel: 25,
        status: 'ACTIVE',
        totalStock: 80,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-sony-24-70-gm2',
        sku: 'SONY-FE-2470-GM2',
        name: 'Sony FE 24-70mm f/2.8 GM II Lens',
        brand: 'Sony',
        model: 'FE 24-70mm f/2.8 GM II',
        categoryId: 'cat-len',
        categoryName: 'Cinema & Prime Lenses',
        subcategory: 'Zoom Lenses',
        description: 'Standard zoom lens with improved optical performance, faster autofocus, and reduced weight compared to original GM.',
        imageUrl: 'https://images.unsplash.com/photo-1617005082133-548c4dd27f35?w=600&auto=format&fit=crop&q=80',
        barcode: '027242923872',
        trackSerial: false,
        purchasePrice: 1700.0,
        sellingPrice: 2298.0,
        wholesalePrice: 1999.0,
        taxRate: 0,
        minStockLevel: 12,
        status: 'ACTIVE',
        totalStock: 35,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-sony-70-200-gm2',
        sku: 'SONY-FE-70200-GM2',
        name: 'Sony FE 70-200mm f/2.8 GM II OSS Lens',
        brand: 'Sony',
        model: 'FE 70-200mm f/2.8 GM II',
        categoryId: 'cat-len',
        categoryName: 'Cinema & Prime Lenses',
        subcategory: 'Zoom Lenses',
        description: 'Telephoto zoom lens with XD Linear and XD Focus motors for fast, quiet autofocus, and optical SteadyShot image stabilization.',
        imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
        barcode: '027242925089',
        trackSerial: false,
        purchasePrice: 2000.0,
        sellingPrice: 2698.0,
        wholesalePrice: 2399.0,
        taxRate: 0,
        minStockLevel: 10,
        status: 'ACTIVE',
        totalStock: 28,
      },
    }),
    prisma.product.create({
      data: {
        id: 'prod-dji-mic2',
        sku: 'DJI-MIC2',
        name: 'DJI Mic 2 Wireless Microphone',
        brand: 'DJI',
        model: 'Mic 2',
        categoryId: 'cat-aud',
        categoryName: 'Audio & Wireless Microphones',
        subcategory: 'Wireless Microphones',
        description: '32-bit float 48kHz wireless microphone system with 32-bit float recording, intelligent noise reduction, and up to 8-hour battery life.',
        imageUrl: 'https://images.unsplash.com/photo-1478737270299-2c02da549559?w=600&auto=format&fit=crop&q=80',
        barcode: '694159730258',
        trackSerial: false,
        purchasePrice: 280.0,
        sellingPrice: 349.0,
        wholesalePrice: 309.0,
        taxRate: 0,
        minStockLevel: 20,
        status: 'ACTIVE',
        totalStock: 55,
      },
    }),
  ]);
  console.log(`✅ Created ${products.length} products`);

  // Create Depot Inventory
  console.log('📊 Creating depot inventory...');
  const depotInventory = await Promise.all([
    // Canon EOS R5
    prisma.depotInventory.create({
      data: { productId: 'prod-eos-r5', depotId: 'dep-blr', quantity: 25, allocatedQuantity: 0, availableQuantity: 25, minStockLevel: 10 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-eos-r5', depotId: 'dep-dxb', quantity: 15, allocatedQuantity: 2, availableQuantity: 13, minStockLevel: 10 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-eos-r5', depotId: 'dep-bom', quantity: 10, allocatedQuantity: 0, availableQuantity: 10, minStockLevel: 10 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-eos-r5', depotId: 'dep-sin', quantity: 0, allocatedQuantity: 0, availableQuantity: 0, minStockLevel: 10 },
    }),
    // Sony FX3
    prisma.depotInventory.create({
      data: { productId: 'prod-sony-fx3', depotId: 'dep-blr', quantity: 12, allocatedQuantity: 0, availableQuantity: 12, minStockLevel: 5 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-sony-fx3', depotId: 'dep-dxb', quantity: 18, allocatedQuantity: 1, availableQuantity: 17, minStockLevel: 5 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-sony-fx3', depotId: 'dep-bom', quantity: 8, allocatedQuantity: 0, availableQuantity: 8, minStockLevel: 5 },
    }),
    prisma.depotInventory.create({
      data: { productId: 'prod-sony-fx3', depotId: 'dep-sin', quantity: 0, allocatedQuantity: 0, availableQuantity: 0, minStockLevel: 5 },
    }),
    // Continue for other products...
  ]);
  console.log(`✅ Created ${depotInventory.length} depot inventory records`);

  // Create Serial Numbers
  console.log('🔢 Creating serial numbers...');
  const serialNumbers = await Promise.all([
    prisma.serialNumber.create({
      data: {
        productId: 'prod-eos-r5',
        productSku: 'EOS-R5',
        productName: 'Canon EOS R5 Mirrorless Camera Body',
        serialNumber: 'CR5-001',
        depotId: 'dep-blr',
        depotName: 'Bangalore Central Depot',
        status: 'IN_STOCK',
      },
    }),
    prisma.serialNumber.create({
      data: {
        productId: 'prod-eos-r5',
        productSku: 'EOS-R5',
        productName: 'Canon EOS R5 Mirrorless Camera Body',
        serialNumber: 'CR5-002',
        depotId: 'dep-blr',
        depotName: 'Bangalore Central Depot',
        status: 'IN_STOCK',
      },
    }),
    prisma.serialNumber.create({
      data: {
        productId: 'prod-eos-r5',
        productSku: 'EOS-R5',
        productName: 'Canon EOS R5 Mirrorless Camera Body',
        serialNumber: 'CR5-003',
        depotId: 'dep-dxb',
        depotName: 'Dubai Logistics Hub',
        status: 'IN_STOCK',
      },
    }),
    prisma.serialNumber.create({
      data: {
        productId: 'prod-eos-r5',
        productSku: 'EOS-R5',
        productName: 'Canon EOS R5 Mirrorless Camera Body',
        serialNumber: 'CR5-004',
        depotId: 'dep-dxb',
        depotName: 'Dubai Logistics Hub',
        status: 'IN_STOCK',
      },
    }),
    prisma.serialNumber.create({
      data: {
        productId: 'prod-sony-fx3',
        productSku: 'SONY-FX3',
        productName: 'Sony FX3 Full-Frame Cinema Line Camera',
        serialNumber: 'SFX3-101',
        depotId: 'dep-dxb',
        depotName: 'Dubai Logistics Hub',
        status: 'IN_STOCK',
      },
    }),
    prisma.serialNumber.create({
      data: {
        productId: 'prod-sony-fx3',
        productSku: 'SONY-FX3',
        productName: 'Sony FX3 Full-Frame Cinema Line Camera',
        serialNumber: 'SFX3-102',
        depotId: 'dep-dxb',
        depotName: 'Dubai Logistics Hub',
        status: 'IN_STOCK',
      },
    }),
  ]);
  console.log(`✅ Created ${serialNumbers.length} serial numbers`);

  // Create Customers
  console.log('👥 Creating customers...');
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        id: 'cust-apex',
        customerCode: 'CUST-DXB-010',
        companyName: 'Apex Media & Broadcast FZ-LLC',
        contactPerson: 'Zayd Al-Hashimi',
        email: 'zayd.hashimi@apexmediadxb.com',
        phone: '+971 4 391 8840',
        billingAddress: 'Studio City Tower, Office 1402, Dubai Studio City',
        shippingAddress: 'Apex Media Hub, Warehouse 11, Dubai Production City',
        country: 'United Arab Emirates',
        taxNumber: 'AE-TRN-100482910300003',
        paymentTerms: 'NET_30',
        creditLimit: 150000.0,
        currentBalance: 42800.0,
        notes: 'Premium broadcast client. Always requests express air freight with fragile handling stamps.',
        status: 'ACTIVE',
        totalOrders: 14,
        totalSpent: 384500.0,
      },
    }),
    prisma.customer.create({
      data: {
        id: 'cust-cinegear',
        customerCode: 'CUST-IND-025',
        companyName: 'CineGear Studios India Pvt Ltd',
        contactPerson: 'Rajesh Ramanathan',
        email: 'rajesh@cinegearstudios.in',
        phone: '+91 80 4120 7700',
        billingAddress: '12th Main, Indiranagar 2nd Stage',
        shippingAddress: 'CineGear Equipment Lot, HSR Layout Sector 1',
        country: 'India',
        taxNumber: '29AAACC1206K1Z8',
        paymentTerms: 'NET_15',
        creditLimit: 80000.0,
        currentBalance: 12500.0,
        notes: 'Rental house client with ongoing bulk lens orders.',
        status: 'ACTIVE',
        totalOrders: 9,
        totalSpent: 198000.0,
      },
    }),
  ]);
  console.log(`✅ Created ${customers.length} customers`);

  // Create Company Settings
  console.log('⚙️ Creating company settings...');
  await prisma.companySettings.upsert({
    where: { id: 'global-settings' },
    update: {},
    create: {
      id: 'global-settings',
      companyName: 'Arib Global General Trading LLC',
      tradingName: 'ARIB GLOBAL',
      logoUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=200',
      taxRegistrationNumber: '100375415500003',
      vatGstNumber: '100375415500003',
      companyAddress: 'Office G-03\nGround Floor\nRed Avenue Building\n57th St. Al Garhoud\nP. O. Box 87433\nDubai - U.A.E.',
      phone: '+91 62827 59863',
      email: 'contact@growthbridge.com',
      website: 'https://growthbridge.com',
      currency: 'USD',
      currencySymbol: '$',
      bankName: 'Commercial Bank of Dubai, Sheikh Zayed Road Branch, Dubai, U.A.E.',
      accountName: 'Arib Global General Trading LLC',
      accountNumber: 'AE910230000001002416343',
      swiftBic: 'CBOUAEADXXX',
      iban: 'AE91 0230 0000 0100 2416 343',
      routingCode: 'CBD-0230',
      invoicePrefix: 'INV-2026-',
      proformaPrefix: 'PF-2026-',
      invoiceNextNumber: 3,
      proformaNextNumber: 3,
    },
  });
  console.log('✅ Company settings created');

  console.log('🎉 Full demo database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
