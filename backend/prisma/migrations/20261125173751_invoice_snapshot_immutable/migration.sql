-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "snapshot" JSONB;

CREATE FUNCTION prevent_invoice_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Invoices cannot be deleted';
END;
$$;

CREATE TRIGGER invoice_no_delete
BEFORE DELETE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_delete();

CREATE TRIGGER invoice_line_no_delete
BEFORE DELETE ON "InvoiceLine"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_delete();

CREATE FUNCTION prevent_invoice_line_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Invoice lines are immutable';
END;
$$;

CREATE TRIGGER invoice_line_no_update
BEFORE UPDATE ON "InvoiceLine"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_line_update();

CREATE FUNCTION protect_invoice_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled invoices cannot be changed';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."invoiceNo" IS DISTINCT FROM OLD."invoiceNo"
    OR NEW."financialYear" IS DISTINCT FROM OLD."financialYear"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
    OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
    OR NEW."placeOfSupplyStateCode" IS DISTINCT FROM OLD."placeOfSupplyStateCode"
    OR NEW."isInterState" IS DISTINCT FROM OLD."isInterState"
    OR NEW."taxableValuePaise" IS DISTINCT FROM OLD."taxableValuePaise"
    OR NEW."cgstPaise" IS DISTINCT FROM OLD."cgstPaise"
    OR NEW."sgstPaise" IS DISTINCT FROM OLD."sgstPaise"
    OR NEW."igstPaise" IS DISTINCT FROM OLD."igstPaise"
    OR NEW."totalPaise" IS DISTINCT FROM OLD."totalPaise"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Posted invoice fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_immutable_fields
BEFORE UPDATE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION protect_invoice_update();
