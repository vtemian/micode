import { type Invoice, type Payment, PaymentSchema } from "@/domain/types";
import { totalCents } from "@/services/invoice-service";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import * as v from "valibot";

export function settledCents(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

export function outstandingCents(invoice: Invoice, payments: Payment[]): number {
  const settled = settledCents(payments.filter((payment) => payment.invoiceId === invoice.id));
  return Math.max(totalCents(invoice) - settled, 0);
}

export function parsePayment(raw: unknown): Payment | null {
  try {
    return v.parse(PaymentSchema, raw);
  } catch (error) {
    log.error("payment-service", `Rejected payment: ${extractErrorMessage(error)}`);
    return null;
  }
}
