Feature: Inspecting a workspace without a database connection
  Operators can review a saved configuration or obtain safe setup guidance
  before attempting a database connection.

  Scenario: Inspect a configured PostgreSQL workspace as JSON
    Given a configured PostgreSQL workspace
    When I inspect the workspace without connecting in JSON
    Then the command succeeds
    And the report schema version is 1
    And the report database system is "postgresql"
    And the database probe is skipped
    And the schema cache is available
    And the report does not expose connection credentials

  Scenario: Explain how to bootstrap an unconfigured workspace
    Given an unconfigured workspace
    When I inspect the workspace without connecting in JSON
    Then the command succeeds
    And the report has no database system
    And the report recommends "dbcli init"
