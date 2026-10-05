# ARIB GLOBAL

An enterprise-grade ERP and fulfilment platform with multi-role RBAC, serial number tracking, multi-depot inventory management, barcode scanning fulfillment, and order-to-cash workflow pipelines.

---

## Quickstart Guide (From Clean `git clone`)

To run this application on a new machine or from a fresh clone:

### 1. Clone the Repository
```bash
git clone https://github.com/PrathamShailesh/camera-accessories-wholesale-erp.git
cd camera-accessories-wholesale-erp
```

### 2. Install Dependencies
```bash
npm install
```
> **Note:** The `postinstall` hook automatically generates the Prisma Client (`@prisma/client`).

### 3. Setup Environment Variables
Copy the template configuration file:
- **Windows (Command Prompt / PowerShell):**
  ```cmd
  copy .env.example .env
  ```
- **macOS / Linux:**
  ```bash
  cp .env.example .env
  ```

Update `.env` with your PostgreSQL database URL or cloud connection string:
```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/camera_erp?schema=public"
```
*(If PostgreSQL is not running locally, the ERP seamlessly operates in resilient offline mode using the bundled JSON store in `data/erp-store.json`)*.

### 4. Initialize Database (Optional for PostgreSQL)
If using PostgreSQL, push the database schema and seed the baseline data:
```bash
npm run db:push
npm run db:seed
```

### 5. Launch the Application
- **Development Mode:**
  ```bash
  npm run dev
  ```
  Open [http://localhost:3000](http://localhost:3000) in your browser.

- **Production Build:**
  ```bash
  npm run build
  npm start
  ```

---

## User Roles & Default Test Credentials

The system comes pre-configured with 4 distinct user roles:

| Role | Email Address | Default Password | Primary Landing Page | Key Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **SUPER_ADMIN** | `admin@aribglobal.com` | `Admin@Arib2026!` | `/dashboard` | Full system access, company settings, user provisioning, audit logs, profit margins. |
| **MANAGER** | `marcus.vance@lenscore.com` | `Manager@Growth2026!` | `/dashboard` | Sales, proformas, invoices, products, stock transfers, customer credit approvals. |
| **ERP_USER** | `priya.erp@lenscore.com` | `ErpUser@Growth2026!` | `/dashboard` | Customer creation, draft proformas, quotations. Cost margins redacted (`undefined`). |
| **DEPOT_USER** | `depot@aribglobal.com` | `Depot@Arib2026!` | `/depot` | Central Warehouse workbench: picking serials, packing boxes, carrier dispatch (AWB). |

---

## Core System Architecture & Features

1. **Role-Based Access Control (RBAC):**
   - Cost price redaction on product APIs for non-manager personas.
   - Route and button guardrails protecting settings, user management, and stock adjustments.
   - Next.js Edge middleware intercepting direct unauthorized URL navigation with interactive 403 modal dialogs.
2. **Order-to-Cash Pipeline:**
   - `Customer` $\rightarrow$ `Product & Serial Registry` $\rightarrow$ `Proforma (Draft -> Confirmed)` $\rightarrow$ `Tax Invoice` $\rightarrow$ `Depot Picking & Allocation` $\rightarrow$ `Packing Workbench` $\rightarrow$ `Carrier Dispatch & AWB` $\rightarrow$ `Delivery & Payment Settlement`.
3. **Serial Traceability:**
   - Complete serial status lifecycle tracking: `IN_STOCK` $\rightarrow$ `ALLOCATED` $\rightarrow$ `DISPATCHED`.
   - Real-time barcode validation preventing unallocated or non-existent serial fulfillment.
4. **Dual Persistence Architecture:**
   - Production PostgreSQL with Prisma ORM.
   - Instant 0ms fallback to `data/erp-store.json` when the database is unreachable or running offline.
5. **Multi-Depot Operations:**
   - Inter-depot stock transfers (`PENDING` $\rightarrow$ `IN_TRANSIT` $\rightarrow$ `COMPLETED`).
   - Granular inventory allocation across Central and Regional depots.
