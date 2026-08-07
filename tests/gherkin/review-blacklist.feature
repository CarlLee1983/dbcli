Feature: Reviewing protected database data
  Operators can inspect the configured protected tables and columns before
  issuing database commands.

  Scenario: List protected tables and columns as JSON
    Given a workspace with configured protected data
    When I list the blacklist as JSON
    Then the command succeeds
    And the protected tables are "audit_logs"
    And the protected columns for "users" are "password"
