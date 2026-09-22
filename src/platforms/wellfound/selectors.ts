export const WellfoundSelectors = {
  // Login / Profile indicators
  profileIcon: 'a[href*="/profile"]',
  userName: 'div[class*="styles_userName"]',

  // Search Page
  searchBar: 'input[placeholder="Search"]',
  jobCard: 'div[data-test="StartupResult"]',
  jobTitle: 'a[data-test="JobTitle"]',
  jobCompany: 'a[data-test="CompanyName"]',
  jobLocation: 'span[data-test="Location"]',
  jobLink: 'a[data-test="JobTitle"]',

  // Job Details / Apply
  applyButton: 'button:has-text("Apply")',
  externalApplyButton: 'a:has-text("Apply on company site")',
  
  // Application Modal (Based on the HTML)
  modalOverlay: 'div[role="dialog"]',
  modalSubmit: 'button[data-test="JobDescriptionSlideIn--SubmitButton"]',
  modalNext: 'button:has-text("Next")',
  
  // Success States
  successMessage: 'text=Application submitted',
  alreadyApplied: 'text=Applied',
} as const;