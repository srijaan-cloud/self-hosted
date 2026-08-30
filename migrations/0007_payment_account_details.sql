-- Stores the recipient's account/UPI reference on a payment (e.g. "To Account
-- Number" from an imported bank statement), so the Vendors page can show who was
-- paid, when, for which project, and through which account.
ALTER TABLE payments ADD COLUMN paid_to_account TEXT;
