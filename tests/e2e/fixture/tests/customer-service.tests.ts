import { beforeEach, describe, expect, it } from "bun:test";
import { clearCustomers, loadCustomer, loadCustomersByDomain, saveCustomer } from "@/repository/customer-repo";
import { displayName, emailDomain, parseCustomer } from "@/services/customer-service";

const customer = {
  id: "cus-1",
  name: "Ada Lovelace",
  email: "ada@analytical.example",
};

describe("customer service", () => {
  beforeEach(() => {
    clearCustomers();
  });

  it("renders a customer as name and bracketed address", () => {
    expect(displayName(parseCustomer(customer)!)).toBe("Ada Lovelace <ada@analytical.example>");
  });

  it("reads the domain out of the email address", () => {
    expect(emailDomain(parseCustomer(customer)!)).toBe("analytical.example");
  });

  it("accepts a customer that satisfies the schema", () => {
    expect(parseCustomer(customer)).toEqual(customer);
  });

  it("returns null when the email address is malformed", () => {
    expect(parseCustomer({ ...customer, email: "not-an-address" })).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parseCustomer({ id: "cus-2", name: "No Email" })).toBeNull();
  });

  it("round-trips a saved customer through the repository", () => {
    saveCustomer(parseCustomer(customer)!);
    expect(loadCustomer("cus-1")).toEqual(customer);
  });

  it("returns null for a customer that was never saved", () => {
    expect(loadCustomer("cus-missing")).toBeNull();
  });

  it("groups customers by the domain of their email address", () => {
    saveCustomer(parseCustomer(customer)!);
    saveCustomer(parseCustomer({ id: "cus-2", name: "Grace Hopper", email: "grace@analytical.example" })!);
    saveCustomer(parseCustomer({ id: "cus-3", name: "Alan Turing", email: "alan@bletchley.example" })!);
    expect(loadCustomersByDomain("analytical.example").map((found) => found.id)).toEqual(["cus-1", "cus-2"]);
  });
});
