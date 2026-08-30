-- Lets the auto-calculated budget (price/sq.ft x area) account for costs that
-- fall outside the plain per-sqft rate (e.g. GST, registration, premium
-- fittings), rather than forcing everything into one blended rate.
ALTER TABLE projects ADD COLUMN extra_cost REAL DEFAULT 0;
ALTER TABLE projects ADD COLUMN extra_cost_notes TEXT;
