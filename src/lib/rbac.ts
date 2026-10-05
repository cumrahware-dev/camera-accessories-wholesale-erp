/**
 * Central RBAC matrix for ARIB GLOBAL ERP.
 * Used by Edge middleware (pages + APIs) and by Node API handlers.
 * Keep this file free of Node-only imports so it can run on the Edge runtime.
 */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'MANAGER'
  | 'ERP_USER'
  | 'DEPOT_USER' // legacy depot role: same access as before, scoped to its depot
  | 'DEPOT_MANAGER'
  | 'DEPOT_STAFF'
  | 'DEPOT_SCANNER'
  | 'VIEWER';

export const ALL_ROLES: UserRole[] = ['SUPER_ADMIN', 'MANAGER', 'ERP_USER', 'DEPOT_MANAGER', 'DEPOT_STAFF', 'DEPOT_SCANNER', 'DEPOT_USER', 'VIEWER'];

export type Permission =
  | 'dashboard.view'
  | 'proformas.read'
  | 'proformas.write'
  | 'invoices.read'
  | 'invoices.write'
  | 'invoices.fulfil'
  | 'service_invoices.read'
  | 'service_invoices.write'
  /** Send a document email to an address other than the customer's own, or with BCC. */
  | 'emails.override'
  | 'orders.read'
  | 'customers.read'
  | 'customers.write'
  | 'customers.delete'
  | 'products.read'
  | 'products.write'
  | 'products.delete'
  | 'products.view_cost'
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'serials.read'
  | 'serials.write'
  | 'depots.read'
  | 'depots.directory'
  | 'depots.write'
  /** Activate / deactivate a depot (deactivating blocks its sign-in). */
  | 'depots.disable'
  /** Generate, regenerate or revoke a depot access code. Super Admin only. */
  | 'depots.access_code'
  /** Manage the staff of the user's own depot (Depot Manager). */
  | 'depot_users.manage'
  | 'orders.pick'
  | 'orders.pack'
  | 'shipments.ship'
  | 'reports.export'
  | 'depot_mobile.view'
  | 'shipments.read'
  | 'shipments.write'
  | 'documents.read'
  | 'documents.write'
  | 'documents.delete'
  | 'reports.sales'
  | 'reports.inventory'
  | 'reports.profit'
  | 'audit.read'
  | 'users.read'
  | 'users.write'
  | 'users.disable'
  | 'settings.read'
  | 'settings.write'
  | 'search.use'
  | 'ocr.read'
  | 'ocr.write'
  | 'ocr.convert'
  | 'ocr.delete'
  | 'purchases.read'
  | 'purchases.write'
  | 'purchases.post'
  | 'price_support.read'
  | 'price_support.write'
  | 'price_support.approve'
  | 'accounting.read';

const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'customers.delete',
  'products.delete',
  'depots.disable',
  'depots.access_code',
  'depot_users.manage',
  'orders.pick',
  'orders.pack',
  'shipments.ship',
  'reports.export',
  'users.disable',
  'emails.override',
  'proformas.read',
  'proformas.write',
  'invoices.read',
  'invoices.write',
  'invoices.fulfil',
  'service_invoices.read',
  'service_invoices.write',
  'orders.read',
  'customers.read',
  'customers.write',
  'customers.delete',
  'products.read',
  'products.write',
  'products.view_cost',
  'inventory.read',
  'inventory.adjust',
  'inventory.transfer',
  'serials.read',
  'serials.write',
  'depots.read',
  'depots.directory',
  'depots.write',
  'depot_mobile.view',
  'shipments.read',
  'shipments.write',
  'documents.read',
  'documents.write',
  'documents.delete',
  'reports.sales',
  'reports.inventory',
  'reports.profit',
  'audit.read',
  'users.read',
  'users.write',
  'settings.read',
  'settings.write',
  'search.use',
  'ocr.read',
  'ocr.write',
  'ocr.convert',
  'ocr.delete',
  'purchases.read',
  'purchases.write',
  'purchases.post',
  'price_support.read',
  'price_support.write',
  'price_support.approve',
  'accounting.read',
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(ALL_PERMISSIONS),

  MANAGER: new Set<Permission>([
    'dashboard.view',
    'customers.delete',
    'orders.pick',
    'orders.pack',
    'shipments.ship',
    'reports.export',
    'emails.override',
    'proformas.read',
    'proformas.write',
    'invoices.read',
    'invoices.write',
    'invoices.fulfil',
    'service_invoices.read',
    'service_invoices.write',
    'orders.read',
    'customers.read',
    'customers.write',
    'products.read',
    'products.write',
    'products.view_cost',
    'inventory.read',
    'inventory.adjust',
    'inventory.transfer',
    'serials.read',
    'serials.write',
    'depots.read',
    'depots.directory',
    'depot_mobile.view',
    'shipments.read',
    'shipments.write',
    'documents.read',
    'documents.write',
    'documents.delete',
    'reports.sales',
    'reports.inventory',
    'reports.profit',
    'audit.read',
    'search.use',
    'ocr.read',
    'ocr.write',
    'ocr.convert',
      'purchases.read',
    'purchases.write',
    'purchases.post',
    'price_support.read',
    'price_support.write',
    'price_support.approve',
    'accounting.read',
  ]),

  ERP_USER: new Set<Permission>([
    'dashboard.view',
    'proformas.read',
    'proformas.write',
    'invoices.read',
    'invoices.write',
    'service_invoices.read',
    'service_invoices.write',
    'orders.read',
    'customers.read',
    'customers.write',
    'products.read',
    'products.write',
    'inventory.read',
    'inventory.transfer',
    'serials.read',
    'depots.read',
    'depots.directory',
    'depot_mobile.view',
    'shipments.read',
    'documents.read',
    'documents.write',
    'reports.sales',
    'reports.inventory',
    'search.use',
    'ocr.read',
    'ocr.write',
    'ocr.convert',
      'purchases.read',
    'purchases.write',
    'price_support.read',
    'price_support.write',
  ]),

  DEPOT_USER: new Set<Permission>([
    'dashboard.view',
    'orders.pick',
    'orders.pack',
    'shipments.ship',
    'invoices.read',
    'invoices.fulfil',
    'orders.read',
    'products.read',
    'inventory.read',
    'inventory.transfer',
    'serials.read',
    'depots.read',
    'depot_mobile.view',
    'shipments.read',
    'shipments.write',
    'documents.read',
    'documents.write',
    'search.use',
  ]),

  /** Runs one depot: orders, picking, packing, shipments, AWB, depot inventory and (if enabled) the depot's staff. */
  DEPOT_MANAGER: new Set<Permission>([
    'dashboard.view',
    'invoices.read',
    'invoices.fulfil',
    'orders.read',
    'orders.pick',
    'orders.pack',
    'products.read',
    'inventory.read',
    'inventory.transfer',
    'serials.read',
    'depots.read',
    'depot_mobile.view',
    'shipments.read',
    'shipments.write',
    'shipments.ship',
    'documents.read',
    'documents.write',
    'reports.inventory',
    'depot_users.manage',
    'search.use',
  ]),

  /** Picks and packs orders and prepares shipments. No administrative powers. */
  DEPOT_STAFF: new Set<Permission>([
    'dashboard.view',
    'invoices.read',
    'invoices.fulfil',
    'orders.read',
    'orders.pick',
    'orders.pack',
    'products.read',
    'inventory.read',
    'serials.read',
    'depots.read',
    'depot_mobile.view',
    'shipments.read',
    'shipments.write',
    'documents.read',
    'documents.write',
    'search.use',
  ]),

  /** Fast mobile scanning: look up an order, confirm picking and packing. */
  DEPOT_SCANNER: new Set<Permission>([
    'invoices.read',
    'invoices.fulfil',
    'orders.read',
    'orders.pick',
    'orders.pack',
    'products.read',
    'inventory.read',
    'serials.read',
    'depot_mobile.view',
    'shipments.read',
    'search.use',
  ]),

  /** Read-only access. Bound to one depot when the account has a depot assigned. */
  VIEWER: new Set<Permission>([
    'dashboard.view',
    'proformas.read',
    'invoices.read',
    'service_invoices.read',
    'orders.read',
    'customers.read',
    'products.read',
    'inventory.read',
    'serials.read',
    'depots.read',
    'depots.directory',
    'shipments.read',
    'documents.read',
    'reports.sales',
    'reports.inventory',
    'search.use',
  ]),
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ALL_ROLES as string[]).includes(value);
}

/** Roles that belong to one depot and may only ever see that depot's data. */
export const DEPOT_ROLES: UserRole[] = ['DEPOT_MANAGER', 'DEPOT_STAFF', 'DEPOT_SCANNER', 'DEPOT_USER'];
export const isDepotRole = (role: unknown): boolean => typeof role === 'string' && (DEPOT_ROLES as string[]).includes(role);

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  ERP_USER: 'ERP User',
  DEPOT_USER: 'Depot User (legacy)',
  DEPOT_MANAGER: 'Depot Manager',
  DEPOT_STAFF: 'Depot Staff',
  DEPOT_SCANNER: 'Depot Scanner',
  VIEWER: 'Viewer',
};

/**
 * `revoked` lets a Super Admin narrow a role for one person (e.g. a Manager without audit logs).
 * Permissions can only be taken away, never added beyond the role.
 */
export function hasPermission(
  role: UserRole | string | undefined | null,
  permission: Permission,
  revoked?: readonly string[] | null
): boolean {
  if (!isUserRole(role)) return false;
  if (revoked && revoked.includes(permission)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function listPermissions(role: UserRole): Permission[] {
  return ALL_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}

export type AuthSession = {
  userId: string;
  email: string;
  role: UserRole;
  assignedDepotId?: string | null;
  status?: string;
};

export function isDepotScoped(session: AuthSession | null | undefined): boolean {
  if (!session) return false;
  if (isDepotRole(session.role)) return true;
  // A viewer who has been given a depot is bound to it; an unassigned viewer is a global read-only user.
  return session.role === 'VIEWER' && !!session.assignedDepotId;
}

export function canViewCosts(role: UserRole | string | undefined | null): boolean {
  return hasPermission(role, 'products.view_cost');
}

/** Page routes (longest prefix first). */
const PAGE_PERMISSIONS: Array<{ prefix: string; permission: Permission }> = [
  { prefix: '/purchases/price-support', permission: 'price_support.read' },
  { prefix: '/purchases', permission: 'purchases.read' },
  { prefix: '/accounting', permission: 'accounting.read' },
  { prefix: '/reports/profit', permission: 'reports.profit' },
  { prefix: '/reports/sales', permission: 'reports.sales' },
  { prefix: '/reports/inventory', permission: 'reports.inventory' },
  { prefix: '/inventory/adjustments', permission: 'inventory.adjust' },
  { prefix: '/inventory/transfers', permission: 'inventory.read' },
  { prefix: '/inventory/serials', permission: 'serials.read' },
  { prefix: '/inventory', permission: 'inventory.read' },
  { prefix: '/depot/users', permission: 'depot_users.manage' },
  { prefix: '/depot', permission: 'depot_mobile.view' },
  { prefix: '/depot-mobile', permission: 'depot_mobile.view' },
  { prefix: '/proformas', permission: 'proformas.read' },
  { prefix: '/service-invoices', permission: 'service_invoices.read' },
  { prefix: '/invoices', permission: 'invoices.read' },
  { prefix: '/orders', permission: 'orders.read' },
  { prefix: '/customers', permission: 'customers.read' },
  { prefix: '/suppliers', permission: 'customers.read' },
  { prefix: '/products', permission: 'products.read' },
  { prefix: '/depots', permission: 'depots.directory' },
  { prefix: '/shipments', permission: 'shipments.read' },
  { prefix: '/documents', permission: 'documents.read' },
  { prefix: '/ocr', permission: 'ocr.read' },
  { prefix: '/audit-logs', permission: 'audit.read' },
  { prefix: '/users', permission: 'users.read' },
  { prefix: '/settings/backup', permission: 'settings.write' },
  { prefix: '/settings', permission: 'settings.read' },
  { prefix: '/dashboard', permission: 'dashboard.view' },
];

export const PUBLIC_PAGE_PREFIXES = ['/login', '/depot-login', '/quote', '/portal', '/view', '/unauthorized'];

export function isPublicPagePath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function permissionForPage(pathname: string): Permission | 'public' {
  if (isPublicPagePath(pathname)) return 'public';
  const match = PAGE_PERMISSIONS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return match?.permission ?? 'dashboard.view';
}

export function canAccessPage(role: UserRole | string | undefined | null, pathname: string): boolean {
  const permission = permissionForPage(pathname);
  if (permission === 'public') return true;
  return hasPermission(role, permission);
}

export function homePathForRole(role: UserRole | string | undefined | null): string {
  if (role === 'DEPOT_SCANNER') return '/depot-mobile';
  return isDepotRole(role) ? '/depot' : '/dashboard';
}

type ApiRule = {
  methods: string[];
  test: (pathname: string) => boolean;
  permission: Permission | 'public' | 'authenticated';
};

const API_RULES: ApiRule[] = [
  { methods: ['POST'], test: (p) => p === '/api/auth/login', permission: 'public' },
  // Customer portal: token-protected, read-only, one document per link.
  { methods: ['GET'], test: (p) => p.startsWith('/api/public/invoices/'), permission: 'public' },
  { methods: ['POST'], test: (p) => p === '/api/auth/depot-login', permission: 'public' },
  { methods: ['POST'], test: (p) => p === '/api/auth/logout', permission: 'public' },
  { methods: ['GET'], test: (p) => p === '/api/auth/me', permission: 'authenticated' },
  { methods: ['POST'], test: (p) => p === '/api/auth/change-password', permission: 'authenticated' },
  { methods: ['GET'], test: (p) => p === '/api/auth/session', permission: 'authenticated' },
  { methods: ['POST'], test: (p) => p === '/api/auth/session', permission: 'users.write' },
  { methods: ['GET'], test: (p) => p === '/api/events', permission: 'authenticated' },
  { methods: ['GET'], test: (p) => p === '/api/cloudinary/health', permission: 'settings.write' },
  { methods: ['GET'], test: (p) => p === '/api/settings', permission: 'public' },
  { methods: ['PATCH', 'PUT', 'POST'], test: (p) => p === '/api/settings', permission: 'settings.write' },

  { methods: ['GET'], test: (p) => p === '/api/users' || p.startsWith('/api/users/'), permission: 'users.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/users' || p.startsWith('/api/users/'), permission: 'users.write' },

  { methods: ['PUT', 'PATCH', 'POST', 'DELETE'], test: (p) => p.startsWith('/api/email/templates'), permission: 'settings.write' },
  { methods: ['GET'], test: (p) => p.startsWith('/api/email/templates'), permission: 'settings.read' },

  { methods: ['GET'], test: (p) => p === '/api/audit-logs' || p.startsWith('/api/audit-logs/'), permission: 'audit.read' },

  { methods: ['POST'], test: (p) => p.startsWith('/api/invoices/') && p.endsWith('/pick'), permission: 'orders.pick' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/invoices/') && p.endsWith('/pack'), permission: 'orders.pack' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/invoices/') && p.endsWith('/ship'), permission: 'shipments.ship' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/invoices/') && p.endsWith('/convert'), permission: 'invoices.write' },
  { methods: ['PUT', 'PATCH'], test: (p) => /^\/api\/invoices\/[^/]+$/.test(p), permission: 'authenticated' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/proformas/') && p.endsWith('/convert'), permission: 'invoices.write' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/proformas/') && p.endsWith('/confirm'), permission: 'proformas.write' },

  { methods: ['GET'], test: (p) => p === '/api/proformas' || p.startsWith('/api/proformas/'), permission: 'proformas.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/proformas' || p.startsWith('/api/proformas/'), permission: 'proformas.write' },
  { methods: ['POST'], test: (p) => p === '/api/emails/send-proforma', permission: 'proformas.write' },

  { methods: ['GET'], test: (p) => p === '/api/service-invoices' || p.startsWith('/api/service-invoices/'), permission: 'service_invoices.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/service-invoices' || p.startsWith('/api/service-invoices/'), permission: 'service_invoices.write' },
  { methods: ['GET'], test: (p) => p === '/api/invoices' || p.startsWith('/api/invoices/'), permission: 'invoices.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/invoices' || p.startsWith('/api/invoices/'), permission: 'invoices.write' },

  { methods: ['GET'], test: (p) => p === '/api/customers' || p.startsWith('/api/customers/'), permission: 'customers.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/customers' || p.startsWith('/api/customers/'), permission: 'customers.write' },
  { methods: ['GET'], test: (p) => p === '/api/suppliers' || p.startsWith('/api/suppliers/'), permission: 'customers.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/suppliers' || p.startsWith('/api/suppliers/'), permission: 'customers.write' },

  { methods: ['POST'], test: (p) => p === '/api/products/bulk', permission: 'products.write' },
  { methods: ['GET'], test: (p) => p === '/api/products' || p.startsWith('/api/products/'), permission: 'products.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/products' || p.startsWith('/api/products/'), permission: 'products.write' },

  { methods: ['POST'], test: (p) => p === '/api/inventory/adjust' || p === '/api/inventory/adjustments', permission: 'inventory.adjust' },
  { methods: ['GET'], test: (p) => p === '/api/inventory/adjustments', permission: 'inventory.adjust' },
  { methods: ['POST'], test: (p) => p === '/api/inventory/transfers' || p === '/api/transfers', permission: 'inventory.transfer' },
  { methods: ['GET'], test: (p) => p === '/api/inventory/transfers' || p === '/api/transfers', permission: 'inventory.read' },
  { methods: ['GET', 'POST'], test: (p) => p === '/api/inventory/check', permission: 'inventory.read' },
  { methods: ['GET'], test: (p) => p === '/api/inventory/export', permission: 'inventory.read' },
  // Data & Backup is Super Admin only.
  { methods: ['GET', 'POST'], test: (p) => p === '/api/backup' || p.startsWith('/api/backup/'), permission: 'settings.write' },
  { methods: ['GET'], test: (p) => p === '/api/inventory/serials' || p === '/api/serials' || p.startsWith('/api/serials/'), permission: 'serials.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/serials' || p.startsWith('/api/serials/'), permission: 'serials.write' },

  { methods: ['POST'], test: (p) => /^\/api\/depots\/[^/]+\/access-code$/.test(p), permission: 'depots.access_code' },
  { methods: ['POST'], test: (p) => /^\/api\/depots\/[^/]+\/status$/.test(p), permission: 'depots.disable' },
  { methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], test: (p) => p === '/api/depot-users' || p.startsWith('/api/depot-users/'), permission: 'depot_users.manage' },
  { methods: ['GET'], test: (p) => p === '/api/depots' || p.startsWith('/api/depots/'), permission: 'depots.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/depots' || p.startsWith('/api/depots/'), permission: 'depots.write' },

  { methods: ['GET'], test: (p) => p === '/api/shipments' || p.startsWith('/api/shipments/'), permission: 'shipments.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/shipments' || p.startsWith('/api/shipments/'), permission: 'shipments.write' },

  { methods: ['GET'], test: (p) => p === '/api/documents' || p.startsWith('/api/documents/'), permission: 'documents.read' },
  { methods: ['POST'], test: (p) => p === '/api/documents' || p.startsWith('/api/documents/') || p === '/api/cloudinary/upload', permission: 'documents.write' },
  { methods: ['DELETE'], test: (p) => p === '/api/documents' || p.startsWith('/api/documents/'), permission: 'documents.delete' },

  { methods: ['GET'], test: (p) => p === '/api/dashboard' || p === '/api/dashboard/stats', permission: 'dashboard.view' },
  { methods: ['GET'], test: (p) => p === '/api/search', permission: 'search.use' },

  // OCR intake. /convert is matched before the generic write rule.
  { methods: ['POST'], test: (p) => /^\/api\/ocr-documents\/[^/]+\/convert$/.test(p), permission: 'ocr.convert' },
  { methods: ['POST'], test: (p) => p.startsWith('/api/purchase-invoices/') && p.endsWith('/post'), permission: 'purchases.post' },
  { methods: ['GET'], test: (p) => p === '/api/purchase-invoices' || p.startsWith('/api/purchase-invoices/'), permission: 'purchases.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/purchase-invoices' || p.startsWith('/api/purchase-invoices/'), permission: 'purchases.write' },
  { methods: ['GET'], test: (p) => p === '/api/price-support' || p.startsWith('/api/price-support/'), permission: 'price_support.read' },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], test: (p) => p === '/api/price-support' || p.startsWith('/api/price-support/'), permission: 'price_support.write' },
  { methods: ['GET'], test: (p) => p === '/api/accounting/heads', permission: 'authenticated' },
  { methods: ['GET'], test: (p) => p.startsWith('/api/accounting/'), permission: 'accounting.read' },
  { methods: ['GET'], test: (p) => p === '/api/ocr-documents' || p.startsWith('/api/ocr-documents/'), permission: 'ocr.read' },
  { methods: ['DELETE'], test: (p) => p.startsWith('/api/ocr-documents/'), permission: 'ocr.delete' },
  { methods: ['POST', 'PUT', 'PATCH'], test: (p) => p === '/api/ocr-documents' || p.startsWith('/api/ocr-documents/'), permission: 'ocr.write' },
];

export function resolveApiAccess(pathname: string, method: string): Permission | 'public' | 'authenticated' {
  const verb = method.toUpperCase();
  const rule = API_RULES.find((r) => r.methods.includes(verb) && r.test(pathname));
  return rule?.permission ?? 'authenticated';
}

export function canAccessApi(
  role: UserRole | string | undefined | null,
  pathname: string,
  method: string
): boolean {
  const access = resolveApiAccess(pathname, method);
  if (access === 'public') return true;
  if (access === 'authenticated') return isUserRole(role);
  return hasPermission(role, access);
}

export const NAV_SECTIONS: Array<{
  title: string;
  items: Array<{ name: string; href: string; permission: Permission; highlight?: boolean; icon: string }>;
}> = [
  {
    title: 'SALES & ORDERS',
    items: [
      { name: 'Dashboard', href: '/dashboard', permission: 'dashboard.view', icon: 'LayoutDashboard' },
      { name: 'Proformas', href: '/proformas', permission: 'proformas.read', icon: 'FileCheck2' },
      { name: 'Tax Invoices', href: '/invoices', permission: 'invoices.read', icon: 'Receipt' },
      { name: 'Service Invoices', href: '/service-invoices', permission: 'service_invoices.read', icon: 'FileText' },
      { name: 'Order Pipeline', href: '/orders', permission: 'orders.read', icon: 'ShoppingCart' },
      { name: 'Customers', href: '/customers', permission: 'customers.read', icon: 'Users' },
      { name: 'Suppliers', href: '/suppliers', permission: 'customers.read', icon: 'Building2' },
    ],
  },
  {
    title: 'PURCHASE',
    items: [
      { name: 'Purchase Invoices', href: '/purchases', permission: 'purchases.read', icon: 'ShoppingBag' },
      { name: 'Supplier Price Support', href: '/purchases/price-support', permission: 'price_support.read', icon: 'BadgePercent' },
      { name: 'Price Support Reports', href: '/purchases/price-support/reports', permission: 'price_support.read', icon: 'BarChart3' },
      { name: 'Journal', href: '/accounting/journal', permission: 'accounting.read', icon: 'BookOpen' },
    ],
  },
  {
    title: 'INVENTORY',
    items: [
      { name: 'Product Catalog', href: '/products', permission: 'products.read', icon: 'Package' },
      { name: 'Inventory', href: '/inventory', permission: 'inventory.read', icon: 'Boxes' },
      { name: 'Serial Numbers', href: '/inventory/serials', permission: 'serials.read', icon: 'Barcode' },
      { name: 'Stock Transfers', href: '/inventory/transfers', permission: 'inventory.read', icon: 'ArrowLeftRight' },
      { name: 'Stock Adjustments', href: '/inventory/adjustments', permission: 'inventory.adjust', icon: 'SlidersHorizontal' },
    ],
  },
  {
    title: 'DEPOT & FULFILMENT',
    items: [
      { name: 'Depot Operations', href: '/depot', permission: 'depot_mobile.view', highlight: true, icon: 'Smartphone' },
      { name: 'Depots', href: '/depots', permission: 'depots.directory', icon: 'Building2' },
      { name: 'Shipments & AWBs', href: '/shipments', permission: 'shipments.read', icon: 'Truck' },
    ],
  },
  {
    title: 'DOCUMENTS',
    items: [
      { name: 'OCR', href: '/ocr', permission: 'ocr.read', icon: 'ScanText' },
      { name: 'Documents', href: '/documents', permission: 'documents.read', icon: 'FolderLock' },
    ],
  },
  {
    title: 'ANALYTICS',
    items: [
      { name: 'Sales Reports', href: '/reports/sales', permission: 'reports.sales', icon: 'BarChart3' },
      { name: 'Profitability', href: '/reports/profit', permission: 'reports.profit', icon: 'TrendingUp' },
      { name: 'Inventory Reports', href: '/reports/inventory', permission: 'reports.inventory', icon: 'Boxes' },
      { name: 'Audit Logs', href: '/audit-logs', permission: 'audit.read', icon: 'ScrollText' },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { name: 'Users & Roles', href: '/users', permission: 'users.read', icon: 'Users' },
      { name: 'Settings', href: '/settings', permission: 'settings.read', icon: 'Settings' },
    ],
  },
];
