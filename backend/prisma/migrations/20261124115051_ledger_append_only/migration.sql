CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'StockMovement is append-only; corrections must be new ADJUSTMENT rows'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "StockMovement_append_only"
BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW
EXECUTE FUNCTION prevent_stock_movement_mutation();