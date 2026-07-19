-- tests/fixtures/orm-drift/create-tables.sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  org_id INTEGER REFERENCES orgs(id)
);

CREATE UNIQUE INDEX users_email_idx ON users (email);
CREATE INDEX users_name_idx ON users (name, email);

ALTER TABLE users ADD CONSTRAINT chk CHECK (id > 0);
