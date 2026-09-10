import type { Customer } from "@/domain/types";
import { log } from "@/utils/logger";

const customers = new Map<string, Customer>();

export function loadCustomer(id: string): Customer | null {
  return customers.get(id) ?? null;
}

export function loadCustomersByDomain(domain: string): Customer[] {
  return [...customers.values()].filter((customer) => customer.email.endsWith(`@${domain}`));
}

export function saveCustomer(customer: Customer): void {
  customers.set(customer.id, customer);
  log.info("customer-repo", `Saved customer ${customer.id}`);
}

export function clearCustomers(): void {
  customers.clear();
}
