import { type Customer, CustomerSchema } from "@/domain/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import * as v from "valibot";

export function displayName(customer: Customer): string {
  return `${customer.name} <${customer.email}>`;
}

export function emailDomain(customer: Customer): string {
  return customer.email.slice(customer.email.indexOf("@") + 1);
}

export function parseCustomer(raw: unknown): Customer | null {
  try {
    return v.parse(CustomerSchema, raw);
  } catch (error) {
    log.error("customer-service", `Rejected customer: ${extractErrorMessage(error)}`);
    return null;
  }
}
