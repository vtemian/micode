import type { Invoice } from "@/domain/types";
import { log } from "@/utils/logger";

const invoices = new Map<string, Invoice>();

export function loadInvoice(id: string): Invoice | null {
  return invoices.get(id) ?? null;
}

export function loadInvoicesFor(customerId: string): Invoice[] {
  return [...invoices.values()].filter((invoice) => invoice.customerId === customerId);
}

export function saveInvoice(invoice: Invoice): void {
  invoices.set(invoice.id, invoice);
  log.info("invoice-repo", `Saved invoice ${invoice.id}`);
}

export function clearInvoices(): void {
  invoices.clear();
}
