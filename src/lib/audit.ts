/** Shared entry point for the AuditLog table (shown on /audit-logs). Writes are best-effort and never break the action. */
export { writeAudit, type Actor } from '@/lib/purchasing/common';
