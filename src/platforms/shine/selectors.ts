 // src/platforms/shine/selectors.ts

export const ShineSelectors = {
  // ── Login ───────────────────────────────────────────────
  loginEmail: [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="Email" i]',
  ].join(", "),
  loginPassword: [
    'input[type="password"]',
    'input[name="password"]',
  ].join(", "),
  loginSubmit: [
    'button:has-text("Log In")',
    'button[type="submit"]',
  ].join(", "),

  // ── Job cards (CSS Modules — prefix match on stable segment) ──
  jobCard: 'article[class*="result-card_card"]',
  jobTitle: 'h3[class*="result-card_role"]',
  jobCompany: 'span[class*="result-card_company"]',
  jobPostedAt: 'span[class*="result-card_posted"]',
  jobMetaItem: 'span[class*="result-card_meta-item"]',
  jobMetaText: 'span[class*="result-card_meta-text"]',
  jobSkills: 'span[class*="result-card_skills-item"]',
  jobLink: 'a[class*="result-card_hit"]',
  applyButtonOnCard: 'button[class*="result-card_apply"]',

  // ── Sort control ────────────────────────────────────────
  sortTrigger: 'button[class*="sort-control_trigger"]',
  sortPanel: 'div[class*="sort-control_panel"][role="listbox"]',
  sortOption: 'button[class*="sort-control_row"][role="option"]',
  sortOptionMostRecent:
    'button[class*="sort-control_row"][role="option"]:has-text("Most recent")',
  sortTriggerValue: 'b[class*="sort-control_trigger-value"]',

  // ── Filter sidebar ──────────────────────────────────────
  filterTrigger: 'button[class*="filter-trigger_trigger"]',
  filterPanel: 'aside[class*="filter-panel_panel"]',
  filterSection: 'section[class*="facet-section_card"]',
  filterSectionHeader: 'h3[class*="facet-section_name"]',
  filterPill: 'button[class*="facet-section_pill"]',
  filterPillSelected:
    'button[class*="facet-section_pill"][class*="facet-section_is-on"], button[class*="facet-section_pill"][aria-pressed="true"]',
  filterSeeAll: 'button[class*="facet-section_more"]',
  filterApplyButton: 'button[class*="filter-panel_apply"]',
  filterClearButton: 'button[class*="filter-panel_clear"]',
  filterCloseButton: 'button[class*="filter-panel_close"]',

  // ── Sub-modal (drill-down dialog) ───────────────────────
  subModal:
    'div[class*="facet-modal"], div[class*="facet_modal"], div[class*="facetDrawer"], div[class*="modal"], [role="dialog"]',
  subModalHeading: 'h2, h3, [class*="title"], [class*="heading"]',
  subModalDoneButton: 'button:has-text("Done")',
  subModalOptionRow: '[class*="option"], [class*="row"], label',
  subModalCheckbox: 'input[type="checkbox"]',

  // ── Application flow ────────────────────────────────────
  submitButton: [
    'button:has-text("Submit")',
    'button:has-text("Apply Now")',
  ].join(", "),
  continueButton: [
    'button:has-text("Continue")',
    'button:has-text("Next")',
  ].join(", "),
  successMessage: [
    'text=Application submitted',
    'text=Applied successfully',
    'text=You have successfully applied',
    'text=Thank you for applying',
  ].join(", "),
  externalApplyButton: [
    'button:has-text("Apply on company site")',
    'button:has-text("Apply on company website")',
  ].join(", "),
  alreadyAppliedText: [
    'text=Already Applied',
    'text=Application Sent',
  ].join(", "),
} as const;

export interface ShineFilters {
  locations?: string[];
  experiences?: string[];
  salaries?: string[];
  departments?: string[];
  industries?: string[];
  employments?: string[];
}
// // src/platforms/shine/selectors.ts

// export const ShineSelectors = {
//   // ── Auth ────────────────────────────────────────────────
//   loginEmail: [
//     'input[name="username"]',
//     'input[type="email"]',
//     '#login-email',
//     'input[placeholder*="Email" i]',
//   ].join(", "),

//   loginPassword: [
//     'input[name="password"]',
//     'input[type="password"]',
//     '#login-password',
//     'input[placeholder*="Password" i]',
//   ].join(", "),

//   loginSubmit: [
//     'button[type="submit"]',
//     'button:has-text("Login")',
//     'button:has-text("Sign In")',
//   ].join(", "),

//   // ── Profile / Logged-in indicator ───────────────────────
//   profileIcon: [
//     '[class*="userProfile"]',
//     '[class*="user-profile"]',
//     'a[href*="profile"]',
//     'img[alt*="profile" i]',
//     '[data-testid="user-avatar"]',
//   ].join(", "),

//   // ── Search ──────────────────────────────────────────────
//   keywordInput: [
//     'input[name="q"]',
//     'input[placeholder*="Search" i]',
//     '#search-job-title',
//     '.search-bar input',
//   ].join(", "),

//   locationInput: [
//     'input[name="l"]',
//     'input[placeholder*="Location" i]',
//     '#search-location',
//   ].join(", "),

//   searchButton: [
//     'button:has-text("Search")',
//     'button[type="submit"]',
//     '.search-btn',
//   ].join(", "),

//   // ── Job Cards (Shine uses hashed class names like jobCardNova_bigCard__xxx) ─
//   jobCard: [
//     '[class*="jobCardNova"]',
//     '[class*="job-card"]',
//     '.job-card',
//     'article[class*="job"]',
//     'div[class*="jobTuple"]',
//     'li[class*="job"]',
//   ].join(", "),

//   jobTitle: [
//     'a[class*="title"]',
//     'a[class*="jobTitle"]',
//     'h2 a',
//     'h3 a',
//     'a.job-title',
//   ].join(", "),

//   jobCompany: [
//     '[class*="companyName"]',
//     '[class*="company"]',
//     'a[class*="company"]',
//     '.comp-name',
//   ].join(", "),

//   jobLocation: [
//     '[class*="location"]',
//     '[class*="loc"]',
//     '.locWdth',
//     'span[class*="location"]',
//   ].join(", "),

//   jobExperience: [
//     '[class*="experience"]',
//     '[class*="exp"]',
//     'span[class*="experience"]',
//     '.expwdth',
//   ].join(", "),

//   jobPostedAt: [
//     '[class*="posted"]',
//     '[class*="date"]',
//     'span[class*="posted"]',
//     '.job-post-day',
//   ].join(", "),

//   // ── Apply Buttons ───────────────────────────────────────
//   applyButton: [
//     'button:has-text("Apply")',
//     'button:has-text("Easy Apply")',
//     'a:has-text("Apply")',
//     '[class*="applyBtn"]',
//     '[class*="apply-btn"]',
//   ].join(", "),

//   // ── Application Flow ────────────────────────────────────
//   submitButton: [
//     'button:has-text("Submit")',
//     'button:has-text("Submit Application")',
//     'button:has-text("Apply Now")',
//   ].join(", "),

//   continueButton: [
//     'button:has-text("Continue")',
//     'button:has-text("Next")',
//     'button:has-text("Proceed")',
//   ].join(", "),

//   successMessage: [
//     'text=Application submitted',
//     'text=Applied successfully',
//     'text=You have successfully applied',
//     'text=Thank you for applying',
//     '[class*="success"]',
//   ].join(", "),

//   // ── External Apply Detection ────────────────────────────
//   externalApplyButton: [
//     'button:has-text("Apply on company site")',
//     'button:has-text("Apply on company website")',
//     'a:has-text("Apply on company site")',
//     '[class*="externalApply"]',
//   ].join(", "),

//   // ── Already Applied ─────────────────────────────────────
//   alreadyAppliedText: [
//     'text=Already Applied',
//     'text=Application Sent',
//     'text=You applied',
//     '[class*="applied"]',
//   ].join(", "),
// } as const;