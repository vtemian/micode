# Billing fixture

A small invoicing domain: customers hold invoices, invoices hold line items,
and payments settle invoices. Used to exercise mindmodel generation.

## Layout

- `src/domain/` holds the Valibot schemas and the types derived from them.
- `src/services/` holds the domain logic. Every service exposes a `parseX`
  boundary function that validates untrusted input and returns `null` on
  rejection.
- `src/repository/` holds `loadX` / `saveX` accessors over an in-memory `Map`.
- `src/utils/` holds the shared logger and error-message helper.
- `src/legacy/` holds the pre-refactor report exporter, kept as-is.
