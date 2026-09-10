import * as v from "valibot";

export const LineItemSchema = v.object({
  description: v.string(),
  quantity: v.pipe(v.number(), v.minValue(1)),
  unitCents: v.pipe(v.number(), v.minValue(0)),
});

export const InvoiceSchema = v.object({
  id: v.string(),
  customerId: v.string(),
  items: v.pipe(v.array(LineItemSchema), v.minLength(1)),
});

export const CustomerSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
});

export const PaymentSchema = v.object({
  id: v.string(),
  invoiceId: v.string(),
  amountCents: v.pipe(v.number(), v.minValue(1)),
  method: v.picklist(["card", "transfer", "cash"]),
});

export type LineItem = v.InferOutput<typeof LineItemSchema>;
export type Invoice = v.InferOutput<typeof InvoiceSchema>;
export type Customer = v.InferOutput<typeof CustomerSchema>;
export type Payment = v.InferOutput<typeof PaymentSchema>;
