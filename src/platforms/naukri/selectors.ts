export const NaukriSelectors = {
  loginEmail: "#usernameField",
  loginPassword: "#passwordField",
  loginSubmit: 'button[type="submit"]',

  profileIcon: [
    ".nI-gNb-drawer__icon",
    '[data-type="userProfile"]',
    'a[href*="mnjuser/profile"]',
  ].join(", "),

  userName: [".nI-gNb-info__name", ".user-name", '[class*="user-name"]'].join(", "),

  keywordInput: [
    "#qsb-keyword-sugg",
    'input[placeholder*="skills" i]',
    ".keywordSugg input",
  ].join(", "),

  locationInput: ["#qsb-location-sugg", 'input[placeholder*="location" i]'].join(", "),

  searchButton: [".qsbSubmit", 'button:has-text("Search")'].join(", "),

  jobCard: [
    "article.jobTuple",
    ".srp-jobtuple-wrapper",
    ".cust-job-tuple",
    ".jobTuple",
    "[data-job-id]",
  ].join(", "),

  jobTitle: ["a.title", ".title", ".row1 a"].join(", "),
  jobCompany: [".companyInfo .subTitle", ".comp-name", "a.comp-name"].join(", "),
  jobLocation: [".locWdth", ".loc-info", ".location"].join(", "),
  jobLink: ["a.title", ".row1 a"].join(", "),

  applyButton: [
    'button:has-text("Apply")',
    'button:has-text("Easy Apply")',
    "#apply-button",
    'button[class*="apply"]',
  ].join(", "),

  chatApplyButton: [
    'button:has-text("Chat and Apply")',
    'button:has-text("Apply through chat")',
  ].join(", "),

  continueButton: [
    'button:has-text("Continue")',
    'button:has-text("Save and Continue")',
    'button:has-text("Next")',
  ].join(", "),

  submitButton: [
    'button:has-text("Submit")',
    'button:has-text("Submit Application")',
  ].join(", "),

  successMessage: [
    "text=Application submitted",
    "text=Applied successfully",
    "text=You have successfully applied",
  ].join(", "),

  chatbotInput: [
    'input[placeholder*="Type message" i]',
    'textarea[placeholder*="Type message" i]',
    'div[contenteditable="true"]',
  ].join(", "),
} as const;