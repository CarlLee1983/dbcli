-- 示範用資料：客戶與訂單。password_hash 會在 setup 時加入黑名單。
SET client_min_messages = warning;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
  id            integer PRIMARY KEY,
  name          text        NOT NULL,
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          integer PRIMARY KEY,
  customer_id integer       NOT NULL REFERENCES customers (id),
  amount      numeric(10,2) NOT NULL,
  ordered_at  timestamptz   NOT NULL
);

INSERT INTO customers (id, name, email, password_hash) VALUES
  (1, 'Ada Chen',     'ada@example.com',    '$2b$12$demoAdaHashNotARealSecret000000000000000000'),
  (2, 'Ben Lin',      'ben@example.com',    '$2b$12$demoBenHashNotARealSecret000000000000000000'),
  (3, 'Chloe Wang',   'chloe@example.com',  '$2b$12$demoChloeHashNotARealSecret0000000000000000'),
  (4, 'David Huang',  'david@example.com',  '$2b$12$demoDavidHashNotARealSecret0000000000000000'),
  (5, 'Eva Tsai',     'eva@example.com',    '$2b$12$demoEvaHashNotARealSecret000000000000000000'),
  (6, 'Frank Wu',     'frank@example.com',  '$2b$12$demoFrankHashNotARealSecret0000000000000000'),
  (7, 'Grace Liu',    'grace@example.com',  '$2b$12$demoGraceHashNotARealSecret0000000000000000'),
  (8, 'Henry Kuo',    'henry@example.com',  '$2b$12$demoHenryHashNotARealSecret0000000000000000');

-- 每位客戶在上個月有數筆訂單，金額依 id 與序號決定，結果可重現。
INSERT INTO orders (id, customer_id, amount, ordered_at)
SELECT row_number() OVER (ORDER BY c.id, n),
       c.id,
       round((40 + (c.id * 37 + n * 53) % 260)::numeric, 2),
       date_trunc('month', now()) - interval '1 month' + (n * 3 + c.id) * interval '1 day'
FROM customers c
CROSS JOIN generate_series(1, 3 + c.id % 4) AS n;
