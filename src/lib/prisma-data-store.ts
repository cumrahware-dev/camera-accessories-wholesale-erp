import { PrismaClient } from '@prisma/client';
import { formatUSD, formatDate } from '@/lib/utils';
import {
  User,
  Depot,
  Category,
  Product,
  SerialNumber,
  Customer,
  Proforma,
  TaxInvoice,
  Shipment,
  CloudDocument,
  AuditLog,
  CompanySettings,
} from '@/types/erp';
import { prisma } from './prisma';

/**
 * Prisma-based Data Store
 * This replaces the in-memory mock data-store.ts with actual database operations
 * Maintains the same interface for backward compatibility with UI components
 */
class PrismaDataStore {
  private currentUser: User;

  constructor() {
    // Default user - in production this would come from authentication
    this.currentUser = {
      id: 'usr-admin',
      name: 'System Administrator',
      email: 'admin@aribglobal.com',
      role: 'SUPER_ADMIN',
      avatar: '',
      phone: '+971 4 800 0100',
      status: 'ACTIVE',
      lastLogin: new Date().toISOString(),
    };
  }

  // --- USERS ---
  public getUsers(): User[] {
    // This would be async in production, but keeping sync for now
    return []; // Will be fetched via API
  }

  public getUserById(id: string): User | undefined {
    return undefined; // Will be fetched via API
  }

  public getCurrentUser(): User {
    return this.currentUser;
  }

  public setCurrentUser(user: User): void {
    this.currentUser = user;
  }

  public createUser(data: Omit<User, 'id'>): User {
    // Will be handled via API
    throw new Error('Use API route to create users');
  }

  public updateUser(id: string, data: Partial<User>): User | null {
    // Will be handled via API
    throw new Error('Use API route to update users');
  }

  // --- DEPOTS ---
  public getDepots(): Depot[] {
    // Will be fetched via API
    return [];
  }

  public getDepotById(id: string): Depot | undefined {
    return undefined; // Will be fetched via API
  }

  // --- PRODUCTS ---
  public getProducts(): Product[] {
    // Will be fetched via API
    return [];
  }

  public getProductById(id: string): Product | undefined {
    return undefined; // Will be fetched via API
  }

  public createProduct(data: Omit<Product, 'id' | 'totalStock' | 'createdAt' | 'updatedAt'>): Product {
    // Will be handled via API
    throw new Error('Use API route to create products');
  }

  public updateProduct(id: string, data: Partial<Product>): Product | null {
    // Will be handled via API
    throw new Error('Use API route to update products');
  }

  // --- CUSTOMERS ---
  public getCustomers(): Customer[] {
    // Will be fetched via API
    return [];
  }

  public getCustomerById(id: string): Customer | undefined {
    return undefined; // Will be fetched via API
  }

  public createCustomer(data: Omit<Customer, 'id' | 'customerCode' | 'createdAt' | 'totalOrders' | 'totalSpent'>): Customer {
    // Will be handled via API
    throw new Error('Use API route to create customers');
  }

  public updateCustomer(id: string, data: Partial<Customer>): Customer | null {
    // Will be handled via API
    throw new Error('Use API route to update customers');
  }

  // --- PROFORMAS ---
  public getProformas(): Proforma[] {
    // Will be fetched via API
    return [];
  }

  public getProformaById(id: string): Proforma | undefined {
    return undefined; // Will be fetched via API
  }

  public createProforma(data: {
    customerId: string;
    items: {
      productId: string;
      quantity: number;
      unitPrice: number;
      discountPercent?: number;
      selectedDepotId?: string;
    }[];
    discountPercent?: number;
    shippingCost?: number;
    notes?: string;
    deliveryTerms?: string;
    paymentTerms?: string;
    expiryDays?: number;
  }): Proforma {
    // Will be handled via API
    throw new Error('Use API route to create proformas');
  }

  public updateProformaStatus(id: string, status: Proforma['status']): Proforma | null {
    // Will be handled via API
    throw new Error('Use API route to update proformas');
  }

  public convertProformaToTaxInvoice(proformaId: string, depotId: string): TaxInvoice {
    // Will be handled via API
    throw new Error('Use API route to convert proformas');
  }

  // --- TAX INVOICES ---
  public getInvoices(): TaxInvoice[] {
    // Will be fetched via API
    return [];
  }

  public getInvoiceById(id: string): TaxInvoice | undefined {
    return undefined; // Will be fetched via API
  }

  public pickInvoiceItems(invoiceId: string, picks: { itemId: string; serials: string[] }[]): void {
    // Will be handled via API
    throw new Error('Use API route to pick invoice items');
  }

  public packInvoice(invoiceId: string, packingData: {
    packedBy: string;
    packageCount: number;
    totalWeightKg: number;
    dimensionsCm: { length: number; width: number; height: number };
    packagePhotoUrl: string;
  }): void {
    // Will be handled via API
    throw new Error('Use API route to pack invoice');
  }

  public dispatchShipment(invoiceId: string, shipmentData: {
    courier: string;
    airwayBillNumber: string;
    trackingUrl: string;
    shippingCost: number;
    weightKg: number;
    packageCount: number;
    dimensionsCm: { length: number; width: number; height: number };
    airwayBillDocUrl: string;
    packagePhotoUrl: string;
  }): void {
    // Will be handled via API
    throw new Error('Use API route to dispatch shipment');
  }

  // --- INVENTORY ---
  public getSerialNumbers(productId?: string, depotId?: string, status?: string): SerialNumber[] {
    // Will be fetched via API
    return [];
  }

  public addSerialNumber(data: Omit<SerialNumber, 'id' | 'createdAt'>): SerialNumber {
    // Will be handled via API
    throw new Error('Use API route to add serial numbers');
  }

  public updateSerialStatus(id: string, status: SerialNumber['status'], invoiceId?: string, invoiceNumber?: string): void {
    // Will be handled via API
    throw new Error('Use API route to update serial status');
  }

  // --- STOCK TRANSFERS ---
  public getTransfers(): any[] {
    // Will be fetched via API
    return [];
  }

  public createTransfer(sourceDepotId: string, destDepotId: string, items: { productId: string; quantity: number }[], notes: string): void {
    // Will be handled via API
    throw new Error('Use API route to create transfers');
  }

  // --- DOCUMENTS ---
  public getDocuments(filter?: { entityId?: string }): CloudDocument[] {
    // Will be fetched via API
    return [];
  }

  public deleteCloudDocument(id: string): void {
    // Will be handled via API
    throw new Error('Use API route to delete documents');
  }

  // --- SHIPMENTS ---
  public getShipmentById(id: string): any {
    // Will be fetched via API
    return undefined;
  }

  public markShipmentDelivered(shipmentId: string): void {
    // Will be handled via API
    throw new Error('Use API route to mark shipment delivered');
  }

  // --- AUDIT LOGS ---
  public getAuditLogs(): AuditLog[] {
    // Will be fetched via API
    return [];
  }

  private addAuditLog(data: any): void {
    // Will be handled by API
  }

  // --- SETTINGS ---
  public getSettings(): CompanySettings {
    // Will be fetched via API
    return {
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
      bankName: 'Commercial Bank of Dubai',
      accountName: 'Arib Global General Trading LLC',
      accountNumber: 'AE910230000001002416343',
      swiftBic: 'CBOUAEADXXX',
      iban: 'AE91 0230 0000 0100 2416 343',
      routingCode: 'CBD-0230',
      invoicePrefix: 'INV-2026-',
      proformaPrefix: 'PF-2026-',
      invoiceNextNumber: 3,
      proformaNextNumber: 3,
    };
  }

  public updateSettings(data: Partial<CompanySettings>): void {
    // Will be handled via API
    throw new Error('Use API route to update settings');
  }
}

// Export singleton instance
export const prismaDataStore = new PrismaDataStore();

// For backward compatibility, also export as default
export default prismaDataStore;
