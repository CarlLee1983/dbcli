# Final review fix report

## Status

Complete.

## Changes

- Split the friendly decorative orange/blue tokens from darker normal-text and primary-action tokens.
- Added WCAG contrast assertions for orange text on cream, white, and orange-soft; white on the primary orange action; and blue text on blue-soft.
- Replaced the nonexistent `report` supporting labels with `query --ui` and `recover · query --ui` in both locales.
- Gave brand, navigation, locale, support, footer, and compact navigation CTA links at least 44px of clickable height.
- Replaced the brand's empty fragment with `#main-content` and added regression coverage for every internal fragment target.
- Marked the hero conversation visibly as an example in both locales.
- Expanded the locale parity contract to require exactly nine FAQs, exactly the same four approved Quickstart commands, and byte-identical CSS.

## TDD evidence

### RED

Command:

```text
$ bun test tests/docs/intro-pages.test.ts
```

Result:

```text
12 pass
10 fail
56 expect() calls
Ran 22 tests across 1 file.
```

Expected failures covered both locales for:

```text
keeps text links comfortably tappable
labels the hero conversation as an example in visible copy
all internal fragment links have targets
core normal-text color combinations meet WCAG AA
uses the real interactive-report command labels
```

The contrast cases initially had no `orange-text`, `orange-action`, or `blue-text`
tokens. The other failures showed missing `min-height: 44px`, the empty brand
fragment, no visible example wording, and the old `report` /
`recover · report` labels.

### GREEN

Command:

```text
$ bun test tests/docs/intro-pages.test.ts
```

Complete result:

```text
bun test v1.3.10 (30e609e0)

tests/docs/intro-pages.test.ts:
(pass) zh-TW intro page > uses the approved semantic product-page structure
(pass) zh-TW intro page > leads with workflow value instead of installation
(pass) zh-TW intro page > has accessible navigation and motion fallback
(pass) zh-TW intro page > links to the counterpart locale with a relative URL
(pass) zh-TW intro page > keeps text links comfortably tappable
(pass) zh-TW intro page > labels the hero conversation as an example in visible copy
(pass) zh-TW intro page > all internal fragment links have targets
(pass) zh-TW intro page > core normal-text color combinations meet WCAG AA
(pass) en intro page > uses the approved semantic product-page structure
(pass) en intro page > leads with workflow value instead of installation
(pass) en intro page > has accessible navigation and motion fallback
(pass) en intro page > links to the counterpart locale with a relative URL
(pass) en intro page > keeps text links comfortably tappable
(pass) en intro page > labels the hero conversation as an example in visible copy
(pass) en intro page > all internal fragment links have targets
(pass) en intro page > core normal-text color combinations meet WCAG AA
(pass) locale pages expose the same section and component contract
(pass) zh-TW uses the real interactive-report command labels
(pass) en uses the real interactive-report command labels
(pass) English interface contains no residual Traditional Chinese copy
(pass) zh-TW local assets exist
(pass) en local assets exist

22 pass
0 fail
108 expect() calls
Ran 22 tests across 1 file.
```

## Final verification

```text
$ bun run docs:check
✓ docs/user/en: 21 Markdown/HTML topics aligned
✓ docs/user/zh-TW: 21 Markdown/HTML topics aligned

$ git diff --check
(exit 0, no output)
```

## Commit

Recorded after commit as `PENDING` in this in-commit report. The final handoff
contains the resulting commit hash.

## Concerns

- No browser or visual-layout verification was performed or claimed.
- Contrast coverage targets the core normal-text token/background combinations
  named in the review; it does not attempt to statically resolve every possible
  inherited CSS color in the document.

## Final re-review touch-target fix

### Change

- Extended the tappability contract for navigation/locale, support, and footer
  links to require `min-width: 44px` as well as `min-height: 44px`.
- Applied byte-identical CSS to both locale pages with `display: inline-flex`,
  centered alignment on both axes, and 44px minimum width and height.

### RED

Command:

```text
$ bun test tests/docs/intro-pages.test.ts
```

Result:

```text
20 pass
2 fail
106 expect() calls
Ran 22 tests across 1 file.
```

Both locale instances of `keeps text links comfortably tappable` failed at the
new `.nav-links a, .locale-link` `min-width: 44px` assertion. The received CSS
had the existing height requirement but no minimum width, confirming that the
new contract detected the remaining review finding.

### GREEN

Command:

```text
$ bun test tests/docs/intro-pages.test.ts
```

Result:

```text
22 pass
0 fail
114 expect() calls
Ran 22 tests across 1 file.
```

Additional verification:

```text
$ bun -e '<extract and compare both <style> blocks>'
CSS blocks byte-identical

$ git diff --check
(exit 0, no output)
```

### Concerns

- No additional concerns. The explicit 44px minimum width can add horizontal
  space only to labels narrower than 44px; wrapping remains enabled in support
  and footer link containers.
