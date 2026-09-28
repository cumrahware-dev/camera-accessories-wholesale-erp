import {
  User,
  Depot,
  Category,
  Product,
  SerialNumber,
  DepotInventory,
  StockTransaction,
  StockTransfer,
  StockAdjustment,
  Customer,
  Supplier,
  Proforma,
  TaxInvoice,
  Shipment,
  CloudDocument,
  AuditLog,
  Notification,
  ProfitabilityMetric,
  BusinessInsight,
  CompanySettings,
  UserRole,
} from '@/types/erp';
import { formatUSD } from '@/lib/utils';

function getFs(): typeof import('fs') | null {
  if (typeof window === 'undefined') {
    try {
      return require('fs');
    } catch {
      return null;
    }
  }
  return null;
}

function getPath(): typeof import('path') | null {
  if (typeof window === 'undefined') {
    try {
      return require('path');
    } catch {
      return null;
    }
  }
  return null;
}

// Clean Initial Single Depot Infrastructure
const INITIAL_DEPOTS: Depot[] = [
  {
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
];

const INITIAL_USERS: User[] = [
  {
    id: 'usr-admin',
    name: 'System Administrator',
    email: 'admin@aribglobal.com',
    role: 'SUPER_ADMIN',
    avatar: '',
    phone: '+971 4 800 0100',
    status: 'ACTIVE',
    lastLogin: new Date().toISOString(),
  },
  {
    id: 'usr-depot',
    name: 'Depot Manager',
    email: 'depot@aribglobal.com',
    role: 'DEPOT_USER',
    assignedDepotId: 'dep-central',
    assignedDepotName: 'Central Depot',
    avatar: '',
    phone: '+971 4 800 0100',
    status: 'ACTIVE',
    lastLogin: new Date().toISOString(),
  },
];

const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-cam', name: 'Cinema & Mirrorless Cameras', slug: 'cameras', description: 'Professional cinema bodies and systems', icon: 'Camera', productCount: 0 },
  { id: 'cat-len', name: 'Cinema & Prime Lenses', slug: 'lenses', description: 'High-speed cinema primes and zoom optics', icon: 'Disc', productCount: 0 },
  { id: 'cat-lig', name: 'Professional Lighting & Flashes', slug: 'lighting', description: 'Studio strobes & continuous LED panels', icon: 'SunMedium', productCount: 0 },
  { id: 'cat-aud', name: 'Audio & Wireless Microphones', slug: 'audio', description: 'Wireless transmitters & shotgun mics', icon: 'Mic', productCount: 0 },
  { id: 'cat-sto', name: 'High-Speed Storage & Media', slug: 'storage', description: 'CFexpress, Cinema SSDs and SD cards', icon: 'HardDrive', productCount: 0 },
  { id: 'cat-sup', name: 'Gimbals, Cages & Support', slug: 'support', description: 'Electronic gimbals and heavy-duty tripods', icon: 'Video', productCount: 0 },
];

const INITIAL_PRODUCTS: Product[] = [];
const INITIAL_SERIAL_NUMBERS: SerialNumber[] = [];
const INITIAL_CUSTOMERS: Customer[] = [];
const INITIAL_PROFORMAS: Proforma[] = [];
const INITIAL_INVOICES: TaxInvoice[] = [];
const INITIAL_SHIPMENTS: Shipment[] = [];
const INITIAL_DOCUMENTS: CloudDocument[] = [];
const INITIAL_TRANSFERS: StockTransfer[] = [];
const INITIAL_ADJUSTMENTS: StockAdjustment[] = [];
const INITIAL_AUDIT_LOGS: AuditLog[] = [];
const INITIAL_NOTIFICATIONS: Notification[] = [];

const INITIAL_COMPANY_SETTINGS: CompanySettings = {
  companyName: 'ARIB GLOBAL',
  tradingName: 'ARIB GLOBAL',
  logoUrl: '/pdflogo.png',
  sealUrl: '/arib-seal.png',
  taxRegistrationNumber: 'VAT-99201-US-GLOBAL',
  vatGstNumber: 'TRN-100889218200001',
  companyAddress: 'Office 402, Business Bay, Dubai, UAE',
  phone: '+971 4 800 0100',
  email: 'contact@aribglobal.com',
  website: 'https://aribglobal.com',
  currency: 'USD',
  currencySymbol: '$',
  bankDetails: {
    bankName: 'Commercial Bank of Dubai, Sheikh Zayed Road Branch, Dubai, U.A.E.',
    accountName: 'Arib Global General Trading LLC',
    accountNumber: 'AE910230000001002416343',
    swiftBic: 'CBOUAEADXXX',
    iban: 'AE91 0230 0000 0100 2416 343',
    routingCode: 'CBD-0230',
  },
  invoicePrefix: 'INV-2026-',
  proformaPrefix: 'PF-2026-',
  invoiceNextNumber: 1,
  proformaNextNumber: 1,
  defaultPaymentTerms: 'Cash In Advance',
  defaultDeliveryTerms: 'C&F Vietnam Airport',
  freightVolumetricDivisor: 5000,
  freightDefaultRatePerKg: 0,
};

const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'supp-sony-me',
    name: 'Sony Middle East & Africa FZE',
    contactPerson: 'Kenji Takahashi',
    email: 'pro-sales@sony-mea.com',
    phone: '+971 4 881 5000',
    address: 'JAFZA View 19, Jebel Ali Free Zone, Dubai, UAE',
    country: 'United Arab Emirates',
    taxId: 'TRN-100234567800003',
    paymentTerms: 'NET_60',
  },
  {
    id: 'supp-canon-me',
    name: 'Canon Middle East FZ-LLC',
    contactPerson: 'David Miller',
    email: 'distribution@canon-me.com',
    phone: '+971 4 444 1100',
    address: 'Dubai Internet City, Building 10, Dubai, UAE',
    country: 'United Arab Emirates',
    taxId: 'TRN-100883344500003',
    paymentTerms: 'NET_30',
  },
];

// State Store Class with Live Disk Sync and Global Singleton
class DataStore {
  private users: User[] = INITIAL_USERS;
  private depots: Depot[] = INITIAL_DEPOTS;
  private categories: Category[] = INITIAL_CATEGORIES;
  private products: Product[] = INITIAL_PRODUCTS;
  private serialNumbers: SerialNumber[] = INITIAL_SERIAL_NUMBERS;
  private customers: Customer[] = INITIAL_CUSTOMERS;
  private suppliers: Supplier[] = INITIAL_SUPPLIERS;
  private proformas: Proforma[] = INITIAL_PROFORMAS;
  private invoices: TaxInvoice[] = INITIAL_INVOICES;
  private serviceInvoices: any[] = [];
  private shipments: Shipment[] = INITIAL_SHIPMENTS;
  private documents: CloudDocument[] = INITIAL_DOCUMENTS;
  private transfers: StockTransfer[] = INITIAL_TRANSFERS;
  private adjustments: StockAdjustment[] = INITIAL_ADJUSTMENTS;
  private auditLogs: AuditLog[] = INITIAL_AUDIT_LOGS;
  private notifications: Notification[] = INITIAL_NOTIFICATIONS;
  private companySettings: CompanySettings = INITIAL_COMPANY_SETTINGS;

  private currentUserId: string = 'usr-admin';
  private lastDiskMtime: number = 0;

  constructor() {
    this.loadFromStorage();
    this.loadFromDisk();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const storedUser = localStorage.getItem('erp_current_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        if (parsed.id) this.currentUserId = parsed.id;
      }
    } catch {}
  }

  private checkReloadFromDisk() {
    const fs = getFs();
    const p = getPath();
    if (!fs || !p) return;
    try {
      const filePath = p.join(process.cwd(), 'data', 'erp-store.json');
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > this.lastDiskMtime) {
          this.loadFromDisk();
        }
      }
    } catch {}
  }

  public loadFromDisk() {
    const fs = getFs();
    const p = getPath();
    if (!fs || !p) return;

    try {
      const dir = p.join(process.cwd(), 'data');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = p.join(dir, 'erp-store.json');
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        this.lastDiskMtime = stat.mtimeMs;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          if (Array.isArray(data.users) && data.users.length > 0) this.users = data.users;
          if (Array.isArray(data.depots) && data.depots.length > 0) this.depots = data.depots;
          if (Array.isArray(data.categories) && data.categories.length > 0) this.categories = data.categories;
          if (Array.isArray(data.products)) this.products = data.products;
          if (Array.isArray(data.serialNumbers)) this.serialNumbers = data.serialNumbers;
          if (Array.isArray(data.customers)) this.customers = data.customers;
          if (Array.isArray(data.suppliers)) {
            this.suppliers = data.suppliers;
          } else if (!this.suppliers || !Array.isArray(this.suppliers)) {
            this.suppliers = [...INITIAL_SUPPLIERS];
          }
          if (Array.isArray(data.proformas)) this.proformas = data.proformas;
          if (Array.isArray(data.invoices)) this.invoices = data.invoices;
          if (Array.isArray(data.serviceInvoices)) this.serviceInvoices = data.serviceInvoices;
          if (Array.isArray(data.shipments)) this.shipments = data.shipments;
          if (Array.isArray(data.documents)) this.documents = data.documents;
          if (Array.isArray(data.transfers)) this.transfers = data.transfers;
          if (Array.isArray(data.adjustments)) this.adjustments = data.adjustments;
          if (Array.isArray(data.auditLogs)) this.auditLogs = data.auditLogs;
          if (Array.isArray(data.notifications)) this.notifications = data.notifications;
          if (data.companySettings) this.companySettings = { ...this.companySettings, ...data.companySettings };
          return;
        }
      }
      this.saveToDisk();
    } catch (err) {
      console.error('[DataStore] Error loading data from disk:', err);
    }
  }

  public saveToDisk() {
    const fs = getFs();
    const p = getPath();
    if (!fs || !p) return;

    try {
      const dir = p.join(process.cwd(), 'data');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = p.join(dir, 'erp-store.json');
      const state = {
        users: this.users,
        depots: this.depots,
        categories: this.categories,
        products: this.products,
        serialNumbers: this.serialNumbers,
        customers: this.customers,
        suppliers: this.suppliers,
        proformas: this.proformas,
        invoices: this.invoices,
        serviceInvoices: this.serviceInvoices,
        shipments: this.shipments,
        documents: this.documents,
        transfers: this.transfers,
        adjustments: this.adjustments,
        auditLogs: this.auditLogs,
        notifications: this.notifications,
        companySettings: this.companySettings,
      };
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
      const stat = fs.statSync(filePath);
      this.lastDiskMtime = stat.mtimeMs;
    } catch (err) {
      console.error('[DataStore] Error saving data to disk:', err);
    }
  }

  // --- USERS & AUTH ---
  public getUsers(): User[] {
    this.checkReloadFromDisk();
    return this.users;
  }

  public getUserById(id: string): User | undefined {
    this.checkReloadFromDisk();
    return this.users.find((u) => u.id === id);
  }

  public getUserByAccessCodeLookupHash(lookupHash: string): User | undefined {
    this.checkReloadFromDisk();
    return this.users.find((u) => u.accessCodeLookupHash === lookupHash);
  }

  public getCurrentUser(): User {
    this.checkReloadFromDisk();
    return this.getUserById(this.currentUserId) || this.users[0];
  }

  public setCurrentUser(userId: string): void {
    this.currentUserId = userId;
  }

  public createUser(data: any): User {
    this.checkReloadFromDisk();
    const user: User = {
      id: data.id || `usr-${Date.now()}`,
      name: data.name,
      email: data.email,
      role: data.role || 'ERP_USER',
      avatar: data.avatar || '',
      phone: data.phone || '',
      assignedDepotId: data.assignedDepotId || data.depotId,
      assignedDepotName: data.assignedDepotName || data.depot?.name,
      status: data.status || 'ACTIVE',
      passwordHash: data.passwordHash,
      accessCodeHash: data.accessCodeHash || '',
      accessCodeLookupHash: data.accessCodeLookupHash,
      lastLogin: data.lastLogin || new Date().toISOString(),
    };
    this.users.push(user);
    this.saveToDisk();
    return user;
  }

  public updateUser(id: string, data: Partial<User>): User | null {
    this.checkReloadFromDisk();
    const user = this.users.find((u) => u.id === id);
    if (!user) return null;
    Object.assign(user, data);
    this.saveToDisk();
    return user;
  }

  public deleteUser(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    this.users.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  public addAuditLog(entry: Partial<AuditLog>): void {
    this.checkReloadFromDisk();
    const log: AuditLog = {
      id: `log-${Date.now()}`,
      userId: this.currentUserId,
      userName: this.getCurrentUser()?.name || 'System User',
      userRole: this.getCurrentUser()?.role || 'SUPER_ADMIN',
      action: entry.action || 'USER_PERMISSION_CHANGE',
      entityType: entry.entityType || 'USER',
      entityId: entry.entityId || '',
      entityLabel: entry.entityLabel || '',
      description: entry.description || '',
      ipAddress: '127.0.0.1',
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    this.saveToDisk();
  }

  // --- DEPOTS ---
  public getDepots(): Depot[] {
    this.checkReloadFromDisk();
    return this.depots;
  }

  public getDepotById(id: string): Depot | undefined {
    this.checkReloadFromDisk();
    return this.depots.find((d) => d.id === id || d.code === id);
  }

  public createDepot(data: any): Depot {
    this.checkReloadFromDisk();
    const d: Depot = {
      id: data.id || `dep-${Date.now()}`,
      code: data.code || `DEP-${Date.now()}`,
      name: data.name,
      address: data.address || '',
      city: data.city || '',
      country: data.country || '',
      contactPerson: data.contactPerson || '',
      phone: data.phone || '',
      email: data.email || '',
      isCentralHub: data.isCentralHub ?? false,
      activeOrdersCount: 0,
      totalStockUnits: 0,
      totalStockValue: 0,
    };
    this.depots.push(d);
    this.saveToDisk();
    return d;
  }

  public updateDepot(id: string, data: Partial<Depot>): Depot | null {
    this.checkReloadFromDisk();
    const d = this.getDepotById(id);
    if (!d) return null;
    Object.assign(d, data);
    this.saveToDisk();
    return d;
  }

  public deleteDepot(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.depots.findIndex((d) => d.id === id || d.code === id);
    if (idx === -1) return false;
    this.depots.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // --- PRODUCTS & INVENTORY ---
  public getProducts(): Product[] {
    this.checkReloadFromDisk();
    return this.products.map((p) => ({ ...p, imageUrl: '/placeholder-product.svg' }));
  }

  public getProductById(id: string): Product | undefined {
    this.checkReloadFromDisk();
    const p = this.products.find((p) => p.id === id || p.sku === id);
    return p ? { ...p, imageUrl: '/placeholder-product.svg' } : undefined;
  }

  public createProduct(data: any): Product {
    this.checkReloadFromDisk();
    const p: Product = {
      id: data.id || `prod-${Date.now()}`,
      sku: data.sku,
      name: data.name,
      brand: data.brand,
      model: data.model || '',
      categoryId: data.categoryId || 'cat-cam',
      categoryName: data.categoryName || 'Cinema & Mirrorless Cameras',
      description: data.description || '',
      imageUrl: '/placeholder-product.svg',
      barcode: data.barcode || data.sku,
      trackSerial: data.trackSerial ?? true,
      purchasePrice: Number(data.purchasePrice) || 0,
      wholesalePrice: Number(data.wholesalePrice) || 0,
      sellingPrice: Number(data.sellingPrice) || Number(data.wholesalePrice) || 0,
      taxRate: Number(data.taxRate) || 5,
      minStockLevel: Number(data.minStockLevel) || 10,
      totalStock: Number(data.totalStock) || 0,
      status: data.status || 'ACTIVE',
      depotBreakdown: data.depotBreakdown || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = this.products.findIndex((prod) => prod.id === p.id || prod.sku === p.sku);
    if (idx >= 0) {
      this.products[idx] = p;
    } else {
      this.products.unshift(p);
    }
    this.saveToDisk();
    return p;
  }

  public updateProduct(id: string, data: Partial<Product>): Product | null {
    this.checkReloadFromDisk();
    const p = this.getProductById(id);
    if (!p) return null;
    Object.assign(p, data, { updatedAt: new Date().toISOString() });
    this.saveToDisk();
    return p;
  }

  public deleteProduct(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.products.findIndex((p) => p.id === id || p.sku === id);
    if (idx === -1) return false;
    this.products.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  public getCategories(): Category[] {
    this.checkReloadFromDisk();
    return this.categories;
  }

  public createCategory(data: any): Category {
    this.checkReloadFromDisk();
    const cat: Category = {
      id: data.id || `cat-${Date.now()}`,
      name: data.name,
      slug: data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: data.description || '',
      icon: data.icon || 'Camera',
      productCount: 0,
    };
    this.categories.push(cat);
    this.saveToDisk();
    return cat;
  }

  public getSerialNumbers(productId?: string): SerialNumber[] {
    this.checkReloadFromDisk();
    if (productId) {
      return this.serialNumbers.filter((s) => s.productId === productId);
    }
    return this.serialNumbers;
  }

  public createSerialNumber(data: any): SerialNumber {
    this.checkReloadFromDisk();
    const s: SerialNumber = {
      id: data.id || `sn-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productId: data.productId,
      productSku: data.productSku || '',
      productName: data.productName || '',
      serialNumber: data.serialNumber,
      depotId: data.depotId,
      depotName: data.depotName || 'Central Depot',
      status: data.status || 'IN_STOCK',
      invoiceId: data.invoiceId,
      invoiceNumber: data.invoiceNumber,
      history: data.history || (data.historyJson ? JSON.parse(data.historyJson) : []),
      createdAt: data.createdAt || new Date().toISOString(),
    };
    const idx = this.serialNumbers.findIndex((item) => item.serialNumber === s.serialNumber && item.productId === s.productId);
    if (idx >= 0) {
      this.serialNumbers[idx] = s;
    } else {
      this.serialNumbers.unshift(s);
    }
    this.saveToDisk();
    return s;
  }

  public updateSerialNumberStatus(serialNumber: string, status: any, invoiceId?: string, invoiceNumber?: string): boolean {
    this.checkReloadFromDisk();
    const sn = this.serialNumbers.find((s) => s.serialNumber === serialNumber);
    if (!sn) return false;
    sn.status = status;
    if (invoiceId) sn.invoiceId = invoiceId;
    if (invoiceNumber) sn.invoiceNumber = invoiceNumber;
    this.saveToDisk();
    return true;
  }

  // --- CUSTOMERS ---
  public syncCustomerMetrics(customerId: string): void {
    this.checkReloadFromDisk();
    const cust = this.customers.find((c) => c.id === customerId || c.customerCode === customerId);
    if (!cust) return;
    const custInvoices = this.invoices.filter(
      (i) => (i.customerId === cust.id || i.customerId === cust.customerCode) && i.fulfilmentStatus !== 'CANCELLED'
    );
    cust.totalOrders = custInvoices.length;
    cust.totalSpent = custInvoices
      .filter((i) => i.paymentStatus === 'PAID')
      .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0);
    cust.currentBalance = custInvoices
      .filter((i) => i.paymentStatus !== 'PAID')
      .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0);
    this.saveToDisk();
  }

  public getCustomers(): Customer[] {
    this.checkReloadFromDisk();
    return this.customers.map((c) => {
      const custInvoices = this.invoices.filter(
        (i) => (i.customerId === c.id || i.customerId === c.customerCode) && i.fulfilmentStatus !== 'CANCELLED'
      );
      if (custInvoices.length > 0) {
        return {
          ...c,
          totalOrders: custInvoices.length,
          totalSpent: custInvoices
            .filter((i) => i.paymentStatus === 'PAID')
            .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0),
          currentBalance: custInvoices
            .filter((i) => i.paymentStatus !== 'PAID')
            .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0),
        };
      }
      return {
        ...c,
        currentBalance: Math.max(0, c.currentBalance || 0),
      };
    });
  }

  public getCustomerById(id: string): Customer | undefined {
    this.checkReloadFromDisk();
    const c = this.customers.find((c) => c.id === id || c.customerCode === id);
    if (!c) return undefined;
    const custInvoices = this.invoices.filter(
      (i) => (i.customerId === c.id || i.customerId === c.customerCode) && i.fulfilmentStatus !== 'CANCELLED'
    );
    if (custInvoices.length > 0) {
      c.totalOrders = custInvoices.length;
      c.totalSpent = custInvoices
        .filter((i) => i.paymentStatus === 'PAID')
        .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0);
      c.currentBalance = custInvoices
        .filter((i) => i.paymentStatus !== 'PAID')
        .reduce((sum, i) => sum + (Number(i.grandTotal) || 0), 0);
    } else {
      c.currentBalance = Math.max(0, c.currentBalance || 0);
    }
    return c;
  }

  public createCustomer(data: any): Customer {
    this.checkReloadFromDisk();
    const c: Customer = {
      id: data.id || `cust-${Date.now()}`,
      customerCode: data.customerCode || `CUST-${Date.now()}`,
      companyName: data.companyName,
      contactPerson: data.contactPerson,
      email: data.email,
      phone: data.phone || '',
      billingAddress: data.billingAddress || '',
      shippingAddress: data.shippingAddress || data.billingAddress || '',
      country: data.country || 'UAE',
      taxNumber: data.taxNumber || '',
      paymentTerms: data.paymentTerms || 'NET_30',
      creditLimit: Number(data.creditLimit) || 50000,
      currentBalance: Number(data.currentBalance) || 0,
      totalOrders: Number(data.totalOrders) || 0,
      totalSpent: Number(data.totalSpent) || 0,
      notes: data.notes || '',
      status: data.status || 'ACTIVE',
      createdAt: data.createdAt || new Date().toISOString(),
    };
    const idx = this.customers.findIndex((cust) => cust.id === c.id);
    if (idx >= 0) {
      this.customers[idx] = c;
    } else {
      this.customers.unshift(c);
    }
    this.saveToDisk();
    return c;
  }

  public updateCustomer(id: string, data: Partial<Customer>): Customer | null {
    this.checkReloadFromDisk();
    const c = this.getCustomerById(id);
    if (!c) return null;
    Object.assign(c, data);
    this.saveToDisk();
    return c;
  }

  public deleteCustomer(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.customers.findIndex((c) => c.id === id || c.customerCode === id);
    if (idx === -1) return false;
    this.customers.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // --- SUPPLIERS ---
  private ensureSuppliers() {
    if (!this.suppliers || !Array.isArray(this.suppliers)) {
      this.suppliers = [...INITIAL_SUPPLIERS];
    }
  }

  public getSuppliers(filter?: { search?: string }): Supplier[] {
    this.checkReloadFromDisk();
    this.ensureSuppliers();
    let result = [...this.suppliers];
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.contactPerson.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.phone && s.phone.toLowerCase().includes(q)) ||
          s.country.toLowerCase().includes(q)
      );
    }
    return result;
  }

  public getSupplierById(id: string): Supplier | undefined {
    this.checkReloadFromDisk();
    this.ensureSuppliers();
    return this.suppliers.find((s) => s.id === id);
  }

  public createSupplier(data: any): Supplier {
    this.checkReloadFromDisk();
    this.ensureSuppliers();
    const s: Supplier = {
      id: data.id || `supp-${Date.now()}`,
      name: data.name,
      contactPerson: data.contactPerson || '',
      email: data.email,
      phone: data.phone || '',
      address: data.address || '',
      country: data.country || 'United Arab Emirates',
      taxId: data.taxId || '',
      paymentTerms: data.paymentTerms || 'NET_30',
    };
    const idx = this.suppliers.findIndex((item) => item.id === s.id);
    if (idx >= 0) {
      this.suppliers[idx] = s;
    } else {
      this.suppliers.unshift(s);
    }
    this.saveToDisk();
    return s;
  }

  public updateSupplier(id: string, data: Partial<Supplier>): Supplier | null {
    this.checkReloadFromDisk();
    const s = this.getSupplierById(id);
    if (!s) return null;
    Object.assign(s, data);
    this.saveToDisk();
    return s;
  }

  public deleteSupplier(id: string): boolean {
    this.checkReloadFromDisk();
    this.ensureSuppliers();
    const idx = this.suppliers.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.suppliers.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // --- SERVICE INVOICES ---
  private ensureServiceInvoices() {
    if (!this.serviceInvoices || !Array.isArray(this.serviceInvoices)) {
      this.serviceInvoices = [];
    }
  }

  public getServiceInvoices(filter?: { status?: string; search?: string }): any[] {
    this.checkReloadFromDisk();
    this.ensureServiceInvoices();
    let result = [...this.serviceInvoices];
    if (filter?.status && filter.status !== 'ALL') {
      result = result.filter((i) => i.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (i) =>
          (i.invoiceNumber && i.invoiceNumber.toLowerCase().includes(q)) ||
          (i.customerName && i.customerName.toLowerCase().includes(q)) ||
          (i.customerCompany && i.customerCompany.toLowerCase().includes(q)) ||
          (i.customerEmail && i.customerEmail.toLowerCase().includes(q))
      );
    }
    return result;
  }

  public getServiceInvoiceById(id: string): any | undefined {
    this.checkReloadFromDisk();
    this.ensureServiceInvoices();
    return this.serviceInvoices.find((i) => i.id === id || i.invoiceNumber === id);
  }

  public createServiceInvoice(data: any): any {
    this.checkReloadFromDisk();
    this.ensureServiceInvoices();
    const count = this.serviceInvoices.length;
    const inv: any = {
      id: data.id || `sinv-${Date.now()}`,
      invoiceNumber: data.invoiceNumber || `SINV-${String(count + 1).padStart(6, '0')}`,
      customerId: data.customerId,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerCompany: data.customerCompany,
      customerPhone: data.customerPhone || '',
      billingAddress: data.billingAddress || '',
      issueDate: data.issueDate || new Date().toISOString(),
      dueDate: data.dueDate || new Date(Date.now() + 14 * 86400000).toISOString(),
      paymentTerms: data.paymentTerms || 'NET_30',
      status: data.status || 'DRAFT',
      currency: data.currency || 'USD',
      subtotal: data.subtotal || 0,
      discountAmount: data.discountAmount || 0,
      taxAmount: data.taxAmount || 0,
      otherCharges: data.otherCharges || 0,
      grandTotal: data.grandTotal || 0,
      notes: data.notes || '',
      internalRemarks: data.internalRemarks || '',
      items: data.items || [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const idx = this.serviceInvoices.findIndex((item) => item.id === inv.id || item.invoiceNumber === inv.invoiceNumber);
    if (idx >= 0) {
      this.serviceInvoices[idx] = inv;
    } else {
      this.serviceInvoices.unshift(inv);
    }
    this.saveToDisk();
    return inv;
  }

  public updateServiceInvoice(id: string, data: any): any | null {
    this.checkReloadFromDisk();
    this.ensureServiceInvoices();
    const inv = this.getServiceInvoiceById(id);
    if (!inv) return null;
    Object.assign(inv, data, { updatedAt: new Date().toISOString() });
    this.saveToDisk();
    return inv;
  }

  public deleteServiceInvoice(id: string): boolean {
    this.checkReloadFromDisk();
    this.ensureServiceInvoices();
    const idx = this.serviceInvoices.findIndex((i) => i.id === id || i.invoiceNumber === id);
    if (idx === -1) return false;
    this.serviceInvoices.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // --- PROFORMAS ---
  public getProformas(filter?: { status?: string; customerId?: string }): Proforma[] {
    this.checkReloadFromDisk();
    let result = [...this.proformas];
    if (filter?.status && filter.status !== 'ALL') {
      result = result.filter((p) => p.status === filter.status);
    }
    if (filter?.customerId) {
      result = result.filter((p) => p.customerId === filter.customerId);
    }
    return result;
  }

  public getProformaById(id: string): Proforma | undefined {
    this.checkReloadFromDisk();
    return this.proformas.find((p) => p.id === id || p.proformaNumber === id);
  }

  public createProforma(data: any): Proforma {
    this.checkReloadFromDisk();
    const nextNum = this.companySettings.proformaNextNumber || 1;
    const proformaNumber = data.proformaNumber || `${this.companySettings.proformaPrefix || 'PF-2026-'}${String(nextNum).padStart(5, '0')}`;
    this.companySettings.proformaNextNumber = nextNum + 1;

    const p: Proforma = {
      id: data.id || `pf-${Date.now()}`,
      proformaNumber,
      customerId: data.customerId,
      customerName: data.customerName,
      customerCompany: data.customerCompany,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone || '',
      billingAddress: data.billingAddress || '',
      shippingAddress: data.shippingAddress || '',
      managerId: data.managerId || 'usr-admin',
      managerName: data.managerName || 'System Admin',
      status: data.status || 'DRAFT',
      issueDate: data.issueDate || new Date().toISOString(),
      expiryDate: data.expiryDate || data.validUntil || new Date(Date.now() + 14 * 86400000).toISOString(),
      currency: data.currency || 'USD',
      subtotal: Number(data.subtotal) || 0,
      discountPercent: Number(data.discountPercent) || 0,
      discountAmount: Number(data.discountAmount) || 0,
      taxAmount: Number(data.taxAmount) || 0,
      shippingCost: Number(data.shippingCost) || 0,
      otherCharges: Number(data.otherCharges) || 0,
      grandTotal: Number(data.grandTotal) || 0,
      actualWeightKg: Number(data.actualWeightKg) || 0,
      volumetricWeightKg: Number(data.volumetricWeightKg) || 0,
      chargeableWeightKg: Number(data.chargeableWeightKg) || 0,
      freightRatePerKg: Number(data.freightRatePerKg) || 0,
      freightCharge: Number(data.freightCharge) || 0,
      additionalFreightCharges: Number(data.additionalFreightCharges) || 0,
      freightVolumetricDivisor: Number(data.freightVolumetricDivisor) || 0,
      freightIsManualOverride: Boolean(data.freightIsManualOverride),
      freightAllocationMethod: data.freightAllocationMethod ?? null,
      items: data.items || [],
      notes: data.notes || '',
      paymentTerms: data.paymentTerms || 'Cash In Advance',
      deliveryTerms: data.deliveryTerms || 'C&F Vietnam Airport',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.proformas.unshift(p);
    this.saveToDisk();
    return p;
  }

  public updateProforma(id: string, data: Partial<Proforma>): Proforma | null {
    this.checkReloadFromDisk();
    const p = this.getProformaById(id);
    if (!p) return null;
    Object.assign(p, data, { updatedAt: new Date().toISOString() });
    this.saveToDisk();
    return p;
  }

  public deleteProforma(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.proformas.findIndex((p) => p.id === id || p.proformaNumber === id);
    if (idx === -1) return false;
    this.proformas.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // --- INVOICES ---
  public getInvoices(filter?: { status?: string; customerId?: string; depotId?: string }): TaxInvoice[] {
    this.checkReloadFromDisk();
    let result = [...this.invoices];
    if (filter?.status && filter.status !== 'ALL') {
      result = result.filter((i) => i.fulfilmentStatus === filter.status);
    }
    if (filter?.customerId) {
      result = result.filter((i) => i.customerId === filter.customerId);
    }
    if (filter?.depotId) {
      result = result.filter((i) => i.depotId === filter.depotId);
    }
    return result;
  }

  public getInvoiceById(id: string): TaxInvoice | undefined {
    this.checkReloadFromDisk();
    return this.invoices.find(
      (i) => i.id === id || i.invoiceNumber === id || i.proformaId === id || i.proformaNumber === id
    );
  }

  public createInvoice(data: any): TaxInvoice {
    this.checkReloadFromDisk();
    const nextNum = this.companySettings.invoiceNextNumber || 1;
    const invoiceNumber = data.invoiceNumber || `${this.companySettings.invoicePrefix || 'INV-2026-'}${String(nextNum).padStart(5, '0')}`;
    this.companySettings.invoiceNextNumber = nextNum + 1;

    const inv: TaxInvoice = {
      id: data.id || `inv-${Date.now()}`,
      invoiceNumber,
      proformaId: data.proformaId,
      proformaNumber: data.proformaNumber,
      customerId: data.customerId,
      customerName: data.customerName,
      customerCompany: data.customerCompany,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone || '',
      billingAddress: data.billingAddress || '',
      shippingAddress: data.shippingAddress || '',
      depotId: data.depotId || 'dep-central',
      depotName: data.depotName || 'Central Depot',
      managerId: data.managerId || 'usr-admin',
      managerName: data.managerName || 'System Admin',
      fulfilmentStatus: data.fulfilmentStatus || 'READY_FOR_PACKING',
      paymentStatus: data.paymentStatus || 'UNPAID',
      issueDate: data.issueDate || new Date().toISOString(),
      dueDate: data.dueDate || new Date(Date.now() + 30 * 86400000).toISOString(),
      paymentTerms: data.paymentTerms || 'Cash In Advance',
      currency: data.currency || 'USD',
      subtotal: Number(data.subtotal) || 0,
      discountAmount: Number(data.discountAmount) || 0,
      taxAmount: Number(data.taxAmount) || 0,
      shippingCost: Number(data.shippingCost) || 0,
      otherCharges: Number(data.otherCharges) || 0,
      grandTotal: Number(data.grandTotal) || 0,
      actualWeightKg: Number(data.actualWeightKg) || 0,
      volumetricWeightKg: Number(data.volumetricWeightKg) || 0,
      chargeableWeightKg: Number(data.chargeableWeightKg) || 0,
      freightRatePerKg: Number(data.freightRatePerKg) || 0,
      freightCharge: Number(data.freightCharge) || 0,
      additionalFreightCharges: Number(data.additionalFreightCharges) || 0,
      freightVolumetricDivisor: Number(data.freightVolumetricDivisor) || 0,
      freightIsManualOverride: Boolean(data.freightIsManualOverride),
      freightAllocationMethod: data.freightAllocationMethod ?? null,
      items: data.items || [],
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.invoices.unshift(inv);
    if (inv.customerId) {
      this.syncCustomerMetrics(inv.customerId);
    }
    this.saveToDisk();
    return inv;
  }

  public updateInvoice(id: string, data: Partial<TaxInvoice>): TaxInvoice | null {
    this.checkReloadFromDisk();
    const inv = this.getInvoiceById(id);
    if (!inv) return null;
    Object.assign(inv, data, { updatedAt: new Date().toISOString() });
    if (inv.customerId) {
      this.syncCustomerMetrics(inv.customerId);
    }
    this.saveToDisk();
    return inv;
  }

  public deleteInvoice(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.invoices.findIndex((i) => i.id === id || i.invoiceNumber === id);
    if (idx === -1) return false;
    const [deleted] = this.invoices.splice(idx, 1);
    if (deleted?.customerId) {
      this.syncCustomerMetrics(deleted.customerId);
    }
    this.saveToDisk();
    return true;
  }

  // --- SHIPMENTS ---
  public getShipments(): Shipment[] {
    this.checkReloadFromDisk();
    return this.shipments;
  }

  public getShipmentById(id: string): Shipment | undefined {
    this.checkReloadFromDisk();
    return this.shipments.find((s) => s.id === id || s.invoiceId === id);
  }

  public createShipment(data: any): Shipment {
    this.checkReloadFromDisk();
    const s: Shipment = {
      id: data.id || `ship-${Date.now()}`,
      shipmentNumber: data.shipmentNumber || `SHP-${Date.now()}`,
      invoiceId: data.invoiceId,
      invoiceNumber: data.invoiceNumber,
      customerId: data.customerId || '',
      customerName: data.customerName || '',
      customerCompany: data.customerCompany || '',
      destinationCountry: data.destinationCountry || 'International',
      shippingAddress: data.shippingAddress || '',
      depotId: data.depotId || 'dep-central',
      depotName: data.depotName || 'Central Depot',
      courier: data.courier || 'DHL_EXPRESS',
      airwayBillNumber: data.airwayBillNumber || `AWB-${Date.now()}`,
      trackingUrl: data.trackingUrl || '',
      shippingDate: data.shippingDate || new Date().toISOString(),
      estimatedDeliveryDate: data.estimatedDeliveryDate || new Date(Date.now() + 5 * 86400000).toISOString(),
      shippingCost: Number(data.shippingCost) || 0,
      weightKg: Number(data.weightKg || data.totalWeightKg) || 1,
      packageCount: Number(data.packageCount) || 1,
      airwayBillDocUrl: data.awbDocumentUrl || data.airwayBillDocUrl || '',
      status: data.status || 'DISPATCHED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.shipments.unshift(s);
    this.saveToDisk();
    return s;
  }

  public updateShipment(id: string, patch: Partial<Shipment>): Shipment | undefined {
    this.checkReloadFromDisk();
    const idx = this.shipments.findIndex(
      (s) => s.id === id || s.shipmentNumber === id || s.invoiceId === id || s.airwayBillNumber === id
    );
    if (idx === -1) return undefined;
    const now = new Date().toISOString();
    this.shipments[idx] = {
      ...this.shipments[idx],
      ...patch,
      updatedAt: now,
    };
    if (patch.status === 'DELIVERED') {
      this.shipments[idx].actualDeliveryDate = this.shipments[idx].actualDeliveryDate || now;
      (this.shipments[idx] as any).deliveredAt = (this.shipments[idx] as any).deliveredAt || now;
      const inv = this.getInvoiceById(this.shipments[idx].invoiceId);
      if (inv) {
        inv.fulfilmentStatus = 'DELIVERED';
        inv.updatedAt = now;
      }
    }
    this.saveToDisk();
    return this.shipments[idx];
  }

  public deliverShipment(shipmentIdOrInvoiceId: string): boolean {
    this.checkReloadFromDisk();
    const now = new Date().toISOString();
    const shipment = this.shipments.find(
      (s) =>
        s.id === shipmentIdOrInvoiceId ||
        s.invoiceId === shipmentIdOrInvoiceId ||
        s.shipmentNumber === shipmentIdOrInvoiceId ||
        s.airwayBillNumber === shipmentIdOrInvoiceId
    );
    if (shipment) {
      shipment.status = 'DELIVERED';
      shipment.actualDeliveryDate = shipment.actualDeliveryDate || now;
      (shipment as any).deliveredAt = (shipment as any).deliveredAt || now;
      shipment.updatedAt = now;
    }
    const invId = shipment?.invoiceId || shipmentIdOrInvoiceId;
    const inv = this.getInvoiceById(invId);
    if (inv) {
      inv.fulfilmentStatus = 'DELIVERED';
      inv.updatedAt = now;
    }
    this.saveToDisk();
    return Boolean(shipment || inv);
  }

  public getTransfers(): StockTransfer[] {
    this.checkReloadFromDisk();
    return this.transfers;
  }

  public createTransfer(data: any): StockTransfer {
    this.checkReloadFromDisk();
    const nextNum = this.transfers.length + 1;
    const transferNumber = data.transferNumber || `TR-2026-${String(nextNum).padStart(5, '0')}`;
    const tr: StockTransfer = {
      id: data.id || `tr-${Date.now()}`,
      transferNumber,
      sourceDepotId: data.sourceDepotId,
      sourceDepotName: data.sourceDepotName || 'Source Depot',
      destinationDepotId: data.destinationDepotId,
      destinationDepotName: data.destinationDepotName || 'Destination Depot',
      items: data.items || [],
      status: data.status || 'PENDING',
      notes: data.notes || '',
      createdBy: data.createdBy || 'System',
      createdAt: data.createdAt || new Date().toISOString(),
    };

    // Deduct from source and add to destination in product depot breakdown
    for (const item of tr.items) {
      const product = this.getProductById(item.productId);
      if (product) {
        if (!product.depotBreakdown) product.depotBreakdown = {};
        const srcQty = product.depotBreakdown[tr.sourceDepotId] || 0;
        product.depotBreakdown[tr.sourceDepotId] = Math.max(0, srcQty - item.quantity);
        const destQty = product.depotBreakdown[tr.destinationDepotId] || 0;
        product.depotBreakdown[tr.destinationDepotId] = destQty + item.quantity;
        product.totalStock = Object.values(product.depotBreakdown).reduce((sum, q) => sum + q, 0);
      }
    }

    this.transfers.unshift(tr);
    this.saveToDisk();
    return tr;
  }

  public updateTransfer(id: string, data: Partial<StockTransfer>): StockTransfer | null {
    this.checkReloadFromDisk();
    const tr = this.transfers.find((t) => t.id === id);
    if (!tr) return null;
    Object.assign(tr, data);
    this.saveToDisk();
    return tr;
  }

  public getAdjustments(): StockAdjustment[] {
    this.checkReloadFromDisk();
    return this.adjustments;
  }

  public createAdjustment(data: any): StockAdjustment {
    this.checkReloadFromDisk();
    const adj: StockAdjustment = {
      id: data.id || `adj-${Date.now()}`,
      productId: data.productId,
      productSku: data.productSku || '',
      productName: data.productName || '',
      depotId: data.depotId,
      depotName: data.depotName || 'Central Depot',
      deltaQty: Number(data.deltaQty) || 0,
      previousQty: Number(data.previousQty) || 0,
      newQty: Number(data.newQty) || (Number(data.previousQty || 0) + Number(data.deltaQty || 0)),
      reason: data.reason || 'OTHER',
      user: data.user || 'System Admin',
      notes: data.notes || '',
      createdAt: data.createdAt || new Date().toISOString(),
    };
    this.adjustments.unshift(adj);

    // Apply adjustment to product stock
    const product = this.getProductById(adj.productId);
    if (product) {
      if (!product.depotBreakdown) product.depotBreakdown = {};
      const currentDepotStock = product.depotBreakdown[adj.depotId] || 0;
      product.depotBreakdown[adj.depotId] = Math.max(0, currentDepotStock + adj.deltaQty);
      product.totalStock = Object.values(product.depotBreakdown).reduce((sum, q) => sum + q, 0);
    }

    this.saveToDisk();
    return adj;
  }

  // --- DOCUMENTS ---
  public getDocuments(filter?: { category?: string; entityId?: string }): CloudDocument[] {
    this.checkReloadFromDisk();
    let result = [...this.documents];
    if (filter?.category && filter.category !== 'ALL') {
      result = result.filter((d) => d.category === filter.category);
    }
    if (filter?.entityId) {
      result = result.filter((d) => d.relatedEntityId === filter.entityId);
    }
    return result;
  }

  public createDocument(data: any): CloudDocument {
    this.checkReloadFromDisk();
    const doc: CloudDocument = {
      id: data.id || `doc-${Date.now()}`,
      title: data.title || data.fileName || 'Document',
      category: data.category || 'OTHER',
      fileName: data.fileName || 'document.pdf',
      fileSize: Number(data.fileSize) || 1024,
      fileType: data.fileType || 'application/pdf',
      fileFormat: data.fileFormat || 'pdf',
      cloudinaryUrl: data.cloudinaryUrl || data.fileUrl || data.url || '',
      cloudinaryPublicId: data.cloudinaryPublicId || '',
      relatedEntityType: data.relatedEntityType || 'GENERAL',
      relatedEntityId: data.relatedEntityId || '',
      relatedEntityLabel: data.relatedEntityLabel || '',
      uploadedBy: data.uploadedBy || 'usr-admin',
      uploadedByName: data.uploadedByName || 'System Administrator',
      uploadedAt: data.uploadedAt || new Date().toISOString(),
      tags: data.tags || [],
      notes: data.notes || '',
    };
    this.documents.unshift(doc);
    this.saveToDisk();
    return doc;
  }

  public updateDocument(id: string, data: Partial<CloudDocument>): CloudDocument | null {
    this.checkReloadFromDisk();
    const doc = this.documents.find((d) => d.id === id);
    if (!doc) return null;
    Object.assign(doc, data, { uploadedAt: new Date().toISOString() });
    this.saveToDisk();
    return doc;
  }

  public deleteDocument(id: string): boolean {
    this.checkReloadFromDisk();
    const idx = this.documents.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.documents.splice(idx, 1);
    this.saveToDisk();
    return true;
  }


  // --- AUDIT LOGS & NOTIFICATIONS ---
  public getAuditLogs(): AuditLog[] {
    this.checkReloadFromDisk();
    return this.auditLogs;
  }

  public getNotifications(userRole?: UserRole, depotId?: string): Notification[] {
    this.checkReloadFromDisk();
    return this.notifications.filter((n) => {
      if (n.targetRole && n.targetRole !== userRole && userRole !== 'SUPER_ADMIN') return false;
      return true;
    });
  }

  public markNotificationAsRead(id: string): void {
    this.checkReloadFromDisk();
    const notif = this.notifications.find((n) => n.id === id);
    if (notif) {
      notif.read = true;
      this.saveToDisk();
    }
  }

  public markAllNotificationsAsRead(): void {
    this.checkReloadFromDisk();
    this.notifications.forEach((n) => (n.read = true));
    this.saveToDisk();
  }

  // --- COMPANY SETTINGS ---
  public getCompanySettings(): CompanySettings {
    this.checkReloadFromDisk();
    return this.companySettings;
  }

  public updateCompanySettings(settings: Partial<CompanySettings>): CompanySettings {
    this.checkReloadFromDisk();
    this.companySettings = { ...this.companySettings, ...settings };
    this.saveToDisk();
    return this.companySettings;
  }

  // --- FULFILMENT WORKFLOW ACTIONS ---
  public pickInvoiceItems(invoiceId: string, itemIds?: string[]): boolean {
    this.checkReloadFromDisk();
    const inv = this.getInvoiceById(invoiceId);
    if (!inv) return false;
    inv.fulfilmentStatus = 'PROCESSING';
    inv.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  public packInvoice(invoiceId: string): boolean {
    this.checkReloadFromDisk();
    const inv = this.getInvoiceById(invoiceId);
    if (!inv) return false;
    inv.fulfilmentStatus = 'PACKED';
    inv.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  public dispatchShipment(invoiceId: string): boolean {
    this.checkReloadFromDisk();
    const inv = this.getInvoiceById(invoiceId);
    if (!inv) return false;
    inv.fulfilmentStatus = 'SHIPPED';
    inv.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  // --- DASHBOARD AGGREGATED STATS ---
  public getDashboardOverview() {
    this.checkReloadFromDisk();
    const totalRevenue = this.invoices
      .filter((i) => i.fulfilmentStatus !== 'CANCELLED')
      .reduce((sum, i) => sum + (i.grandTotal || 0), 0);

    const totalCost = this.invoices
      .filter((i) => i.fulfilmentStatus !== 'CANCELLED')
      .reduce((sum, i) => {
        const invCost = (i.items || []).reduce((itemSum, item) => itemSum + (item.unitPrice * 0.78) * item.quantity, 0);
        return sum + invCost;
      }, 0);

    const grossProfit = totalRevenue - totalCost;
    const pendingProformas = this.proformas.filter((p) => p.status === 'SENT' || p.status === 'DRAFT').length;
    const pendingShipments = this.invoices.filter(
      (i) => i.fulfilmentStatus === 'READY_FOR_PACKING' || i.fulfilmentStatus === 'PROCESSING' || i.fulfilmentStatus === 'PACKED'
    ).length;

    return {
      revenue: totalRevenue,
      grossProfit,
      totalOrders: this.invoices.length,
      inventoryValue: this.products.reduce((sum, p) => sum + (p.totalStock || 0) * (p.wholesalePrice || 0), 0),
      pendingProformas,
      pendingShipments,
    };
  }

  public searchGlobal(query: string) {
    this.checkReloadFromDisk();
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      return {
        products: this.products.slice(0, 5),
        customers: this.customers.slice(0, 5),
        proformas: this.proformas.slice(0, 5),
        invoices: this.invoices.slice(0, 5),
      };
    }
    return {
      products: this.products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)),
      customers: this.customers.filter((c) => c.companyName.toLowerCase().includes(q) || c.contactPerson.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)),
      proformas: this.proformas.filter((p) => p.proformaNumber.toLowerCase().includes(q) || (p.customerCompany && p.customerCompany.toLowerCase().includes(q))),
      invoices: this.invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || (i.customerCompany && i.customerCompany.toLowerCase().includes(q))),
    };
  }
}

// Attach singleton to globalThis so Next.js HMR does not wipe state in memory
const globalForDataStore = globalThis as unknown as { __DATA_STORE__: DataStore | undefined };
let dataStore: DataStore;
if (globalForDataStore.__DATA_STORE__) {
  Object.setPrototypeOf(globalForDataStore.__DATA_STORE__, DataStore.prototype);
  dataStore = globalForDataStore.__DATA_STORE__;
  if (!dataStore['suppliers'] || !Array.isArray(dataStore['suppliers'])) {
    (dataStore as any).suppliers = [...INITIAL_SUPPLIERS];
  }
  dataStore.loadFromDisk();
} else {
  dataStore = new DataStore();
  if (process.env.NODE_ENV !== 'production') {
    globalForDataStore.__DATA_STORE__ = dataStore;
  }
}

export default dataStore;
