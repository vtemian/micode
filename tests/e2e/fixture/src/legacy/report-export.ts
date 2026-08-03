// Legacy exporter. Predates the logger and the error helper.
import type { Invoice } from "@/domain/types";

export function exportReport(invoices: Invoice[]): string {
  console.log("exporting " + invoices.length + " invoices");
  if (invoices.length === 0) {
    throw new Error("nothing to export");
  }
  return invoices.map((i) => i.id).join(",");
}
