import { type Invoice, InvoiceSchema } from "@/domain/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import * as v from "valibot";

export function totalCents(invoice: Invoice): number {
  return invoice.items.reduce((sum, item) => sum + item.quantity * item.unitCents, 0);
}

export function itemCount(invoice: Invoice): number {
  return invoice.items.reduce((count, item) => count + item.quantity, 0);
}

export function parseInvoice(raw: unknown): Invoice | null {
  try {
    return v.parse(InvoiceSchema, raw);
  } catch (error) {
    log.error("invoice-service", `Rejected invoice: ${extractErrorMessage(error)}`);
    return null;
  }
}
