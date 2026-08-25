-- Demo data so the dashboard has something real to show on first login.
-- Safe to delete later (see scripts/clear-demo-data.sql) once real projects are entered.

INSERT INTO projects (name, client_name, site_address, city, start_date, expected_end_date, status, total_budget, description) VALUES
  ('Green Valley Apartments', 'Green Valley Developers Pvt Ltd', 'Survey No. 142, Kondapur', 'Hyderabad', '2026-02-01', '2027-06-30', 'ongoing', 45000000, 'G+4 residential apartment block, 32 units'),
  ('Lakeview Villas Phase 2', 'Lakeview Estates LLP', 'Plot 8-14, Sarjapur Road', 'Bengaluru', '2026-04-15', '2027-03-31', 'ongoing', 28000000, '12 independent villas, Phase 2 of the Lakeview township'),
  ('Tapasya Corporate Tower', 'Self (owner project)', 'HITEC City Road, Madhapur', 'Hyderabad', '2026-09-01', '2028-12-31', 'planning', 120000000, 'G+12 commercial tower, owned and developed in-house'),
  ('Sunrise Residency', 'Sunrise Homes Pvt Ltd', 'OMR Phase 2, Sholinganallur', 'Chennai', '2025-01-10', '2026-05-20', 'completed', 32000000, 'G+3 residential complex, handed over');

INSERT INTO vendors (name, contact_person, phone, email, gst_number, address) VALUES
  ('Sri Balaji Steel Traders', 'Ramesh Kumar', '9848012345', 'sales@balajisteel.in', '36AABCS1234F1Z5', 'Balanagar Industrial Area, Hyderabad'),
  ('Ultratech Cement Distributors', 'Suresh Reddy', '9849023456', 'orders@ultratechdist.in', '36AACCU5678G1Z2', 'Sanathnagar, Hyderabad'),
  ('Krishna Sand Suppliers', 'Krishna Murthy', '9848034567', 'krishnasand@gmail.com', '36AAECK9012H1Z8', 'Shamshabad, Hyderabad'),
  ('Kajaria Tiles Gallery', 'Anand Verma', '9847045678', 'anand@kajariagallery.in', '29AAFCK3456J1Z4', 'Whitefield, Bengaluru'),
  ('Classic Granites & Marbles', 'Prakash Rao', '9846056789', 'classicgranites@gmail.com', '29AAGCG7890K1Z1', 'Bommanahalli, Bengaluru'),
  ('Asian Paints Putty Center', 'Vijay Singh', '9845067890', 'vijay@appc.in', '33AAHCA2345L1Z7', 'Ambattur, Chennai'),
  ('RMC Readymix Concrete Pvt Ltd', 'Naveen Chandra', '9844078901', 'dispatch@rmcreadymix.in', '36AAJCR6789M1Z3', 'Gachibowli, Hyderabad'),
  ('Modern Bricks Industries', 'Ravi Teja', '9843089012', 'modernbricks@gmail.com', '36AAKCM0123N1Z9', 'Medchal, Hyderabad');

-- Material entries: project 1 = Green Valley, 2 = Lakeview, 3 = Tapasya Tower, 4 = Sunrise (completed)
INSERT INTO material_entries (project_id, material_type_id, vendor_id, date, quantity_ordered, quantity_received, unit, rate_per_unit, amount_total, invoice_number, status, notes, created_by) VALUES
  (1, 1, 1, '2026-03-05', 5000, 5000, 'kg', 62, 310000, 'BST-2201', 'received', 'TMT bars for foundation', 'Site Engineer - Kiran'),
  (1, 2, 2, '2026-03-08', 400, 400, 'bags', 385, 154000, 'UCD-1187', 'received', 'OPC 53 grade for foundation RCC', 'Site Engineer - Kiran'),
  (1, 3, 3, '2026-03-10', 1200, 1100, 'cu.ft', 55, 60500, 'KSS-0554', 'partial', 'River sand, 100 cu.ft short delivery', 'Site Engineer - Kiran'),
  (1, 7, 7, '2026-04-02', 45, 45, 'cu.m', 6800, 306000, 'RMC-3321', 'received', 'M25 grade RMC for slab', 'Site Engineer - Kiran'),
  (1, 8, 8, '2026-04-10', 25000, 25000, 'pieces', 8, 200000, 'MBI-0912', 'received', 'Red clay bricks for superstructure', 'Site Engineer - Kiran'),
  (1, 1, 1, '2026-05-15', 3200, 2000, 'kg', 63, 201600, 'BST-2340', 'partial', 'Second batch of TMT, balance pending', 'Site Engineer - Kiran'),
  (1, 5, 5, '2026-06-01', 1800, 0, 'sq.ft', 145, 261000, 'CGM-7712', 'ordered', 'Granite flooring - lobby and common areas', 'Site Engineer - Kiran'),

  (2, 2, 2, '2026-04-20', 350, 350, 'bags', 390, 136500, 'UCD-1220', 'received', 'Foundation concrete', 'Site Engineer - Manoj'),
  (2, 3, 3, '2026-04-22', 900, 900, 'cu.ft', 58, 52200, 'KSS-0601', 'received', NULL, 'Site Engineer - Manoj'),
  (2, 4, 4, '2026-06-10', 3500, 3500, 'sq.ft', 68, 238000, 'KTG-4501', 'received', 'Vitrified tiles for all villas', 'Site Engineer - Manoj'),
  (2, 6, 6, '2026-06-15', 180, 180, 'bags', 420, 75600, 'APP-2210', 'received', 'Wall putty, interior finishing', 'Site Engineer - Manoj'),
  (2, 1, 1, '2026-07-01', 4000, 4000, 'kg', 64, 256000, 'BST-2455', 'received', NULL, 'Site Engineer - Manoj'),

  (4, 1, 1, '2025-02-10', 8000, 8000, 'kg', 58, 464000, 'BST-1102', 'received', NULL, 'Site Engineer - Prasad'),
  (4, 2, 2, '2025-02-15', 600, 600, 'bags', 360, 216000, 'UCD-0812', 'received', NULL, 'Site Engineer - Prasad'),
  (4, 4, 4, '2025-08-05', 5200, 5200, 'sq.ft', 62, 322400, 'KTG-2201', 'received', NULL, 'Site Engineer - Prasad'),
  (4, 5, 5, '2025-09-01', 900, 900, 'sq.ft', 138, 124200, 'CGM-3390', 'received', 'Granite for staircase and lobby', 'Site Engineer - Prasad');

-- Payments (mix of every payment mode, some linked to a material entry, some general)
INSERT INTO payments (project_id, material_entry_id, category, date, amount, payment_mode, transaction_id, cheque_number, bank_name, paid_to, paid_by, remarks) VALUES
  (1, 1, 'material', '2026-03-06', 310000, 'neft', 'NEFT2603060012', NULL, 'HDFC Bank', 'Sri Balaji Steel Traders', 'Accounts - Lakshmi', 'Full payment against invoice BST-2201'),
  (1, 2, 'material', '2026-03-09', 100000, 'gpay', 'GPAY938271650', NULL, NULL, 'Ultratech Cement Distributors', 'Accounts - Lakshmi', 'Partial advance'),
  (1, 2, 'material', '2026-03-20', 54000, 'cheque', NULL, '004521', 'HDFC Bank', 'Ultratech Cement Distributors', 'Accounts - Lakshmi', 'Balance payment'),
  (1, 3, 'material', '2026-03-11', 60500, 'cash', NULL, NULL, NULL, 'Krishna Sand Suppliers', 'Site Engineer - Kiran', 'Paid on delivery'),
  (1, 4, 'material', '2026-04-03', 306000, 'phonepe', 'T2604031234567890', NULL, NULL, 'RMC Readymix Concrete Pvt Ltd', 'Accounts - Lakshmi', NULL),
  (1, 5, 'material', '2026-04-12', 150000, 'netbanking', 'IB-HYD-889021', NULL, 'ICICI Bank', 'Modern Bricks Industries', 'Accounts - Lakshmi', 'Partial, balance next cycle'),
  (1, 6, 'material', '2026-05-16', 100000, 'gpay', 'GPAY938299410', NULL, NULL, 'Sri Balaji Steel Traders', 'Accounts - Lakshmi', 'Advance for second TMT batch'),
  (1, NULL, 'advance', '2026-02-20', 5000000, 'netbanking', 'IB-HYD-770012', NULL, 'ICICI Bank', 'Tapasya Constructions (project account)', 'Director - V. Rao', 'Initial mobilisation transfer from client'),

  (2, 8, 'material', '2026-04-21', 136500, 'neft', 'NEFT2604210088', NULL, 'HDFC Bank', 'Ultratech Cement Distributors', 'Accounts - Lakshmi', NULL),
  (2, 9, 'material', '2026-04-23', 52200, 'cash', NULL, NULL, NULL, 'Krishna Sand Suppliers', 'Site Engineer - Manoj', NULL),
  (2, 10, 'material', '2026-06-12', 200000, 'phonepe', 'T2606121112223334', NULL, NULL, 'Kajaria Tiles Gallery', 'Accounts - Lakshmi', 'Partial, balance pending'),
  (2, 11, 'material', '2026-06-16', 75600, 'gpay', 'GPAY940112873', NULL, NULL, 'Asian Paints Putty Center', 'Accounts - Lakshmi', NULL),

  (4, 13, 'material', '2025-02-11', 464000, 'neft', 'NEFT2502110045', NULL, 'HDFC Bank', 'Sri Balaji Steel Traders', 'Accounts - Lakshmi', NULL),
  (4, 14, 'material', '2025-02-16', 216000, 'cheque', NULL, '003210', 'HDFC Bank', 'Ultratech Cement Distributors', 'Accounts - Lakshmi', NULL),
  (4, 15, 'material', '2025-08-06', 322400, 'netbanking', 'IB-CHN-556677', NULL, 'ICICI Bank', 'Kajaria Tiles Gallery', 'Accounts - Lakshmi', NULL),
  (4, 16, 'material', '2025-09-02', 124200, 'phonepe', 'T2509021122334455', NULL, NULL, 'Classic Granites & Marbles', 'Accounts - Lakshmi', NULL);

-- Labor entries
INSERT INTO labor_entries (project_id, date, trade, contractor_name, worker_count, wage_rate, amount_total, amount_paid, notes) VALUES
  (1, '2026-03-15', 'mason', 'Venkatesh Labor Contractors', 8, 900, 21600, 21600, 'Foundation masonry, 3 days'),
  (1, '2026-04-20', 'helper', 'Venkatesh Labor Contractors', 15, 600, 9000, 6000, 'RMC pour support, 1 day'),
  (1, '2026-06-05', 'electrician', 'Sai Electricals', 3, 1200, 3600, 3600, 'Conduit laying, ground floor'),
  (2, '2026-05-01', 'mason', 'Ramaiah & Sons', 6, 950, 5700, 5700, NULL),
  (2, '2026-06-20', 'carpenter', 'Ramaiah & Sons', 4, 1000, 4000, 2000, 'Shuttering work, Villa 3-6'),
  (4, '2025-03-01', 'plumber', 'Chennai Plumbing Works', 5, 1000, 5000, 5000, 'Full completion, first fix + second fix');

-- Equipment entries
INSERT INTO equipment_entries (project_id, equipment_name, vendor, date_from, date_to, rate, rate_unit, amount_total, amount_paid, notes) VALUES
  (1, 'JCB Excavator', 'Hyderabad Earthmovers', '2026-02-05', '2026-02-12', 4500, 'per_day', 31500, 31500, 'Site excavation'),
  (1, 'Concrete Mixer (10/7)', 'BuildMach Rentals', '2026-03-01', '2026-05-31', 1200, 'per_day', 110400, 80000, 'Ongoing rental, 92 days'),
  (2, 'Tower Crane', 'Karnataka Cranes Pvt Ltd', '2026-04-15', '2026-12-31', 3200, 'per_day', 838400, 400000, 'Long-term rental for villa construction'),
  (3, 'Site Survey Equipment', 'PrecisionSurvey Co', '2026-08-01', '2026-08-10', 2000, 'per_day', 18000, 18000, 'Pre-construction topographic survey');

-- Project funding (money received)
INSERT INTO project_funding (project_id, date, source, amount, payment_mode, transaction_id, remarks) VALUES
  (1, '2026-02-01', 'client', 15000000, 'netbanking', 'IB-HYD-661200', 'First milestone from Green Valley Developers'),
  (1, '2026-05-01', 'client', 10000000, 'netbanking', 'IB-HYD-661455', 'Second milestone - slab completion'),
  (2, '2026-04-15', 'client', 9000000, 'neft', 'NEFT2604150099', 'Mobilisation advance'),
  (3, '2026-09-01', 'owner', 30000000, 'bank_transfer', 'RTGS-TAP-0001', 'Owner equity contribution'),
  (4, '2025-01-10', 'client', 12000000, 'netbanking', 'IB-CHN-330011', 'Initial mobilisation'),
  (4, '2025-06-01', 'client', 20000000, 'netbanking', 'IB-CHN-330099', 'Final milestone before handover');

-- The app normally keeps material_entries.amount_paid in sync with its linked
-- payments via server/index.js's syncMaterialEntryPaid (runs on every payment
-- create/update/delete through the API). Raw seed INSERTs above bypass that, so
-- backfill it here the same way that function computes it.
UPDATE material_entries
SET amount_paid = (
  SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payments.material_entry_id = material_entries.id
);
