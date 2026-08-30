-- Mirrors payments.material_entry_id: lets a payment be linked to the specific
-- labor/equipment entry it was paid against, so amount_paid on that entry stays
-- in sync and the dashboard doesn't double-count it as a standalone payment.
ALTER TABLE payments ADD COLUMN labor_entry_id INTEGER REFERENCES labor_entries(id);
ALTER TABLE payments ADD COLUMN equipment_entry_id INTEGER REFERENCES equipment_entries(id);
