Feature: Safely pruning verification artifacts
  Operators can preview retention cleanup before deleting verification evidence.

  Scenario: Preview removal of an expired verification artifact
    Given a workspace with an expired verification artifact
    When I preview pruning artifacts older than 30 days
    Then the command succeeds
    And the expired artifact is a prune candidate
    And no verification artifacts are deleted
    And the expired artifact is still listed
