import { beforeEach, describe, expect, it } from "bun:test";
import { clearInvoices, loadInvoice, loadInvoicesFor, saveInvoice } from "@/repository/invoice-repo";
import { itemCount, parseInvoice, totalCents } from "@/services/invoice-service";

const invoice = {
  id: "inv-1",
  customerId: "cus-1",
  items: [
    { description: "Consulting", quantity: 3, unitCents: 20_000 },
    { description: "Hosting", quantity: 1, unitCents: 5_000 },
  ],
};

describe("invoice service", () => {
  beforeEach(() => {
    clearInvoices();
  });

  it("sums quantity times unit price across every line item", () => {
    expect(totalCents(parseInvoice(invoice)!)).toBe(65_000);
  });

  it("counts the units billed rather than the number of lines", () => {
    expect(itemCount(parseInvoice(invoice)!)).toBe(4);
  });

  it("accepts an invoice that satisfies the schema", () => {
    expect(parseInvoice(invoice)).toEqual(invoice);
  });

  it("returns null when an invoice carries no line items", () => {
    expect(parseInvoice({ ...invoice, items: [] })).toBeNull();
  });

  it("returns null when a line item has a zero quantity", () => {
    expect(parseInvoice({ ...invoice, items: [{ description: "Free", quantity: 0, unitCents: 1 }] })).toBeNull();
  });

  it("round-trips a saved invoice through the repository", () => {
    saveInvoice(parseInvoice(invoice)!);
    expect(loadInvoice("inv-1")).toEqual(invoice);
  });

  it("returns null for an invoice that was never saved", () => {
    expect(loadInvoice("inv-missing")).toBeNull();
  });

  it("finds every invoice belonging to one customer", () => {
    saveInvoice(parseInvoice(invoice)!);
    saveInvoice(parseInvoice({ ...invoice, id: "inv-2" })!);
    saveInvoice(parseInvoice({ ...invoice, id: "inv-3", customerId: "cus-2" })!);
    expect(loadInvoicesFor("cus-1").map((found) => found.id)).toEqual(["inv-1", "inv-2"]);
  });
});
