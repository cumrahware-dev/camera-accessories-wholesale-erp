export type UserRole = 'SUPER_ADMIN' | 'MANAGER' | 'ERP_USER' | 'DEPOT_USER';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
  assignedDepotId?: string;
  assignedDepotName?: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE';
  passwordHash?: string;
  lastLogin?: string;
}

export interface Depot {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  country: string;
  contactPerson: string;
  phone: string;
  email: string;
  isCentralHub: boolean;
  activeOrdersCount?: number;
  totalStockUnits?: number;
  totalStockValue?: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  productCount?: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  model: string;
  categoryId: string;
  categoryName?: string;
  subcategory?: string;
  description: string;
  imageUrl: string;
  barcode: string;
  trackSerial: boolean;
  purchasePrice: number;
  sellingPrice: number;
  wholesalePrice: number;
  taxRate: number;
  minStockLevel: number;
  status: 'ACTIVE' | 'ARCHIVED';
  totalStock?: number;
  depotBreakdown?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export type SerialStatus = 'IN_STOCK' | 'ALLOCATED' | 'DISPATCHED' | 'RETURNED' | 'DEFECTIVE';

export interface SerialNumber {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  serialNumber: string;
  depotId: string;
  depotName: string;
  status: SerialStatus;
  invoiceId?: string;
  invoiceNumber?: string;
  history?: {
    action: string;
    depotName: string;
    date: string;
    reference?: string;
  }[];
  createdAt: string;
}

export interface DepotInventory {
  id: string;
  productId: string;
  depotId: string;
  quantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  minStockLevel: number;
  updatedAt: string;
}

export type TransactionType = 'STOCK_IN' | 'STOCK_TRANSFER' | 'STOCK_ADJUSTMENT' | 'SALE_DISPATCH' | 'RETURN';

export interface StockTransaction {
  id: string;
  type: TransactionType;
  productId: string;
  productSku: string;
  productName: string;
  sourceDepotId?: string;
  sourceDepotName?: string;
  targetDepotId?: string;
  targetDepotName?: string;
  quantity: number;
  unitCost: number;
  referenceNumber: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export type TransferStatus = 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface StockTransfer {
  id: string;
  transferNumber: string;
  sourceDepotId: string;
  sourceDepotName: string;
  destinationDepotId: string;
  destinationDepotName: string;
  items: {
    productId: string;
    productSku: string;
    productName: string;
    quantity: number;
    serialNumbers?: string[];
  }[];
  status: TransferStatus;
  notes?: string;
  createdBy: string;
  createdAt: string;
  receivedAt?: string;
}

export interface StockAdjustment {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  depotId: string;
  depotName: string;
  deltaQty: number;
  previousQty: number;
  newQty: number;
  reason: 'DAMAGED' | 'CYCLE_COUNT' | 'FOUND' | 'DEFECTIVE' | 'OTHER';
  user: string;
  notes?: string;
  createdAt: string;
}

export type PaymentTerms = 'NET_15' | 'NET_30' | 'NET_60' | 'IMMEDIATE' | 'ADVANCE_50';

export interface Customer {
  id: string;
  customerCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
  shippingAddress: string;
  country: string;
  taxNumber: string;
  paymentTerms: PaymentTerms;
  creditLimit: number;
  currentBalance: number;
  notes?: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'INACTIVE';
  totalOrders?: number;
  totalSpent?: number;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  taxId: string;
  paymentTerms: string;
}

export type ProformaStatus = 'DRAFT' | 'SENT' | 'CONFIRMED' | 'CONVERTED' | 'CANCELLED';

export interface ProformaItem {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  brand: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
  selectedDepotId?: string;
  selectedDepotName?: string;
  trackSerial?: boolean;
  /** Package/weight/dimension details used to calculate shipment-level freight. */
  unitWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  /** This line's share of the invoice-level freight — set only via "Allocate Freight". */
  allocatedFreight?: number;
}

export type FreightAllocationMethod = 'WEIGHT' | 'QUANTITY' | 'VALUE' | 'MANUAL';

/** Freight audit trail shared by Proforma and TaxInvoice. shippingCost IS the
 *  Total Freight already included in grandTotal — these fields only explain
 *  how it was derived; never add them into a total again. */
export interface FreightDetails {
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  freightRatePerKg: number;
  freightCharge: number;
  additionalFreightCharges: number;
  freightVolumetricDivisor: number;
  freightIsManualOverride: boolean;
  freightAllocationMethod?: FreightAllocationMethod | null;
}

export interface Proforma extends Partial<FreightDetails> {
  id: string;
  proformaNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string;
  customerPhone?: string;
  billingAddress: string;
  shippingAddress: string;
  managerId: string;
  managerName: string;
  issueDate: string;
  expiryDate: string;
  paymentTerms: string;
  deliveryTerms: string;
  notes?: string;
  items: ProformaItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  otherCharges: number;
  grandTotal: number;
  currency: 'USD';
  status: ProformaStatus;
  convertedToInvoiceId?: string;
  convertedToInvoiceNumber?: string;
  convertedAt?: string;
  pdfUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type InvoicePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
export type InvoiceFulfilmentStatus = 
  | 'DRAFT' 
  | 'SENT' 
  | 'CONFIRMED' 
  | 'PROCESSING' 
  | 'READY_FOR_PACKING' 
  | 'PACKED' 
  | 'SHIPPED' 
  | 'DELIVERED' 
  | 'CANCELLED';

export interface InvoiceItem {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  brand: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
  depotId: string;
  depotName: string;
  allocatedSerials: string[];
  trackSerial: boolean;
  isPicked?: boolean;
  /** Package/weight/dimension details, carried over from the source ProformaItem. */
  unitWeightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  /** This line's share of the invoice-level freight — set only via "Allocate Freight". */
  allocatedFreight?: number;
}

export interface TaxInvoice extends Partial<FreightDetails> {
  id: string;
  invoiceNumber: string;
  proformaId?: string;
  proformaNumber?: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string;
  customerPhone?: string;
  billingAddress: string;
  shippingAddress: string;
  depotId: string;
  depotName: string;
  managerId: string;
  managerName: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  paymentStatus: InvoicePaymentStatus;
  fulfilmentStatus: InvoiceFulfilmentStatus;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  otherCharges: number;
  grandTotal: number;
  currency: 'USD';
  notes?: string;
  internalRemarks?: string;
  shipmentId?: string;
  pdfUrl?: string;
  packingDetails?: PackingDetails;
  shippingDetails?: {
    courier?: string;
    airwayBillNumber?: string;
    trackingUrl?: string;
    awbDocumentUrl?: string;
    dispatchedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type CourierProvider = 'DHL_EXPRESS' | 'FEDEX_INTERNATIONAL' | 'ARAMEX' | 'EMIRATES_SKYCARGO' | 'UPS' | 'OTHER';

export interface PackingDetails {
  id: string;
  invoiceId: string;
  packedBy: string;
  packedAt: string;
  packageCount: number;
  totalWeightKg: number;
  dimensionsCm: {
    length: number;
    width: number;
    height: number;
  };
  boxNumber?: string;
  packagePhotoUrl?: string;
  packingNotes?: string;
}

export type ShipmentStatus = 'READY' | 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

export interface Shipment {
  id: string;
  shipmentNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerCompany: string;
  destinationCountry: string;
  shippingAddress: string;
  depotId: string;
  depotName: string;
  courier: CourierProvider;
  customCourierName?: string;
  airwayBillNumber: string;
  trackingUrl: string;
  shippingDate: string;
  estimatedDeliveryDate: string;
  actualDeliveryDate?: string;
  shippingCost: number;
  weightKg: number;
  packageCount: number;
  dimensionsCm?: {
    length: number;
    width: number;
    height: number;
  };
  airwayBillDocUrl?: string;
  packingListDocUrl?: string;
  shippingInvoiceDocUrl?: string;
  packagePhotoUrl?: string;
  status: ShipmentStatus;
  packedBy?: string;
  dispatchedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentCategory = 
  | 'PROFORMA' 
  | 'TAX_INVOICE' 
  | 'AIRWAY_BILL' 
  | 'PACKING_LIST' 
  | 'PURCHASE_INVOICE' 
  | 'SHIPPING_DOCUMENT' 
  | 'CUSTOMER_DOCUMENT' 
  | 'SUPPLIER_DOCUMENT' 
  | 'WARRANTY_DOCUMENT' 
  | 'CERTIFICATE' 
  | 'OTHER';

export type RelatedEntityType = 
  | 'CUSTOMER' 
  | 'PROFORMA' 
  | 'INVOICE' 
  | 'SHIPMENT' 
  | 'DEPOT' 
  | 'PRODUCT' 
  | 'SUPPLIER' 
  | 'ORDER';

export interface CloudDocument {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileFormat: string;
  fileSize: number;
  cloudinaryUrl: string;
  cloudinaryPublicId?: string;
  category: DocumentCategory;
  relatedEntityType: RelatedEntityType;
  relatedEntityId: string;
  relatedEntityLabel: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  tags?: string[];
  notes?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: 
    | 'LOGIN' 
    | 'PRICE_UPDATE' 
    | 'STOCK_IN' 
    | 'STOCK_TRANSFER' 
    | 'STOCK_ADJUSTMENT' 
    | 'PROFORMA_CREATE' 
    | 'PROFORMA_UPDATE' 
    | 'DEAL_CONFIRM' 
    | 'CONVERT_TO_INVOICE' 
    | 'ORDER_PICKED'
    | 'ORDER_PACKED' 
    | 'SHIPMENT_DISPATCHED' 
    | 'SHIPMENT_DELIVERED'
    | 'DOCUMENT_UPLOAD' 
    | 'USER_PERMISSION_CHANGE';
  entityType: string;
  entityId: string;
  entityLabel: string;
  previousValue?: string;
  newValue?: string;
  description: string;
  ipAddress?: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  type: 
    | 'NEW_PROFORMA' 
    | 'PROFORMA_CONFIRMED' 
    | 'INVOICE_GENERATED' 
    | 'DEPOT_PACKING_PENDING' 
    | 'SHIPMENT_DISPATCHED' 
    | 'AIRWAY_BILL_MISSING' 
    | 'LOW_INVENTORY' 
    | 'DOCUMENT_UPLOADED' 
    | 'ORDER_DELIVERED';
  title: string;
  message: string;
  link: string;
  read: boolean;
  targetRole?: UserRole;
  targetDepotId?: string;
  createdAt: string;
}

export interface ProfitabilityMetric {
  productId: string;
  productName: string;
  sku: string;
  brand: string;
  categoryName: string;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  averageSellingPrice: number;
  averagePurchasePrice: number;
}

export interface BusinessInsight {
  id: string;
  type: 'MARGIN_LEADER' | 'LOW_STOCK_WARNING' | 'TOP_CUSTOMER' | 'CATEGORY_DOMINANCE' | 'DEAD_STOCK_ALERT' | 'DEPOT_BOTTLENECK';
  title: string;
  message: string;
  urgency: 'INFO' | 'WARNING' | 'ALERT' | 'SUCCESS';
  metricValue?: string;
  actionLink?: string;
  actionLabel?: string;
}

export interface CompanySettings {
  id?: string;
  companyName: string;
  tradingName: string;
  logoUrl: string;
  sealUrl?: string;
  taxRegistrationNumber: string;
  vatGstNumber: string;
  corporateTaxNumber?: string;
  tradeLicenceNumber?: string;
  dunsNumber?: string;
  companyAddress: string;
  phone: string;
  email: string;
  website: string;
  currency: string;
  currencySymbol: string;
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    swiftBic: string;
    iban: string;
    routingCode: string;
  };
  invoicePrefix: string;
  proformaPrefix: string;
  invoiceNextNumber: number;
  proformaNextNumber: number;
  defaultPaymentTerms?: string;
  defaultDeliveryTerms?: string;
  /** Configurable freight defaults — never hardcoded in application code. */
  freightVolumetricDivisor?: number;
  freightDefaultRatePerKg?: number;
  smtpFromEmail?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  swiftBic?: string;
  iban?: string;
  routingCode?: string;
}

export type NotificationType = 'INVOICE_CREATED_DEPOT' | 'SHIPMENT_DISPATCHED_MANAGER' | 'PROFORMA_SENT_CUSTOMER';

export interface EmailLog {
  id: string;
  idempotencyKey: string;
  notificationType: NotificationType;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  relatedEntityId: string;
  relatedEntityRef: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sentAt?: string | null;
  failureReason?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ServiceInvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'SENT'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type ServiceCategory =
  | 'LOGISTICS'
  | 'PACKAGING'
  | 'TRANSPORTATION'
  | 'HANDLING'
  | 'INSTALLATION'
  | 'DOCUMENTATION'
  | 'SERVICE_FEE'
  | 'OTHER';

export interface ServiceInvoiceItem {
  id?: string;
  serviceInvoiceId?: string;
  description: string;
  category: ServiceCategory;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
}

export interface ServiceInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string;
  customerPhone?: string;
  billingAddress?: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  status: ServiceInvoiceStatus;
  currency: 'USD';
  items: ServiceInvoiceItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  otherCharges: number;
  grandTotal: number;
  notes?: string;
  internalRemarks?: string;
  pdfUrl?: string;
  emailStatus: 'NOT_SENT' | 'PENDING' | 'SENT' | 'FAILED';
  emailSentAt?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}
